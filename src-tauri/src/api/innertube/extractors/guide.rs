//! The account's guide: every channel the account follows — the complete
//! membership list the subscription feed only ever samples. Ported from the
//! Android app's `GuidePage.kt` (`toGuideChannels`) and `InnerTube.guide()`.

use std::collections::HashSet;

use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::thumbnail_url_from_array;
use crate::errors::AppResult;
use crate::models::channel::ChannelSummary;

/// Every object node of `value`, parents before children, exactly the walk
/// Android's `forEachObject` performs over a guide response.
fn for_each_object(value: &Value, visit: &mut impl FnMut(&Value)) {
    match value {
        Value::Object(map) => {
            visit(value);
            for child in map.values() {
                for_each_object(child, visit);
            }
        }
        Value::Array(items) => {
            for child in items {
                for_each_object(child, visit);
            }
        }
        _ => {}
    }
}

/// One channel of the guide's subscriptions section, from its guide entry.
/// Channel entries are the only guide entries whose id is a channel id — the
/// section headers and destinations use feed ids — so the prefix is the
/// membership test.
fn channel_from_guide_entry(entry: &Value) -> Option<ChannelSummary> {
    let channel_id = entry["entryData"]["guideEntryData"]["guideEntryId"]
        .as_str()
        .filter(|id| id.starts_with("UC"))?
        .to_string();
    let name = text_of(&entry["formattedTitle"]).unwrap_or_default();
    let avatar_url = thumbnail_url_from_array(&entry["thumbnail"]["thumbnails"]);
    Some(ChannelSummary {
        channel_id,
        name,
        avatar_url,
        subscriber_count_text: None,
    })
}

/// A channel id at `node` itself or up to `depth` levels below it, through a
/// browse endpoint — the TV guide's fallback, whose response carries no guide
/// entries.
fn channel_id_within(node: &Value, depth: usize) -> Option<String> {
    let obj = node.as_object()?;
    if let Some(id) = obj
        .get("browseEndpoint")
        .and_then(|endpoint| endpoint.get("browseId"))
        .and_then(Value::as_str)
        .filter(|id| id.starts_with("UC"))
    {
        return Some(id.to_string());
    }
    if depth == 0 {
        return None;
    }
    for child in obj.values() {
        if let Some(id) = channel_id_within(child, depth - 1) {
            return Some(id);
        }
    }
    None
}

/// Every channel in the guide's subscriptions section, in the guide's own
/// order. The strict `guideEntryRenderer` scan first, and only when it finds
/// nothing, the browse-endpoint fallback — the guide is a navigation menu, so
/// a channel endpoint there is a subscription. The title guard matters
/// because the walk visits parents first: a wrapper above the entry also
/// contains the endpoint but none of the entry's own text.
#[must_use]
pub fn guide_channels(response: &Value) -> Vec<ChannelSummary> {
    let mut channels: Vec<ChannelSummary> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for_each_object(response, &mut |node| {
        let Some(entry) = node.get("guideEntryRenderer") else {
            return;
        };
        let Some(channel) = channel_from_guide_entry(entry) else {
            return;
        };
        if seen.insert(channel.channel_id.clone()) {
            channels.push(channel);
        }
    });
    if !channels.is_empty() {
        return channels;
    }
    for_each_object(response, &mut |node| {
        let Some(channel_id) = channel_id_within(node, 3) else {
            return;
        };
        if seen.contains(&channel_id) {
            return;
        }
        let name = ["formattedTitle", "title", "text"]
            .iter()
            .find_map(|field| text_of(&node[field]).filter(|text| !text.trim().is_empty()))
            .unwrap_or_default();
        let avatar_url = thumbnail_url_from_array(&node["thumbnail"]["thumbnails"]);
        if name.trim().is_empty() && avatar_url.is_none() {
            return;
        }
        seen.insert(channel_id.clone());
        channels.push(ChannelSummary {
            channel_id,
            name,
            avatar_url,
            subscriber_count_text: None,
        });
    });
    channels
}

