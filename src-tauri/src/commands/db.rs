use crate::api::innertube::core::{locale, remote_decoder};
use crate::api::innertube::extractors::audio_preference;
use crate::api::{app_proxy, ip_family};
use crate::db::settings;
use crate::db::watch_history::{self, WatchHistoryRecord};
use crate::errors::{AppError, ErrorResponse};
use sqlx::SqlitePool;
use tauri::State;

#[tauri::command]
pub async fn get_watch_history(
    limit: i64,
    offset: i64,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_watch_history(&pool, limit, offset)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_history(
    limit: i64,
    offset: i64,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_music_history(&pool, limit, offset)
        .await
        .map_err(ErrorResponse::from)
}

/// The real number of history records, for the Data tab's count.
#[tauri::command]
pub async fn get_watch_history_count(
    pool: State<'_, SqlitePool>,
) -> Result<i64, ErrorResponse> {
    watch_history::count_watch_history(&pool)
        .await
        .map_err(ErrorResponse::from)
}

/// `watch_history` is a sync collection, and a file on this computer means nothing on a phone.
fn refuse_local_files(records: &[WatchHistoryRecord]) -> Result<(), ErrorResponse> {
    if records
        .iter()
        .any(|record| crate::local_media::is_local_id(&record.video_id))
    {
        return Err(ErrorResponse::from(AppError::Validation(
            "A local file can't enter watch history".into(),
        )));
    }
    Ok(())
}

/// `progress` marks the position a player saves every few seconds while it plays.
#[tauri::command]
pub async fn add_watch_record(
    record: WatchHistoryRecord,
    progress: Option<bool>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    let _ = progress;
    refuse_local_files(std::slice::from_ref(&record))?;
    watch_history::upsert_watch_record(&pool, &record)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(())
}

/// Undo of a removal, which unlike a new watch must beat the deletion it takes back.
#[tauri::command]
pub async fn restore_watch_record(
    record: WatchHistoryRecord,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    refuse_local_files(std::slice::from_ref(&record))?;
    watch_history::upsert_watch_record(&pool, &record)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(())
}

#[tauri::command]
pub async fn add_watch_records_bulk(
    records: Vec<WatchHistoryRecord>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    refuse_local_files(&records)?;
    watch_history::upsert_watch_records_bulk(&pool, &records)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_watch_record(
    video_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::delete_watch_record(&pool, &video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_watch_records(
    video_ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_watch_records(&pool, &video_ids)
        .await
        .map_err(ErrorResponse::from)
}

/// How far each video was watched, for the progress bar on every card.
#[tauri::command]
pub async fn get_watch_progress(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<(String, i64, i64)>, ErrorResponse> {
    watch_history::watch_progress(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_watch_history_years(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<i64>, ErrorResponse> {
    watch_history::watch_history_years(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_short_watch_records(
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::delete_short_watch_records(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_watch_history(
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::clear_watch_history(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn reset_app_data(pool: State<'_, SqlitePool>) -> Result<(), ErrorResponse> {
    crate::recap::store::clear(&pool).await.map_err(ErrorResponse::from)?;
    watch_history::clear_watch_history(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    crate::db::local_media::clear_plays(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    for key in ["subscriptions", "user_playlists"] {
        settings::set_setting(&pool, key, "[]")
            .await
            .map_err(ErrorResponse::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_setting(
    key: String,
    pool: State<'_, SqlitePool>,
) -> Result<Option<String>, ErrorResponse> {
    settings::get_setting(&pool, &key)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn set_setting(
    key: String,
    value: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    settings::set_setting(&pool, &key, &value)
        .await
        .map_err(ErrorResponse::from)?;
    apply_backend_setting(&key, Some(&value));
    Ok(())
}

/// Settings the backend acts on itself, applied at startup and whenever saved.
pub(crate) const BACKEND_SETTINGS: [&str; 11] = [
    remote_decoder::SETTING_KEY,
    audio_preference::STABLE_VOLUME_SETTING,
    locale::CONTENT_LANGUAGE_SETTING,
    locale::CONTENT_COUNTRY_SETTING,
    app_proxy::ENABLED_SETTING,
    app_proxy::TYPE_SETTING,
    app_proxy::HOST_SETTING,
    app_proxy::PORT_SETTING,
    app_proxy::USERNAME_SETTING,
    app_proxy::PASSWORD_SETTING,
    ip_family::PREFER_IPV4_SETTING,
];

pub(crate) fn apply_backend_setting(key: &str, value: Option<&str>) {
    if app_proxy::apply_setting(key, value) || ip_family::apply_setting(key, value) {
        return;
    }
    let enabled = value.is_some_and(|value| value.eq_ignore_ascii_case("true"));
    if key == remote_decoder::SETTING_KEY {
        // On unless turned off, as on the Android app: it is the only way past a walled visitor.
        remote_decoder::set_enabled(value.is_none_or(|value| value.eq_ignore_ascii_case("true")));
    } else if key == audio_preference::STABLE_VOLUME_SETTING {
        audio_preference::set_stable_volume(enabled);
    } else if key == locale::CONTENT_LANGUAGE_SETTING {
        locale::set_content_language(value);
    } else if key == locale::CONTENT_COUNTRY_SETTING {
        locale::set_content_country(value);
    }
}

/// Cards seen in a list the ranker does not learn from (the Watch page's related videos): kept
/// only so "Hide videos you've already seen" can leave them out.
#[tauri::command]
pub async fn record_seen_videos(
    ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    crate::db::seen_videos::remember(&pool, &ids, chrono::Utc::now().timestamp_millis())
        .await
        .map_err(ErrorResponse::from)
}

/// Which of these videos were already seen.
#[tauri::command]
pub async fn seen_video_ids_among(
    ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<String>, ErrorResponse> {
    crate::db::seen_videos::among(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)
}

/// Blocks a channel: its name is kept in the blocked-names table so Hidden
/// channels can show it without a lookup, and Shorts seeds skip it.
#[tauri::command]
pub async fn block_channel(
    channel_id: String,
    channel_name: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if let Some(name) = channel_name {
        crate::services::blocked_channel_names::remember(&pool, &channel_id, &name)
            .await
            .map_err(ErrorResponse::from)?;
    }
    Ok(())
}

/// Lets a blocked channel back into every feed.
#[tauri::command]
pub async fn unblock_channel(
    channel_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    crate::services::blocked_channel_names::forget(&pool, &channel_id)
        .await
        .map_err(ErrorResponse::from)
}
