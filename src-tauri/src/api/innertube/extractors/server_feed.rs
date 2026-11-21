//! The signed-in account's server feeds: subscriptions (`FEsubscriptions`),
//! watch history (`FEhistory`) and Watch Later (`VLWL`), plus the server
//! actions on them — subscribe/unsubscribe, history feedback tokens and
//! Watch Later edits.
//!
//! Mirrors the Android app's `YouTube.serverBrowse` / `ServerFeedPage`:
//! a browse response (or one of its continuation payloads) is walked whole
//! and every array is offered to the shared feed-item parsers, because the
//! item containers differ per surface (section lists on subscriptions and
//! history, shelves for Shorts). The page continuation is the last token
//! found. History's Clear-all token and each video's remove token come from
//! the DELETE controls' feedback endpoints, exactly as youtubei.js reads
//! them (`History.clearWatchHistory` / `removeVideo`).
//!
//! The account's own playlists use `FEplaylist_aggregation`; Watch Later is
//! browsed as the `VLWL` playlist through the playlist extractor.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::short_video_summary_from_item;
use crate::api::innertube::extractors::channel::{channel_summary, playlist_summary};
use crate::api::innertube::extractors::playlist::{
    extract_playlist_browse_parts, extract_playlist_title, video_summary_from_short,
};
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::api::innertube::renderers::lockup::{lockup_item, related_to_video};
use crate::api::innertube::renderers::video::video_from_item;
use crate::db::watch_history::WatchHistoryRecord;
use crate::errors::{AppError, AppResult};
use crate::models::channel::{ChannelSummary, PlaylistSummary};
use crate::models::video::VideoSummary;
use crate::security::validation::{validate_channel_id, validate_video_id};

/// The subscriptions feed.
pub const FE_SUBSCRIPTIONS: &str = "FEsubscriptions";
/// The watch-history feed.
pub const FE_HISTORY: &str = "FEhistory";
/// The Home feed.
pub const FE_WHAT_TO_WATCH: &str = "FEwhat_to_watch";
/// Watch Later, addressed as a playlist.
pub const WATCH_LATER_ID: &str = "WL";

/// A topic chip exactly as the server feed offers it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerChip {
    pub label: String,
    pub params: Option<String>,
}

/// One page of a server-driven feed — subscriptions or history. Items keep
/// the server's own order; nothing here is ranked or mixed locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFeedPage {
    #[serde(default)]
    pub videos: Vec<VideoSummary>,
    #[serde(default)]
    pub shorts: Vec<VideoSummary>,
    /// Channels the surface carries (the subscriptions page's channel rail).
    #[serde(default)]
    pub channels: Vec<ChannelSummary>,
    /// Playlists the surface carries (the account playlists page).
    #[serde(default)]
    pub playlists: Vec<PlaylistSummary>,
    #[serde(default)]
    pub chips: Vec<ServerChip>,
    pub continuation: Option<String>,
    /// History only: the Clear-all button's feedback token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear_history_token: Option<String>,
    /// History only: each video's own remove token, by video id.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub remove_tokens: HashMap<String, String>,
}

/// One Watch Later row: the video plus the playlist-entry id the server
/// needs to remove it (`ACTION_REMOVE_VIDEO` takes `setVideoId`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLaterItem {
    pub video: VideoSummary,
    pub set_video_id: Option<String>,
}

/// One page of the server's Watch Later playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLaterPage {
    pub title: String,
    #[serde(default)]
    pub videos: Vec<WatchLaterItem>,
    pub continuation: Option<String>,
}

/// One server-history row, as the History screen renders it. The server
/// orders newest-first but sends no per-item watch time, so `timestamp_ms`
/// is synthesized at fetch time to keep that order with descending stamps
/// (Android's `HistoryViewModel.loadServerHistory` does the same).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHistoryEntry {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    #[serde(default)]
    pub is_short: bool,
    pub remove_feedback_token: Option<String>,
    pub timestamp_ms: i64,
}

/// One page of server history, as flat entries the screen already renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHistoryPage {
    #[serde(default)]
    pub entries: Vec<ServerHistoryEntry>,
    pub continuation: Option<String>,
    pub clear_history_token: Option<String>,
}

/// Where a merged history row came from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HistoryEntrySource {
    Server,
    Local,
}

/// One row of the merged history: the server list as base, session plays
/// merged in. A server row keeps the local resume position when this
/// device has one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedHistoryEntry {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    /// Seconds watched on this device, 0 when only the server knows the row.
    pub position_seconds: i64,
    #[serde(default)]
    pub is_short: bool,
    pub timestamp_ms: i64,
    pub source: HistoryEntrySource,
    pub remove_feedback_token: Option<String>,
}

enum FeedItem {
    Video(VideoSummary),
    Short(VideoSummary),
    Channel(ChannelSummary),
    Playlist(PlaylistSummary),
}

