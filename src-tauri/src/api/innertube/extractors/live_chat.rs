use base64::Engine;
use serde_json::Value;
use tracing::debug;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::extractors::watch_next;
use crate::api::innertube::json::thumbnail::largest_url;
use crate::api::innertube::transport::error::{TransportError, to_app_error};
use crate::errors::{AppError, AppResult};
use crate::models::live_chat::{LiveChatMessage, LiveChatResponse, LiveChatSegment};

const DEFAULT_POLL_MS: u64 = 2000;
const MIN_POLL_MS: u64 = 1000;
const MAX_POLL_MS: u64 = 15000;

fn parse_message_runs(message: &Value) -> (String, Vec<LiveChatSegment>) {
    let mut text = String::new();
    let mut segments = Vec::new();

    let Some(runs) = message["runs"].as_array() else {
        return (text, segments);
    };

    for run in runs {
        if let Some(run_text) = run["text"].as_str() {
            text.push_str(run_text);
            segments.push(LiveChatSegment {
                text: run_text.to_string(),
                emoji_image_url: None,
            });
        } else if let Some(emoji) = run.get("emoji") {
            let is_custom = emoji["isCustomEmoji"].as_bool().unwrap_or(false);
            let emoji_id = emoji["emojiId"].as_str().unwrap_or_default();

            if !is_custom && !emoji_id.is_empty() {
                text.push_str(emoji_id);
                segments.push(LiveChatSegment {
                    text: emoji_id.to_string(),
                    emoji_image_url: None,
                });
            } else {
                let shortcut = emoji["shortcuts"][0].as_str().unwrap_or(emoji_id);
                text.push_str(shortcut);
                segments.push(LiveChatSegment {
                    text: shortcut.to_string(),
                    emoji_image_url: largest_url(&emoji["image"]["thumbnails"]),
                });
            }
        }
    }

    (text, segments)
}

fn parse_renderer(renderer: &Value, message_type: &str) -> Option<LiveChatMessage> {
    let id = renderer["id"].as_str()?.to_string();

    let (message, segments) = {
        let (text, segs) = parse_message_runs(&renderer["message"]);
        if message_type == "membership" && text.trim().is_empty() {
            parse_message_runs(&renderer["headerSubtext"])
        } else {
            (text, segs)
        }
    };

    let mut is_owner = false;
    let mut is_moderator = false;
    let mut is_verified = false;
    let mut is_member = false;
    let mut member_badge_url = None;
    if let Some(badges) = renderer["authorBadges"].as_array() {
        for badge in badges {
            let badge_renderer = &badge["liveChatAuthorBadgeRenderer"];
            match badge_renderer["icon"]["iconType"]
                .as_str()
                .unwrap_or_default()
                .to_ascii_uppercase()
                .as_str()
            {
                "OWNER" => is_owner = true,
                "MODERATOR" => is_moderator = true,
                "VERIFIED" => is_verified = true,
                _ => {}
            }
            if let Some(url) = largest_url(&badge_renderer["customThumbnail"]["thumbnails"]) {
                is_member = true;
                member_badge_url = Some(url);
            }
        }
    }

    let author = renderer["authorName"]["simpleText"]
        .as_str()
        .or_else(|| renderer["authorName"]["runs"][0]["text"].as_str())
        .unwrap_or_default()
        .to_string();

    Some(LiveChatMessage {
        id,
        author,
        author_photo_url: largest_url(&renderer["authorPhoto"]["thumbnails"]),
        message,
        segments,
        timestamp: renderer["timestampText"]["simpleText"]
            .as_str()
            .map(ToOwned::to_owned),
        message_type: message_type.to_string(),
        is_owner,
        is_moderator,
        is_verified,
        is_member,
        member_badge_url,
        super_chat_amount: renderer["purchaseAmountText"]["simpleText"]
            .as_str()
            .map(ToOwned::to_owned),
        super_chat_argb: renderer["bodyBackgroundColor"].as_i64(),
        super_chat_header_argb: renderer["headerBackgroundColor"].as_i64(),
        video_offset_ms: None,
        menu_params: renderer["contextMenuEndpoint"]["liveChatItemContextMenuEndpoint"]["params"]
            .as_str()
            .map(ToOwned::to_owned),
        menu_api_url:
            renderer["contextMenuEndpoint"]["commandMetadata"]["webCommandMetadata"]["apiUrl"]
                .as_str()
                .map(ToOwned::to_owned),
    })
}