impl InnertubeClient {
    /// The account's guide: every channel the account follows — the complete
    /// membership list the subscription feed only ever samples. The WEB
    /// client, as Android's cookie-session guide does.
    pub async fn browse_guide_subscriptions(&self) -> AppResult<Vec<ChannelSummary>> {
        self.require_signed_in()?;
        let mut payload = json!({});
        let response = self
            .post_innertube("guide", &clients::WEB, &mut payload)
            .await?;
        Ok(guide_channels(&response))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(id: &str, title: &str, avatar: Option<&str>) -> Value {
        json!({
            "guideEntryRenderer": {
                "entryData": { "guideEntryData": { "guideEntryId": id } },
                "formattedTitle": { "simpleText": title },
                "thumbnail": { "thumbnails": avatar.map_or(json!([]), |url| json!([{ "url": url, "width": 88, "height": 88 }])) },
            }
        })
    }

    #[test]
    fn strict_scan_keeps_channel_entries_in_guide_order() {
        let response = json!({
            "items": [
                { "guideSectionRenderer": { "items": [
                    entry("UC111", "One", Some("//i.ytimg.com/vi/one/hqdefault.jpg")),
                    entry("UC222", "Two", None),
                    entry("FEsubscriptions", "Subscriptions", None),
                    entry("UC111", "One again", Some("//i.ytimg.com/vi/one/hqdefault.jpg")),
                ] } },
            ]
        });
        let channels = guide_channels(&response);
        assert_eq!(
            channels
                .iter()
                .map(|c| c.channel_id.as_str())
                .collect::<Vec<_>>(),
            ["UC111", "UC222"]
        );
        assert_eq!(channels[0].name, "One");
        // The thumbnail helper asks the CDN for the sharp large-screen size,
        // so hqdefault comes back as hq720.
        assert_eq!(
            channels[0].avatar_url.as_deref(),
            Some("https://i.ytimg.com/vi/one/hq720.jpg")
        );
        assert_eq!(channels[1].name, "Two");
        assert_eq!(channels[1].avatar_url, None);
        assert!(channels.iter().all(|c| c.subscriber_count_text.is_none()));
    }

    #[test]
    fn title_runs_and_missing_thumbnail() {
        let response = json!({
            "items": [{ "guideEntryRenderer": {
                "entryData": { "guideEntryData": { "guideEntryId": "UC333" } },
                "formattedTitle": { "runs": [{ "text": "Run" }, { "text": " Name" }] },
            } }]
        });
        let channels = guide_channels(&response);
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].name, "Run Name");
        assert_eq!(channels[0].avatar_url, None);
    }

    #[test]
    fn tv_guide_without_entries_falls_back_to_browse_endpoints() {
        let response = json!({
            "items": [
                { "guideSectionRenderer": { "items": [
                    { "guideEntryRenderer": {
                        "entryData": { "guideEntryData": { "guideEntryId": "FEsubscriptions" } },
                        "formattedTitle": { "simpleText": "Subscriptions" },
                    } },
                    { "navigationEndpoint": { "browseEndpoint": { "browseId": "UCTV1" } },
                      "formattedTitle": { "simpleText": "TV Channel" },
                      "thumbnail": { "thumbnails": [{ "url": "https://i.ytimg.com/tv.jpg", "width": 88, "height": 88 }] } },
                ] } },
            ]
        });
        let channels = guide_channels(&response);
        assert_eq!(
            channels
                .iter()
                .map(|c| c.channel_id.as_str())
                .collect::<Vec<_>>(),
            ["UCTV1"]
        );
        assert_eq!(channels[0].name, "TV Channel");
    }

    #[test]
    fn endpoint_without_title_or_thumbnail_is_a_wrapper_not_a_channel() {
        let response = json!({
            "items": [{ "guideSectionRenderer": { "items": [
                { "navigationEndpoint": { "browseEndpoint": { "browseId": "UCWRAP" } } },
            ] } }]
        });
        assert!(guide_channels(&response).is_empty());
    }

    #[test]
    fn empty_guide_is_empty() {
        assert!(guide_channels(&json!({})).is_empty());
        assert!(guide_channels(&json!(null)).is_empty());
    }
}
