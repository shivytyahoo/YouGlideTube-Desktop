//! The signed-in account's server data: the subscriptions feed
//! (`FEsubscriptions`), watch history (`FEhistory` + merge with this
//! device's plays), and Watch Later (`VLWL`).
//!
//! The server is the source of truth on all three surfaces. The local
//! subscriptions setting and the local `watch_history` table stay as
//! fallback caches only: a subscribe/unsubscribe the server confirms
//! updates the cached subscription list so the rotation lane does not
//! keep showing a channel the account just left, and a server-confirmed
//! history clear wipes the local rows with it.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::SqlitePool;
use tauri::State;
use tracing::warn;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::extractors::server_feed::{
    FE_HISTORY, FE_SUBSCRIPTIONS, LikedVideosPage, MergedHistoryEntry, ServerFeedPage,
    ServerHistoryEntry, ServerHistoryPage, WatchLaterPage, merge_history_entries,
    server_history_entries,
};
use crate::db::watch_history;
use crate::errors::{AppResult, ErrorResponse};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// One page of the account's subscriptions feed (`FEsubscriptions`):
/// the latest videos from subscribed channels, the channel rail, and
/// the token for the next page. Empty while signed out.
#[tauri::command]
pub async fn get_server_subscriptions(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
) -> Result<ServerFeedPage, ErrorResponse> {
    extractor
        .browse_server_feed(FE_SUBSCRIPTIONS, continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// One page of the Home feed (`FEwhat_to_watch`): the signed-in
/// account's personal feed when signed in, YouTube's generic feed when
/// signed out. `params` selects a server chip; `continuation` pages it.
#[tauri::command]
pub async fn get_server_home_feed(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
    params: Option<String>,
) -> Result<ServerFeedPage, ErrorResponse> {
    extractor
        .browse_home_feed(continuation.as_deref(), params.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// Likes or unlikes a video on the account, on the server. Disliking is
/// the same call with `liked = false`: there is no account dislike
/// endpoint — a dislike at least removes the account like, as Android does.
/// `params` is the button-issued token from the watch answer, when the
/// video's details carried one.
#[tauri::command]
pub async fn set_video_liked(
    extractor: State<'_, Arc<InnertubeClient>>,
    video_id: String,
    liked: bool,
    params: Option<String>,
) -> Result<bool, ErrorResponse> {
    extractor
        .set_video_liked(&video_id, liked, params.as_deref())
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Subscribes or unsubscribes the account to a channel, on the server.
/// Returns whether the server confirmed it. A confirmed change updates
/// the local subscriptions cache (fallback only) so the rotation lane
/// follows the account; the cache write is best-effort and never fails
/// a confirmed server change.
#[tauri::command]
pub async fn set_channel_subscribed(
    pool: State<'_, SqlitePool>,
    extractor: State<'_, Arc<InnertubeClient>>,
    channel_id: String,
    subscribed: bool,
) -> Result<bool, ErrorResponse> {
    if subscribed {
        extractor
            .subscribe_channel(&channel_id)
            .await
            .map_err(ErrorResponse::from)?;
    } else {
        extractor
            .unsubscribe_channel(&channel_id)
            .await
            .map_err(ErrorResponse::from)?;
    }
    if let Err(error) = update_local_subscriptions_cache(&pool, &channel_id, subscribed).await {
        warn!(%error, "server subscription confirmed but the local cache was not updated");
    }
    Ok(true)
}

/// The cached subscription list follows a confirmed server change.
/// Entries are `{"id", "name"}` objects (the shape the subscriptions
/// store reads); a list stored as plain id strings keeps that shape.
async fn update_local_subscriptions_cache(
    pool: &SqlitePool,
    channel_id: &str,
    subscribed: bool,
) -> AppResult<()> {
    let stored = crate::db::settings::get_setting(pool, "subscriptions").await?;
    let mut channels: Vec<serde_json::Value> = stored
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let as_strings =
        !channels.is_empty() && channels.iter().all(|entry| entry.as_str().is_some());
    let matches = |entry: &serde_json::Value| {
        entry
            .get("id")
            .and_then(|id| id.as_str())
            .is_some_and(|id| id == channel_id)
            || entry.as_str().is_some_and(|id| id == channel_id)
    };
    if subscribed {
        if !channels.iter().any(matches) {
            channels.push(if as_strings {
                serde_json::Value::String(channel_id.to_string())
            } else {
                serde_json::json!({ "id": channel_id, "name": "" })
            });
        }
    } else {
        channels.retain(|entry| !matches(entry));
    }
    crate::db::settings::set_setting(
        pool,
        "subscriptions",
        &serde_json::to_string(&channels).unwrap_or_default(),
    )
    .await
}

/// One page of the account's watch history (`FEhistory`), newest first,
/// as flat entries the History screen renders. The server sends no
/// per-item watch time, so entries keep the page order with descending
/// stamps. `clear_history_token` is the Clear-all token this page
/// carried, if the server sent one.
#[tauri::command]
pub async fn get_server_history(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
) -> Result<ServerHistoryPage, ErrorResponse> {
    let page = extractor
        .browse_server_feed(FE_HISTORY, continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)?;
    Ok(ServerHistoryPage {
        entries: server_history_entries(&page, now_ms()),
        continuation: page.continuation,
        clear_history_token: page.clear_history_token,
    })
}

/// Merges server history entries with this device's session plays,
/// interleaved by best-known watch time: a just-watched video sits at the
/// top, as Android's `mergeHistoryOrder` does. A server row keeps the local
/// resume position when this device has one.
#[tauri::command]
pub async fn merge_watch_history(
    pool: State<'_, SqlitePool>,
    server_entries: Vec<ServerHistoryEntry>,
) -> Result<Vec<MergedHistoryEntry>, ErrorResponse> {
    let local = watch_history::get_watch_history(&pool, 1000, 0)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(merge_history_entries(server_entries, &local))
}

/// Clears the account's watch history on the server and, once the server
/// confirms, wipes the local rows with it. The Clear-all token when the
/// last history page carried one, else every entry's own remove token.
/// Returns false when there was no token to send (the server list would
/// come back on the next refresh, so the local rows stay too) or the
/// server refused.
#[tauri::command]
pub async fn clear_server_history(
    extractor: State<'_, Arc<InnertubeClient>>,
    pool: State<'_, SqlitePool>,
    clear_token: Option<String>,
    remove_tokens: Vec<String>,
) -> Result<bool, ErrorResponse> {
    let tokens: Vec<String> = match clear_token.filter(|token| !token.is_empty()) {
        Some(token) => vec![token],
        None => remove_tokens
            .into_iter()
            .filter(|token| !token.is_empty())
            .collect(),
    };
    if tokens.is_empty() {
        return Ok(false);
    }
    let mut confirmed = true;
    for chunk in tokens.chunks(50) {
        if !extractor
            .send_history_feedback(chunk)
            .await
            .map_err(ErrorResponse::from)?
        {
            confirmed = false;
            break;
        }
    }
    if confirmed {
        watch_history::clear_watch_history(&pool)
            .await
            .map_err(ErrorResponse::from)?;
    }
    Ok(confirmed)
}

/// One page of the account's Watch Later playlist (`VLWL`), with each
/// row's playlist-entry id for removal.
#[tauri::command]
pub async fn get_watch_later(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
) -> Result<WatchLaterPage, ErrorResponse> {
    extractor
        .browse_watch_later(continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// Saves or unsaves a video in Watch Later, on the server. Removing
/// needs the playlist-entry id (`setVideoId`) from the Watch Later page.
#[tauri::command]
pub async fn set_video_watch_later(
    extractor: State<'_, Arc<InnertubeClient>>,
    video_id: String,
    saved: bool,
    set_video_id: Option<String>,
) -> Result<bool, ErrorResponse> {
    extractor
        .set_watch_later(&video_id, saved, set_video_id.as_deref())
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// One page of the account's own playlists (`FEplaylist_aggregation`),
/// in the server's order. Empty while signed out.
#[tauri::command]
pub async fn get_server_playlists(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
) -> Result<ServerFeedPage, ErrorResponse> {
    extractor
        .browse_server_playlists(continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// One page of the account's Liked-videos playlist (`VLLL`), newest
/// liked first as the server lists them. Empty while signed out.
#[tauri::command]
pub async fn get_liked_videos(
    extractor: State<'_, Arc<InnertubeClient>>,
    continuation: Option<String>,
) -> Result<LikedVideosPage, ErrorResponse> {
    extractor
        .browse_liked_videos(continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// Creates a playlist on the account and returns its id, as Android's
/// `PlaylistsViewModel.createPlaylist` does. The playlist is private.
#[tauri::command]
pub async fn create_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    title: String,
) -> Result<String, ErrorResponse> {
    extractor
        .create_playlist(&title)
        .await
        .map_err(ErrorResponse::from)
}

/// Deletes a playlist from the account, as Android's
/// `PlaylistsViewModel.deletePlaylist` does.
#[tauri::command]
pub async fn delete_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
) -> Result<bool, ErrorResponse> {
    extractor
        .delete_playlist(&playlist_id)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Renames a playlist on the account. The account API renames only; the
/// description stays as the account has it, as Android does.
#[tauri::command]
pub async fn rename_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
    name: String,
) -> Result<bool, ErrorResponse> {
    extractor
        .rename_playlist(&playlist_id, &name)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Adds one video to a playlist on the account, as Android's
/// `YouTube.addToPlaylist` does. Watch Later goes to the main site, other
/// playlists to the music host first.
#[tauri::command]
pub async fn add_video_to_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
    video_id: String,
) -> Result<bool, ErrorResponse> {
    extractor
        .add_videos_to_playlist(&playlist_id, &[video_id])
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Removes one video from a playlist on the account, as Android's
/// `YouTube.removeFromPlaylist` does. The entry id is read from a fresh
/// playlist fetch, so the caller only needs the video id.
#[tauri::command]
pub async fn remove_video_from_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
    video_id: String,
) -> Result<bool, ErrorResponse> {
    extractor
        .remove_videos_from_playlist(&playlist_id, &[video_id])
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Adds videos to a playlist on the account in one call, as Android's
/// `addVideosToPlaylist` does. Returns the ids the server took.
#[tauri::command]
pub async fn add_videos_to_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
    video_ids: Vec<String>,
) -> Result<Vec<String>, ErrorResponse> {
    extractor
        .add_videos_to_playlist(&playlist_id, &video_ids)
        .await
        .map_err(ErrorResponse::from)
}

/// Removes videos from a playlist on the account in one call, as
/// Android's `removeVideosFromPlaylist` does. Returns the ids removed;
/// an id the playlist no longer carries is left out.
#[tauri::command]
pub async fn remove_videos_from_server_playlist(
    extractor: State<'_, Arc<InnertubeClient>>,
    playlist_id: String,
    video_ids: Vec<String>,
) -> Result<Vec<String>, ErrorResponse> {
    extractor
        .remove_videos_from_playlist(&playlist_id, &video_ids)
        .await
        .map_err(ErrorResponse::from)
}