fn parse_chat_item(item: &Value) -> Option<LiveChatMessage> {
    if let Some(renderer) = item.get("liveChatTextMessageRenderer") {
        return parse_renderer(renderer, "text");
    }
    if let Some(renderer) = item.get("liveChatPaidMessageRenderer") {
        return parse_renderer(renderer, "superChat");
    }
    if let Some(renderer) = item.get("liveChatMembershipItemRenderer") {
        return parse_renderer(renderer, "membership");
    }
    None
}

/// One page of chat: its messages (a replay's with their offset into the
/// stream), the tokens that continue it, and when to ask again.
struct ChatPage {
    messages: Vec<LiveChatMessage>,
    next: Option<String>,
    seek: Option<String>,
    polling_interval_ms: u64,
    /// The view selector's "Top chat" and all-messages tokens, in that order.
    views: (Option<String>, Option<String>),
}

fn parse_live_chat_page(res: &Value) -> ChatPage {
    let continuation = &res["continuationContents"]["liveChatContinuation"];
    let continuations = continuation["continuations"].as_array();
    let token = |kind: &str| {
        continuations
            .into_iter()
            .flatten()
            .find_map(|entry| entry[kind]["continuation"].as_str())
            .map(ToOwned::to_owned)
    };
    let next = token("timedContinuationData")
        .or_else(|| token("invalidationContinuationData"))
        .or_else(|| token("reloadContinuationData"))
        .or_else(|| token("liveChatReplayContinuationData"));
    let polling_interval_ms = continuations
        .into_iter()
        .flatten()
        .find_map(|entry| {
            entry["timedContinuationData"]["timeoutMs"]
                .as_u64()
                .or_else(|| entry["invalidationContinuationData"]["timeoutMs"].as_u64())
        })
        .unwrap_or(DEFAULT_POLL_MS)
        .clamp(MIN_POLL_MS, MAX_POLL_MS);

    let mut messages = Vec::new();
    for action in continuation["actions"].as_array().into_iter().flatten() {
        if let Some(message) = parse_chat_item(&action["addChatItemAction"]["item"]) {
            messages.push(message);
            continue;
        }
        let replay = &action["replayChatItemAction"];
        let offset = replay["videoOffsetTimeMsec"]
            .as_str()
            .and_then(|offset| offset.parse().ok());
        for replayed in replay["actions"].as_array().into_iter().flatten() {
            if let Some(mut message) = parse_chat_item(&replayed["addChatItemAction"]["item"]) {
                message.video_offset_ms = offset;
                messages.push(message);
            }
        }
    }

    let views: Vec<Option<String>> = continuation["header"]["liveChatHeaderRenderer"]
        ["viewSelector"]["sortFilterSubMenuRenderer"]["subMenuItems"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| {
            item["continuation"]["reloadContinuationData"]["continuation"]
                .as_str()
                .map(ToOwned::to_owned)
        })
        .collect();

    ChatPage {
        messages,
        next,
        seek: token("playerSeekContinuationData"),
        polling_interval_ms,
        views: (
            views.first().cloned().flatten(),
            views.get(1).cloned().flatten(),
        ),
    }
}