/// One array element as a feed item, whatever renderer carries it.
fn feed_item(node: &Value) -> Option<FeedItem> {
    let node = node
        .get("richItemRenderer")
        .map_or(node, |rich| &rich["content"]);
    if node.get("continuationItemRenderer").is_some()
        || node.get("continuationItemViewModel").is_some()
    {
        return None;
    }
    if let Some(video) = video_from_item(node) {
        return Some(FeedItem::Video(video));
    }
    if let Some(lockup) = node.get("lockupViewModel") {
        return match lockup["contentType"].as_str().unwrap_or("") {
            "LOCKUP_CONTENT_TYPE_VIDEO" => {
                let item = lockup_item(lockup)?;
                (item.item_type == "video").then(|| FeedItem::Video(related_to_video(item)))
            }
            "LOCKUP_CONTENT_TYPE_PLAYLIST" | "LOCKUP_CONTENT_TYPE_PODCAST"
            | "LOCKUP_CONTENT_TYPE_ALBUM" | "LOCKUP_CONTENT_TYPE_COURSE" => {
                let item = lockup_item(lockup)?;
                Some(FeedItem::Playlist(PlaylistSummary {
                    id: item.playlist_id.clone().unwrap_or(item.id),
                    title: item.title,
                    thumbnail_url: item.thumbnail_url,
                    video_count_text: item.view_count_text,
                }))
            }
            "LOCKUP_CONTENT_TYPE_CHANNEL" => {
                channel_from_lockup(lockup).map(FeedItem::Channel)
            }
            _ => None,
        };
    }
    if let Some(channel) = node
        .get("gridChannelRenderer")
        .or_else(|| node.get("channelRenderer"))
        .and_then(channel_summary)
    {
        return Some(FeedItem::Channel(channel));
    }
    if let Some(playlist) = node
        .get("gridPlaylistRenderer")
        .or_else(|| node.get("playlistRenderer"))
        .and_then(playlist_summary)
    {
        return Some(FeedItem::Playlist(playlist));
    }
    short_video_summary_from_item(node).map(|short| FeedItem::Short(video_summary_from_short(short)))
}

/// A channel lockup: id and name from the lockup itself, avatar from its
/// image, subscriber text from the metadata row that carries it.
fn channel_from_lockup(lockup: &Value) -> Option<ChannelSummary> {
    let channel_id = lockup["contentId"]
        .as_str()
        .filter(|id| !id.is_empty())?
        .to_string();
    let metadata = &lockup["metadata"]["lockupMetadataViewModel"];
    let name = metadata["title"]["content"]
        .as_str()
        .filter(|text| !text.is_empty())?
        .to_string();
    let avatar_url = largest_url(
        &metadata["image"]["decoratedAvatarViewModel"]["avatar"]["avatarViewModel"]["image"]
            ["sources"],
    )
    .or_else(|| largest_url(&lockup["contentImage"]["thumbnailViewModel"]["image"]["sources"]))
    .map(|url| normalize_youtube_image_url(&url));
    let subscriber_count_text = metadata["metadata"]["contentMetadataViewModel"]["metadataRows"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["metadataParts"].as_array().into_iter().flatten())
        .filter_map(|part| part["text"]["content"].as_str())
        .find(|text| text.to_lowercase().contains("subscriber"))
        .map(ToOwned::to_owned);
    Some(ChannelSummary {
        channel_id,
        name,
        avatar_url,
        subscriber_count_text,
    })
}

/// The endpoint a button or menu item carries, whichever key the server used.
fn endpoint_object(node: &Value) -> Option<&Value> {
    let obj = node.as_object()?;
    obj.get("serviceEndpoint")
        .or_else(|| obj.get("navigationEndpoint"))
        .or_else(|| obj.get("command"))
}

/// The feedback token behind an endpoint object: direct, or behind the
/// confirm dialog youtubei.js unwraps for the history controls.
fn feedback_token_from_endpoint(endpoint: &Value) -> Option<String> {
    let obj = endpoint.as_object()?;
    for key in ["innertubeCommand", "command", "performOnceCommand", "serviceEndpoint"] {
        if let Some(inner) = obj.get(key) {
            return feedback_token_from_endpoint(inner);
        }
    }
    for key in ["serialCommand", "parallelCommand", "commandExecutorCommand"] {
        if let Some(first) = obj
            .get(key)
            .and_then(|command| command["commands"].as_array())
            .and_then(|commands| commands.first())
        {
            return feedback_token_from_endpoint(first);
        }
    }
    if let Some(token) = obj
        .get("feedbackEndpoint")
        .and_then(|feedback| feedback["feedbackToken"].as_str())
        .filter(|token| !token.is_empty())
    {
        return Some(token.to_string());
    }
    // The dialog's content wraps the confirm button in a renderer layer.
    let content = obj
        .get("confirmDialogEndpoint")
        .and_then(|endpoint| endpoint.get("content"))?;
    let confirm = content
        .get("confirmDialogRenderer")
        .and_then(|renderer| renderer.get("confirmEndpoint"))
        .or_else(|| content.get("confirmEndpoint"))?;
    feedback_token_from_endpoint(confirm)
}