impl InnertubeClient {
    /// A page of a video's chat. Without `continuation` the chat is seeded from
    /// the watch answer, which also says whether it is a replay. A replay is
    /// read at `replay_offset_ms` into the stream; a continuation passed with an
    /// offset is a replay's.
    pub async fn get_live_chat(
        &self,
        video_id: &str,
        continuation: Option<String>,
        replay_offset_ms: Option<u64>,
    ) -> AppResult<LiveChatResponse> {
        let video_id_trimmed = video_id.trim();
        let (token, is_replay) = if let Some(token) = continuation.filter(|token| !token.is_empty())
        {
            (token, replay_offset_ms.is_some())
        } else {
            let next = self.watch_next(video_id_trimmed).await?;
            let Some((seed, is_replay)) = watch_next::chat_seed(&next) else {
                debug!(video_id = %video_id_trimmed, "No live chat available");
                return Ok(LiveChatResponse {
                    messages: Vec::new(),
                    continuation: None,
                    polling_interval_ms: 0,
                    is_replay: false,
                    top_chat_continuation: None,
                    all_chat_continuation: None,
                    seek_continuation: None,
                });
            };
            (seed, is_replay)
        };

        let res = if is_replay {
            let mut payload = serde_json::json!({
                "continuation": token,
                "currentPlayerState": { "playerOffsetMs": replay_offset_ms.unwrap_or(0).to_string() },
            });
            self.post_innertube(
                "live_chat/get_live_chat_replay",
                &clients::WEB,
                &mut payload,
            )
            .await?
        } else {
            let mut payload = serde_json::json!({ "continuation": token });
            self.post_innertube("live_chat/get_live_chat", &clients::WEB, &mut payload)
                .await?
        };
        let page = parse_live_chat_page(&res);

        Ok(LiveChatResponse {
            messages: page.messages,
            continuation: page.next,
            polling_interval_ms: page.polling_interval_ms,
            is_replay,
            top_chat_continuation: page.views.0,
            all_chat_continuation: page.views.1,
            seek_continuation: page.seek,
        })
    }

    /// Posts one message to a live chat, as Android's `YouTube.sendLiveChatMessage`
    /// does: `live_chat/send_message` on the signed-in WEB client, one text segment,
    /// a fresh client message id, and the proto-encoded video/channel params.
    /// The answer carries `addChatItemAction` on success and sometimes
    /// `runAttestationCommand` (a bot challenge) instead of the message; both
    /// count as sent, since the attestation sends still post.
    pub async fn send_live_chat_message(
        &self,
        video_id: &str,
        channel_id: &str,
        text: &str,
    ) -> AppResult<()> {
        self.require_signed_in()?;
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::Validation(
                "Write something before posting to live chat.".to_string(),
            ));
        }
        match self
            .post_send_live_chat_message(video_id, channel_id, text, false)
            .await
        {
            Ok(()) => Ok(()),
            Err(TransportError::Status { code: 404, .. }) => {
                tracing::info!("live chat send answered 404; retrying with X-Goog-AuthUser");
                self.post_send_live_chat_message(video_id, channel_id, text, true)
                    .await
                    .map_err(|error| to_app_error("live_chat/send_message", &error))?;
                Ok(())
            }
            Err(error) => Err(to_app_error("live_chat/send_message", &error)),
        }
    }

    async fn post_send_live_chat_message(
        &self,
        video_id: &str,
        channel_id: &str,
        text: &str,
        auth_user: bool,
    ) -> Result<(), TransportError> {
        let mut payload = serde_json::json!({
            "richMessage": { "textSegments": [{ "text": text }] },
            "clientMessageId": uuid::Uuid::new_v4().to_string(),
            "params": live_chat_send_params(video_id, channel_id),
        });
        let extra: &[(&'static str, &'static str)] = if auth_user {
            &[("X-Goog-AuthUser", "0")]
        } else {
            &[]
        };
        let res = self
            .post_innertube_extra("live_chat/send_message", &clients::WEB, &mut payload, extra)
            .await?;
        if res.get("addChatItemAction").is_some() || res.get("runAttestationCommand").is_some() {
            Ok(())
        } else {
            Err(TransportError::Status {
                code: 200,
                message: format!("live_chat/send_message answered without a posted message: {res}"),
            })
        }
    }

    /// Deletes one of the viewer's own live chat messages, as Android's
    /// `YouTube.deleteLiveChatMessage` does: the message's context-menu
    /// endpoint lists its actions, the DELETE one carries the moderate
    /// endpoint, and that endpoint posts with its own inner fields.
    pub async fn delete_live_chat_message(
        &self,
        menu_params: &str,
        menu_api_url: Option<&str>,
    ) -> AppResult<()> {
        self.require_signed_in()?;
        let params = menu_params.trim();
        if params.is_empty() {
            return Err(AppError::Validation(
                "This message has no menu to delete from — open the chat again.".to_string(),
            ));
        }
        let menu_path = plain_live_chat_path(menu_api_url)
            .unwrap_or_else(|| "live_chat/get_item_context_menu".to_string());
        let mut menu_payload = serde_json::json!({ "params": params });
        let menu = self
            .post_innertube_extra(&menu_path, &clients::WEB, &mut menu_payload, &[])
            .await
            .map_err(|error| to_app_error(&menu_path, &error))?;
        let delete = find_live_chat_delete_endpoint(&menu).ok_or_else(|| {
            AppError::Validation(
                "This message can't be deleted from here — it may not be yours.".to_string(),
            )
        })?;
        let mut delete_payload = serde_json::Value::Object(delete.fields);
        self.post_innertube_extra(&delete.path, &clients::WEB, &mut delete_payload, &[])
            .await
            .map_err(|error| to_app_error(&delete.path, &error))?;
        Ok(())
    }
}

/// The path a menu command names for itself, kept only when it is a plain
/// `live_chat/…` path under `/youtubei/v1/` — a payload can never send a
/// write somewhere else.
fn plain_live_chat_path(api_url: Option<&str>) -> Option<String> {
    let path = api_url?.strip_prefix("/youtubei/v1/")?;
    let valid = path.starts_with("live_chat/")
        && path.len() > "live_chat/".len()
        && !path.contains("//")
        && !path.ends_with('/')
        && path
            .chars()
            .all(|c| c.is_lowercase() || c.is_ascii_digit() || c == '_' || c == '/');
    valid.then(|| path.to_string())
}

fn plain_live_chat_path_or_bare(api_url: &str) -> Option<String> {
    // Some menus name the path without the `/youtubei/v1/` prefix.
    if let Some(path) = plain_live_chat_path(Some(api_url)) {
        return Some(path);
    }
    let valid = api_url.starts_with("live_chat/")
        && api_url.len() > "live_chat/".len()
        && !api_url.contains("//")
        && !api_url.ends_with('/')
        && api_url
            .chars()
            .all(|c| c.is_lowercase() || c.is_ascii_digit() || c == '_' || c == '/');
    valid.then(|| api_url.to_string())
}

/// The DELETE action a chat item's context menu offers, with the path it posts to.
struct LiveChatDeleteEndpoint {
    path: String,
    fields: serde_json::Map<String, Value>,
}