/// One history item's own remove token, from its DELETE menu item: the old
/// video menu's service item, or the lockup sheet's list item (youtubei.js
/// `History.removeVideo`). `None` when the item carries no menu.
fn history_remove_token(node: &Value) -> Option<String> {
    match node {
        Value::Array(items) => items.iter().find_map(history_remove_token),
        Value::Object(map) => {
            if let Some(item) = map.get("menuServiceItemRenderer") {
                if item["icon"]["iconType"].as_str() == Some("DELETE")
                    && let Some(token) =
                        endpoint_object(item).and_then(feedback_token_from_endpoint)
                {
                    return Some(token);
                }
            }
            if let Some(item) = map.get("listItemViewModel") {
                let leading = item.get("leadingImage")?;
                let first_image = leading["thumbnails"]
                    .as_array()
                    .and_then(|images| images.first())
                    .or_else(|| leading["sources"].as_array().and_then(|images| images.first()));
                let image_name = first_image
                    .and_then(|image| image["clientResource"]["imageName"].as_str());
                if image_name == Some("DELETE") {
                    // The whole on-tap endpoint, not just its command: the
                    // feedback endpoint can sit directly on the tap object.
                    let on_tap = &item["rendererContext"]["commandContext"]["onTap"];
                    if let Some(token) = feedback_token_from_endpoint(on_tap) {
                        return Some(token);
                    }
                }
            }
            map.values().find_map(history_remove_token)
        }
        _ => None,
    }
}

fn chips_from(node: &Value) -> Option<Vec<ServerChip>> {
    let bar = node
        .get("feedFilterChipBarRenderer")
        .or_else(|| node.get("chipCloudRenderer"))?;
    let chips = bar["chips"].as_array()?;
    let parsed: Vec<ServerChip> = chips
        .iter()
        .filter_map(|chip| {
            let chip = chip.get("chipCloudChipRenderer")?;
            Some(ServerChip {
                label: text_of(&chip["text"])?,
                params: chip["navigationEndpoint"]["browseEndpoint"]["params"]
                    .as_str()
                    .map(ToOwned::to_owned),
            })
        })
        .collect();
    (!parsed.is_empty()).then_some(parsed)
}

#[derive(Default)]
struct Accumulator {
    videos: Vec<VideoSummary>,
    shorts: Vec<VideoSummary>,
    channels: Vec<ChannelSummary>,
    playlists: Vec<PlaylistSummary>,
    chips: Vec<ServerChip>,
    continuation: Option<String>,
    view_model_continuation: Option<String>,
    clear_history_token: Option<String>,
    remove_tokens: HashMap<String, String>,
    seen_videos: HashSet<String>,
    seen_channels: HashSet<String>,
    seen_playlists: HashSet<String>,
    no_icon_button_tokens: HashSet<String>,
}

impl Accumulator {
    fn push(&mut self, item: FeedItem, element: &Value) {
        match item {
            FeedItem::Video(video) => {
                let id = video.id.clone();
                if self.seen_videos.insert(id) {
                    if let Some(token) = history_remove_token(element) {
                        self.remove_tokens.insert(video.id.clone(), token);
                    }
                    self.videos.push(video);
                }
            }
            FeedItem::Short(short) => {
                if self.seen_videos.insert(short.id.clone()) {
                    self.shorts.push(short);
                }
            }
            FeedItem::Channel(channel) => {
                if self.seen_channels.insert(channel.channel_id.clone()) {
                    self.channels.push(channel);
                }
            }
            FeedItem::Playlist(playlist) => {
                if self.seen_playlists.insert(playlist.id.clone()) {
                    self.playlists.push(playlist);
                }
            }
        }
    }
}