/// Finds the DELETE item in a `get_item_context_menu` answer and unwraps its
/// service endpoint: the body carries the endpoint's inner fields, not the
/// wrapper key — the moderate endpoint expects `{ params }`, and sending the
/// `moderateLiveChatEndpoint` wrapper 400s with INVALID_ARGUMENT.
fn find_live_chat_delete_endpoint(menu: &Value) -> Option<LiveChatDeleteEndpoint> {
    let renderers = &menu["liveChatItemContextMenuSupportedRenderers"];
    let items = renderers["menuRenderer"]["items"]
        .as_array()
        .or_else(|| renderers["items"].as_array())?;
    let endpoint = items.iter().find_map(|item| {
        let renderer = item.get("menuServiceItemRenderer")?;
        let icon = renderer["icon"]["iconType"].as_str().unwrap_or_default();
        if !icon.eq_ignore_ascii_case("DELETE") {
            return None;
        }
        renderer.get("serviceEndpoint")
    })?;
    let path = endpoint["commandMetadata"]["webCommandMetadata"]["apiUrl"]
        .as_str()
        .and_then(plain_live_chat_path_or_bare)?;
    let stripped: serde_json::Map<String, Value> = endpoint
        .as_object()?
        .iter()
        .filter(|(key, _)| *key != "clickTrackingParams" && *key != "commandMetadata")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let fields = if stripped.len() == 1 {
        let single = stripped.values().next()?;
        single
            .as_object()?
            .iter()
            .filter(|(key, _)| *key != "clickTrackingParams" && *key != "commandMetadata")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    } else {
        stripped
    };
    Some(LiveChatDeleteEndpoint { path, fields })
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn write_length_delimited(out: &mut Vec<u8>, field: u64, bytes: &[u8]) {
    write_varint(out, (field << 3) | 2);
    write_varint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

/// The `params` value for `live_chat/send_message`, per YouTube.js
/// `LiveChat.sendMessage` (`LiveMessageParams`): the proto bytes are
/// standard-base64'd, percent-encoded, then base64'd again — exactly the
/// `btoa(encodeURIComponent(u8ToBase64(...)))` chain in the reference.
fn live_chat_send_params(video_id: &str, channel_id: &str) -> String {
    let mut ids = Vec::new();
    write_length_delimited(&mut ids, 1, channel_id.as_bytes());
    write_length_delimited(&mut ids, 2, video_id.as_bytes());
    let mut params = Vec::new();
    write_length_delimited(&mut params, 5, &ids);
    let mut proto = Vec::new();
    write_length_delimited(&mut proto, 1, &params);
    write_varint(&mut proto, (2 << 3) | 0);
    write_varint(&mut proto, 1);
    write_varint(&mut proto, (3 << 3) | 0);
    write_varint(&mut proto, 4);
    let inner = base64::engine::general_purpose::STANDARD.encode(&proto);
    // The base64 alphabet only ever needs these three escapes, so the
    // percent-encoding is exact without a url-encoding crate.
    let encoded: String = inner
        .chars()
        .flat_map(|c| match c {
            '+' => vec!['%', '2', 'B'],
            '/' => vec!['%', '2', 'F'],
            '=' => vec!['%', '3', 'D'],
            other => vec![other],
        })
        .collect();
    base64::engine::general_purpose::STANDARD.encode(encoded.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text_message(id: &str) -> Value {
        json!({ "liveChatTextMessageRenderer": {
            "id": id,
            "authorName": { "simpleText": "Viewer" },
            "message": { "runs": [{ "text": "hello" }] }
        } })
    }

    #[test]
    fn replayed_messages_keep_their_offset_and_the_seek_token() {
        let res = json!({ "continuationContents": { "liveChatContinuation": {
            "continuations": [
                { "liveChatReplayContinuationData": { "continuation": "NEXT", "timeUntilLastMessageMsec": 5000 } },
                { "playerSeekContinuationData": { "continuation": "SEEK" } }
            ],
            "actions": [{ "replayChatItemAction": {
                "videoOffsetTimeMsec": "341527",
                "actions": [{ "addChatItemAction": { "item": text_message("a") } }]
            } }]
        } } });
        let page = parse_live_chat_page(&res);
        assert_eq!(page.next.as_deref(), Some("NEXT"));
        assert_eq!(page.seek.as_deref(), Some("SEEK"));
        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.messages[0].video_offset_ms, Some(341_527));
    }

    #[test]
    fn the_view_selector_gives_the_top_and_all_messages_tokens() {
        let res = json!({ "continuationContents": { "liveChatContinuation": {
            "continuations": [{ "invalidationContinuationData": { "continuation": "LIVE", "timeoutMs": 5000 } }],
            "actions": [{ "addChatItemAction": { "item": text_message("b") } }],
            "header": { "liveChatHeaderRenderer": { "viewSelector": { "sortFilterSubMenuRenderer": {
                "subMenuItems": [
                    { "title": "Top chat", "continuation": { "reloadContinuationData": { "continuation": "TOP" } } },
                    { "title": "Live chat", "continuation": { "reloadContinuationData": { "continuation": "ALL" } } }
                ]
            } } } }
        } } });
        let page = parse_live_chat_page(&res);
        assert_eq!(page.next.as_deref(), Some("LIVE"));
        assert_eq!(page.polling_interval_ms, 5000);
        assert_eq!(
            page.views,
            (Some("TOP".to_string()), Some("ALL".to_string()))
        );
        assert_eq!(page.messages[0].video_offset_ms, None);
    }

    #[test]
    fn send_params_match_the_reference_double_base64_encoding() {
        // Computed independently from the Android `liveChatSendParams` spec:
        // proto bytes, standard base64, percent-encode, base64 again.
        assert_eq!(
            live_chat_send_params("dQw4w9WgXcQ", "UC38IQsAvIsxxjztdMZQtwHA"),
            "Q2lrcUp3b1lWVU16T0VsUmMwRjJTWE40ZUdwNmRHUk5XbEYwZDBoQkVndGtVWGMwZHpsWFoxaGpVUkFCR0FRJTNE"
        );
    }

    #[test]
    fn messages_carry_their_context_menu_token() {
        let renderer = json!({
            "id": "m1",
            "authorName": { "simpleText": "Viewer" },
            "message": { "runs": [{ "text": "hi" }] },
            "contextMenuEndpoint": {
                "commandMetadata": { "webCommandMetadata": { "apiUrl": "/youtubei/v1/live_chat/get_item_context_menu" } },
                "liveChatItemContextMenuEndpoint": { "params": "MENU_PARAMS" }
            }
        });
        let message = parse_renderer(&renderer, "text").expect("message parses");
        assert_eq!(message.menu_params.as_deref(), Some("MENU_PARAMS"));
        assert_eq!(
            message.menu_api_url.as_deref(),
            Some("/youtubei/v1/live_chat/get_item_context_menu")
        );
    }

    #[test]
    fn delete_uses_the_menu_delete_action_without_its_wrapper() {
        let menu = json!({ "liveChatItemContextMenuSupportedRenderers": { "menuRenderer": { "items": [
            { "menuServiceItemRenderer": {
                "icon": { "iconType": "REPORT" },
                "serviceEndpoint": { "commandMetadata": { "webCommandMetadata": { "apiUrl": "/youtubei/v1/live_chat/report" } } }
            } },
            { "menuServiceItemRenderer": {
                "icon": { "iconType": "DELETE" },
                "serviceEndpoint": {
                    "clickTrackingParams": "TRACK",
                    "commandMetadata": { "webCommandMetadata": { "apiUrl": "/youtubei/v1/live_chat/moderate" } },
                    "moderateLiveChatEndpoint": { "params": "MOD_PARAMS" }
                }
            } }
        ] } } });
        let delete = find_live_chat_delete_endpoint(&menu).expect("delete action found");
        assert_eq!(delete.path, "live_chat/moderate");
        assert_eq!(delete.fields.len(), 1);
        assert_eq!(delete.fields["params"], "MOD_PARAMS");
    }

    #[test]
    fn delete_rejects_a_menu_without_a_delete_action() {
        let menu = json!({ "liveChatItemContextMenuSupportedRenderers": { "menuRenderer": { "items": [
            { "menuServiceItemRenderer": {
                "icon": { "iconType": "REPORT" },
                "serviceEndpoint": { "commandMetadata": { "webCommandMetadata": { "apiUrl": "/youtubei/v1/live_chat/report" } } }
            } }
        ] } } });
        assert!(find_live_chat_delete_endpoint(&menu).is_none());
    }

    #[test]
    fn only_plain_live_chat_paths_are_posted() {
        assert_eq!(
            plain_live_chat_path(Some("/youtubei/v1/live_chat/moderate")),
            Some("live_chat/moderate".to_string())
        );
        assert_eq!(
            plain_live_chat_path(Some("/youtubei/v1/comment/create_comment")),
            None
        );
        assert_eq!(
            plain_live_chat_path(Some("https://evil.example/live_chat/moderate")),
            None
        );
        assert_eq!(
            plain_live_chat_path(Some("/youtubei/v1/live_chat/moderate/")),
            None
        );
    }
}