/// Walk a browse response (or one of its continuation payloads) the way
/// Android's `toServerFeedPage` does: every array is offered to the
/// feed-item parsers, the page continuation is the last token found, and
/// the Clear-all control is only read outside feed items.
fn walk(node: &Value, in_item: bool, acc: &mut Accumulator) {
    match node {
        Value::Array(items) => {
            // Items carry their own DELETE menu items; the Clear-all control
            // lives outside them, so the clear search skips every subtree
            // that parsed to a feed item.
            let mut parsed_indices = HashSet::new();
            for (index, element) in items.iter().enumerate() {
                if let Some(item) = feed_item(element) {
                    parsed_indices.insert(index);
                    acc.push(item, element);
                }
            }
            for (index, element) in items.iter().enumerate() {
                walk(element, in_item || parsed_indices.contains(&index), acc);
            }
        }
        Value::Object(map) => {
            if !in_item && acc.clear_history_token.is_none() {
                if let Some(button) = map.get("buttonRenderer") {
                    match button["icon"]["iconType"].as_str() {
                        Some("DELETE") => {
                            if let Some(token) =
                                endpoint_object(button).and_then(feedback_token_from_endpoint)
                            {
                                acc.clear_history_token = Some(token);
                            }
                        }
                        // A text button (no icon) can still be Clear-all;
                        // only a single unambiguous one is ever trusted.
                        None => {
                            if let Some(token) =
                                endpoint_object(button).and_then(feedback_token_from_endpoint)
                            {
                                acc.no_icon_button_tokens.insert(token);
                            }
                        }
                        _ => {}
                    }
                }
                if let Some(item) = map.get("menuServiceItemRenderer") {
                    if item["icon"]["iconType"].as_str() == Some("DELETE")
                        && let Some(token) =
                            endpoint_object(item).and_then(feedback_token_from_endpoint)
                    {
                        acc.clear_history_token = Some(token);
                    }
                }
            }
            if let Some(token) = map
                .get("continuationItemRenderer")
                .and_then(|renderer| {
                    renderer["continuationEndpoint"]["continuationCommand"]["token"].as_str()
                })
                .filter(|token| !token.is_empty())
            {
                acc.continuation = Some(token.to_string());
            }
            if let Some(token) = map
                .get("nextContinuationData")
                .and_then(|data| data["continuation"].as_str())
                .filter(|token| !token.is_empty())
            {
                acc.continuation = Some(token.to_string());
            }
            if let Some(token) = map
                .get("continuationItemViewModel")
                .and_then(|view_model| {
                    view_model["continuationCommand"]["innertubeCommand"]["continuationCommand"]
                        ["token"]
                        .as_str()
                })
                .filter(|token| !token.is_empty())
            {
                acc.view_model_continuation = Some(token.to_string());
            }
            if acc.chips.is_empty()
                && let Some(chips) = chips_from(node)
            {
                acc.chips = chips;
            }
            for value in map.values() {
                walk(value, in_item, acc);
            }
        }
        _ => {}
    }
}

/// Reads a browse response (or one of its continuation payloads) into a
/// [`ServerFeedPage`].
#[must_use]
pub fn parse_server_feed_page(response: &Value) -> ServerFeedPage {
    let mut acc = Accumulator::default();
    walk(response, false, &mut acc);
    if acc.clear_history_token.is_none() && acc.no_icon_button_tokens.len() == 1 {
        acc.clear_history_token = acc.no_icon_button_tokens.into_iter().next();
    }
    ServerFeedPage {
        videos: acc.videos,
        shorts: acc.shorts,
        channels: acc.channels,
        playlists: acc.playlists,
        chips: acc.chips,
        continuation: acc.continuation.or(acc.view_model_continuation),
        clear_history_token: acc.clear_history_token,
        remove_tokens: acc.remove_tokens,
    }
}

/// Whether a `feedback` answer says every token was applied: one entry per
/// token, all processed. Android's `FeedbackResponse` shape.
#[must_use]
pub fn feedback_processed(response: &Value) -> bool {
    let Some(results) = response["feedbackResponses"].as_array() else {
        return false;
    };
    !results.is_empty()
        && results
            .iter()
            .all(|result| result["isProcessed"].as_bool().unwrap_or(false))
}

/// A server feed page as flat history entries, newest first. The server
/// sends no per-item watch time, so entries keep the page order with
/// tightly descending stamps from `now_ms`.
#[must_use]
pub fn server_history_entries(page: &ServerFeedPage, now_ms: i64) -> Vec<ServerHistoryEntry> {
    let mut entries = Vec::with_capacity(page.videos.len() + page.shorts.len());
    let mut index = 0i64;
    for video in page.videos.iter().chain(page.shorts.iter()) {
        entries.push(ServerHistoryEntry {
            video_id: video.id.clone(),
            title: video.title.clone(),
            channel_name: video.channel_name.clone(),
            channel_id: video.channel_id.clone(),
            thumbnail_url: video.thumbnail_url.clone(),
            duration_seconds: video.duration_seconds,
            is_short: video.is_short,
            remove_feedback_token: page.remove_tokens.get(&video.id).cloned(),
            timestamp_ms: now_ms - index * 1000,
        });
        index += 1;
    }
    entries
}

/// The `watch_date` of a local row as epoch milliseconds, 0 when it does
/// not parse (rows are stored as RFC 3339).
fn watch_date_ms(date: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .map(|parsed| parsed.timestamp_millis())
        .unwrap_or(0)
}

/// Merges the server history (base) with this device's session plays:
/// server entries first in server order, local-only plays appended
/// newest-first, deduped by video id. A server row keeps the local resume
/// position and length when this device has one.
#[must_use]
pub fn merge_history_entries(
    server: Vec<ServerHistoryEntry>,
    local: &[WatchHistoryRecord],
) -> Vec<MergedHistoryEntry> {
    let mut local_by_id: HashMap<&str, &WatchHistoryRecord> = HashMap::new();
    for record in local {
        local_by_id.insert(record.video_id.as_str(), record);
    }
    let mut merged: Vec<MergedHistoryEntry> = Vec::with_capacity(server.len() + local.len());
    let mut server_ids: HashSet<String> = HashSet::new();
    for entry in server {
        server_ids.insert(entry.video_id.clone());
        let played = local_by_id.get(entry.video_id.as_str());
        merged.push(MergedHistoryEntry {
            position_seconds: played.map_or(0, |record| record.watch_duration_seconds),
            duration_seconds: played
                .and_then(|record| {
                    record
                        .total_duration_seconds
                        .filter(|total| *total > 0)
                        .and_then(|total| u64::try_from(total).ok())
                })
                .or(entry.duration_seconds),
            video_id: entry.video_id,
            title: entry.title,
            channel_name: entry.channel_name,
            channel_id: entry.channel_id,
            thumbnail_url: entry.thumbnail_url,
            is_short: entry.is_short,
            timestamp_ms: entry.timestamp_ms,
            source: HistoryEntrySource::Server,
            remove_feedback_token: entry.remove_feedback_token,
        });
    }
    let mut local_only: Vec<&WatchHistoryRecord> = local
        .iter()
        .filter(|record| !server_ids.contains(record.video_id.as_str()))
        .collect();
    local_only.sort_by_key(|record| std::cmp::Reverse(watch_date_ms(&record.watch_date)));
    for record in local_only {
        merged.push(MergedHistoryEntry {
            video_id: record.video_id.clone(),
            title: record.title.clone(),
            channel_name: record.channel_name.clone().unwrap_or_default(),
            channel_id: record.channel_id.clone(),
            thumbnail_url: None,
            duration_seconds: record
                .total_duration_seconds
                .and_then(|total| u64::try_from(total).ok()),
            position_seconds: record.watch_duration_seconds,
            is_short: record.is_short_video(),
            timestamp_ms: watch_date_ms(&record.watch_date),
            source: HistoryEntrySource::Local,
            remove_feedback_token: None,
        });
    }
    merged
}

impl InnertubeClient {
    /// The signed-in session must exist: the server feeds are the account's
    /// own, and a guest browse of them answers with the anonymous page.
    pub(crate) fn require_signed_in(&self) -> AppResult<()> {
        if self
            .auth
            .as_ref()
            .is_none_or(|session| !session.is_signed_in())
        {
            return Err(AppError::Validation(
                "Not signed in — sign in with Google first to see the account's feed."
                    .to_string(),
            ));
        }
        Ok(())
    }

    /// One page of a server feed (`FEsubscriptions`, `FEhistory`, ...): the
    /// first page by browse id, later pages by continuation token. The WEB
    /// client, as Android's cookie-session browse does.
    pub async fn browse_server_feed(
        &self,
        browse_id: &str,
        continuation: Option<&str>,
    ) -> AppResult<ServerFeedPage> {
        self.require_signed_in()?;
        let mut payload = if let Some(token) = continuation {
            json!({ "continuation": token })
        } else {
            json!({ "browseId": browse_id })
        };
        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        Ok(parse_server_feed_page(&response))
    }

    /// One page of the Home feed (`FEwhat_to_watch`): the signed-in
    /// account's personal feed when a session exists, YouTube's generic
    /// feed when there is none. Unlike the account feeds this never
    /// requires sign-in — the anonymous page is the guest Home feed, and
    /// the transport sends the anonymous `SOCS=CAE=` cookie for it.
    /// `params` selects a server chip; `continuation` pages the feed.
    pub async fn browse_home_feed(
        &self,
        continuation: Option<&str>,
        params: Option<&str>,
    ) -> AppResult<ServerFeedPage> {
        let mut payload = if let Some(token) = continuation {
            json!({ "continuation": token })
        } else {
            let mut body = json!({ "browseId": FE_WHAT_TO_WATCH });
            if let Some(params) = params.filter(|params| !params.is_empty()) {
                body["params"] = json!(params);
            }
            body
        };
        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        Ok(parse_server_feed_page(&response))
    }

    /// Subscribes to a channel: `subscription/subscribe` with
    /// `{context, channelIds: [id]}` on WEB_REMIX, as Android does.
    /// Success is the call answering without an error.
    pub async fn subscribe_channel(&self, channel_id: &str) -> AppResult<()> {
        self.require_signed_in()?;
        validate_channel_id(channel_id)?;
        let mut payload = json!({ "channelIds": [channel_id] });
        self.post_innertube("subscription/subscribe", &clients::WEB_REMIX, &mut payload)
            .await?;
        Ok(())
    }

    /// Unsubscribes from a channel: `subscription/unsubscribe`, same shape.
    pub async fn unsubscribe_channel(&self, channel_id: &str) -> AppResult<()> {
        self.require_signed_in()?;
        validate_channel_id(channel_id)?;
        let mut payload = json!({ "channelIds": [channel_id] });
        self.post_innertube("subscription/unsubscribe", &clients::WEB_REMIX, &mut payload)
            .await?;
        Ok(())
    }

    /// Sends history feedback tokens to the main-site `feedback` endpoint
    /// (youtubei.js `History.clearWatchHistory` / `removeVideo`): the
    /// Clear-all token, or each video's own remove token. True only when
    /// the server says every token was processed — a local-only clear
    /// brings the whole list back on the next refresh.
    pub async fn send_history_feedback(&self, tokens: &[String]) -> AppResult<bool> {
        self.require_signed_in()?;
        if tokens.is_empty() {
            return Ok(false);
        }
        let mut payload = json!({ "feedbackTokens": tokens });
        let response = self
            .post_innertube("feedback", &clients::WEB, &mut payload)
            .await?;
        Ok(feedback_processed(&response))
    }

    /// Saves or unsaves a video in Watch Later: `browse/edit_playlist` on
    /// the main site with `{playlistId: "WL", actions: [...]}`. The music
    /// host answers a Watch Later edit with 401, so the edit goes to the
    /// main site directly (Android's device reports 17/19). Removing needs
    /// the playlist-entry id (`setVideoId`) from the Watch Later page.
    pub async fn set_watch_later(
        &self,
        video_id: &str,
        saved: bool,
        set_video_id: Option<&str>,
    ) -> AppResult<()> {
        self.require_signed_in()?;
        validate_video_id(video_id)?;
        let action = if saved {
            json!({ "action": "ACTION_ADD_VIDEO", "addedVideoId": video_id })
        } else {
            let set_video_id = set_video_id.filter(|id| !id.is_empty()).ok_or_else(|| {
                AppError::Validation(
                    "Removing a video from Watch Later needs its playlist entry id — open the Watch Later page first so the entry id is known."
                        .to_string(),
                )
            })?;
            json!({
                "action": "ACTION_REMOVE_VIDEO",
                "setVideoId": set_video_id,
                "removedVideoId": video_id,
            })
        };
        let mut payload = json!({ "playlistId": WATCH_LATER_ID, "actions": [action] });
        self.post_innertube("browse/edit_playlist", &clients::WEB, &mut payload)
            .await?;
        Ok(())
    }

    /// One page of the server's Watch Later playlist (`VLWL` browse), with
    /// each row's playlist-entry id for removal.
    pub async fn browse_watch_later(
        &self,
        continuation: Option<&str>,
    ) -> AppResult<WatchLaterPage> {
        self.require_signed_in()?;
        let mut payload = if let Some(token) = continuation {
            json!({ "continuation": token })
        } else {
            json!({ "browseId": "VLWL" })
        };
        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        let (videos, set_ids, next_page_token) = extract_playlist_browse_parts(&response);
        let title = extract_playlist_title(&response);
        Ok(WatchLaterPage {
            title: if title == "Unknown Playlist" {
                "Watch Later".to_string()
            } else {
                title
            },
            videos: videos
                .into_iter()
                .zip(set_ids)
                .map(|(video, set_video_id)| WatchLaterItem {
                    video,
                    set_video_id,
                })
                .collect(),
            continuation: next_page_token,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn section(contents: Vec<Value>) -> Value {
        json!({ "itemSectionRenderer": { "contents": contents } })
    }

    fn feed_page(sections: Vec<Value>) -> Value {
        json!({ "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [{ "tabRenderer": {
            "content": { "sectionListRenderer": { "contents": sections } }
        }}]}}})
    }

    fn lockup_video(id: &str, title: &str) -> Value {
        json!({ "richItemRenderer": { "content": { "lockupViewModel": {
            "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
            "contentId": id,
            "metadata": { "lockupMetadataViewModel": {
                "title": { "content": title },
                "metadata": { "contentMetadataViewModel": { "metadataRows": [
                    { "metadataParts": [{ "text": { "content": "Channel" } }] },
                    { "metadataParts": [{ "text": { "content": "1.2M views" } }] }
                ] } }
            } }
        }}}})
    }

    #[test]
    fn subs_page_reads_videos_channels_and_the_token() {
        let page = feed_page(vec![
            section(vec![
                lockup_video("vid00000001", "First"),
                json!({ "richItemRenderer": { "content": { "videoRenderer": {
                    "videoId": "vid00000002",
                    "title": { "runs": [{ "text": "Second" }] },
                    "ownerText": { "runs": [{ "text": "Chan", "navigationEndpoint": {
                        "browseEndpoint": { "browseId": "UCchan" } } }] },
                    "lengthText": { "simpleText": "3:21" }
                } } } }),
                json!({ "channelRenderer": {
                    "channelId": "UCrail",
                    "title": { "simpleText": "Rail Channel" },
                    "thumbnail": { "thumbnails": [{ "url": "https://yt3.ggpht.com/a=s88", "width": 88 }] },
                    "subscriberCountText": { "simpleText": "1.2M subscribers" }
                } }),
                json!({ "continuationItemRenderer": { "continuationEndpoint": {
                    "continuationCommand": { "token": "NEXT_PAGE" } } } }),
            ]),
            section(vec![json!({ "richItemRenderer": { "content": {
                "feedFilterChipBarRenderer": { "chips": [
                    { "chipCloudChipRenderer": { "text": { "simpleText": "All" } } }
                ] }
            } } })]),
        ]);
        let parsed = parse_server_feed_page(&page);
        assert_eq!(parsed.videos.len(), 2);
        assert_eq!(parsed.videos[0].id, "vid00000001");
        assert_eq!(parsed.videos[1].channel_id.as_deref(), Some("UCchan"));
        assert_eq!(parsed.channels.len(), 1);
        assert_eq!(parsed.channels[0].channel_id, "UCrail");
        assert_eq!(parsed.channels[0].subscriber_count_text.as_deref(), Some("1.2M subscribers"));
        assert_eq!(parsed.continuation.as_deref(), Some("NEXT_PAGE"));
        assert_eq!(parsed.chips.len(), 1);
        assert_eq!(parsed.chips[0].label, "All");
    }

    #[test]
    fn continuation_pages_read_items_from_the_append_action() {
        let response = json!({
            "onResponseReceivedActions": [{ "appendContinuationItemsAction": { "continuationItems": [
                lockup_video("vid00000101", "Later"),
                json!({ "continuationItemViewModel": { "continuationCommand": {
                    "innertubeCommand": { "continuationCommand": { "token": "PAGE3" } } } } }),
            ]}}]
        });
        let parsed = parse_server_feed_page(&response);
        assert_eq!(parsed.videos.len(), 1);
        assert_eq!(parsed.videos[0].id, "vid00000101");
        assert_eq!(parsed.continuation.as_deref(), Some("PAGE3"));
    }

    #[test]
    fn repeated_videos_across_pages_dedupe() {
        let page = feed_page(vec![section(vec![
            lockup_video("vid00000001", "One"),
            lockup_video("vid00000001", "One again"),
        ])]);
        assert_eq!(parse_server_feed_page(&page).videos.len(), 1);
    }

    fn delete_button(token: &str) -> Value {
        json!({ "buttonRenderer": {
            "icon": { "iconType": "DELETE" },
            "text": { "simpleText": "Clear all watch history" },
            "command": { "clickTrackingParams": "x", "commandMetadata": {},
                "confirmDialogEndpoint": { "content": { "confirmDialogRenderer": {
                    "confirmEndpoint": { "clickTrackingParams": "y",
                        "feedbackEndpoint": { "feedbackToken": token } }
                } } } }
        } })
    }

    #[test]
    fn history_page_carries_the_clear_token_and_remove_tokens() {
        let video = json!({ "videoRenderer": {
            "videoId": "vid00000001",
            "title": { "runs": [{ "text": "Watched" }] },
            "menu": { "menuRenderer": { "items": [
                { "menuServiceItemRenderer": {
                    "text": { "simpleText": "Remove from watch history" },
                    "icon": { "iconType": "DELETE" },
                    "serviceEndpoint": { "clickTrackingParams": "z",
                        "feedbackEndpoint": { "feedbackToken": "REMOVE_1" } }
                } }
            ] } }
        } });
        let page = json!({
            "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [{ "tabRenderer": {
                "content": { "sectionListRenderer": { "contents": [
                    { "browseFeedActionsRenderer": { "contents": [delete_button("CLEAR_ALL")] } },
                    section(vec![video]),
                ] } }
            }}]}}
        });
        let parsed = parse_server_feed_page(&page);
        assert_eq!(parsed.clear_history_token.as_deref(), Some("CLEAR_ALL"));
        assert_eq!(
            parsed.remove_tokens.get("vid00000001").map(String::as_str),
            Some("REMOVE_1")
        );
        assert_eq!(parsed.videos.len(), 1);
    }

    #[test]
    fn feedback_counts_only_when_every_token_processed() {
        assert!(feedback_processed(
            &json!({ "feedbackResponses": [{ "isProcessed": true }, { "isProcessed": true }] })
        ));
        assert!(!feedback_processed(
            &json!({ "feedbackResponses": [{ "isProcessed": true }, { "isProcessed": false }] })
        ));
        assert!(!feedback_processed(&json!({ "feedbackResponses": [] })));
        assert!(!feedback_processed(&json!({})));
    }

    fn history_entry(id: &str, at_ms: i64) -> ServerHistoryEntry {
        ServerHistoryEntry {
            video_id: id.to_string(),
            title: id.to_string(),
            channel_name: String::new(),
            channel_id: None,
            thumbnail_url: None,
            duration_seconds: Some(100),
            is_short: false,
            remove_feedback_token: None,
            timestamp_ms: at_ms,
        }
    }

    fn local_row(id: &str, date: &str, watched: i64, total: i64) -> WatchHistoryRecord {
        WatchHistoryRecord {
            id: None,
            video_id: id.to_string(),
            title: id.to_string(),
            channel_name: None,
            channel_id: None,
            watch_date: date.to_string(),
            watch_duration_seconds: watched,
            total_duration_seconds: Some(total),
            is_music: false,
            is_short: false,
        }
    }

    #[test]
    fn merge_keeps_server_first_overlays_position_and_appends_local_only() {
        let server = vec![history_entry("a", 3000), history_entry("b", 2000)];
        let local = vec![
            local_row("a", "2026-11-21T10:00:00.000Z", 42, 100),
            local_row("c", "2026-11-21T12:00:00.000Z", 7, 60),
            local_row("d", "2026-11-21T09:00:00.000Z", 3, 30),
        ];
        let merged = merge_history_entries(server, &local);
        let ids: Vec<&str> = merged
            .iter()
            .map(|entry| entry.video_id.as_str())
            .collect();
        assert_eq!(ids, ["a", "b", "c", "d"]);
        assert_eq!(merged[0].source, HistoryEntrySource::Server);
        assert_eq!(merged[0].position_seconds, 42);
        assert_eq!(merged[0].duration_seconds, Some(100));
        assert_eq!(merged[2].source, HistoryEntrySource::Local);
        assert_eq!(merged[2].position_seconds, 7);
        assert_eq!(merged[3].video_id, "d");
    }

    #[test]
    fn server_history_entries_keep_page_order_with_descending_stamps() {
        let page = ServerFeedPage {
            videos: vec![
                VideoSummary {
                    id: "v1".to_string(),
                    ..Default::default()
                },
                VideoSummary {
                    id: "v2".to_string(),
                    ..Default::default()
                },
            ],
            shorts: vec![],
            channels: vec![],
            playlists: vec![],
            chips: vec![],
            continuation: None,
            clear_history_token: None,
            remove_tokens: HashMap::new(),
        };
        let entries = server_history_entries(&page, 1_000_000);
        assert_eq!(entries[0].timestamp_ms, 1_000_000);
        assert_eq!(entries[1].timestamp_ms, 999_000);
    }

    #[test]
    fn home_page_reads_shelf_shorts_chips_and_the_token() {
        let page = json!({
            "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [{ "tabRenderer": {
                "content": { "sectionListRenderer": { "contents": [
                    { "richItemRenderer": { "content": {
                        "feedFilterChipBarRenderer": { "chips": [
                            { "chipCloudChipRenderer": { "text": { "simpleText": "All" } } },
                            { "chipCloudChipRenderer": {
                                "text": { "simpleText": "Music" },
                                "navigationEndpoint": { "browseEndpoint": {
                                    "browseId": "FEwhat_to_watch", "params": "EgZtdXNpYw%3D%3D" } }
                            } },
                        ] }
                    } } },
                    section(vec![
                        lockup_video("vid00000001", "Home video"),
                        json!({ "richItemRenderer": { "content": { "reelItemRenderer": {
                            "videoId": "short000001",
                            "headline": { "simpleText": "A Short" },
                            "thumbnail": { "thumbnails": [{ "url": "https://i.ytimg.com/a.jpg" }] },
                            "viewCountText": { "simpleText": "1M views" }
                        } } } }),
                    ]),
                    { "continuationItemRenderer": { "continuationEndpoint": {
                        "continuationCommand": { "token": "HOME_NEXT" } } } },
                ] } }
            }}]}}
        });
        let parsed = parse_server_feed_page(&page);
        assert_eq!(parsed.videos.len(), 1);
        assert_eq!(parsed.videos[0].id, "vid00000001");
        assert_eq!(parsed.shorts.len(), 1);
        assert_eq!(parsed.shorts[0].id, "short000001");
        assert_eq!(parsed.chips.len(), 2);
        assert_eq!(parsed.chips[0].label, "All");
        assert_eq!(parsed.chips[0].params, None);
        assert_eq!(parsed.chips[1].label, "Music");
        assert_eq!(parsed.chips[1].params.as_deref(), Some("EgZtdXNpYw%3D%3D"));
        assert_eq!(parsed.continuation.as_deref(), Some("HOME_NEXT"));
    }
}
