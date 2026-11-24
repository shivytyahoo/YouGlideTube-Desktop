//! Channels the viewer already knows sit next to, and their latest uploads, from the Android app's
//! `NeighbourChannels` and its repository. A neighbour ignored too often is dropped.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use super::card::Card;
use super::seeds::GraphCandidate;
use crate::api::innertube::extractors::server_feed::ServerFeedPage;
use crate::errors::AppResult;

pub const REFRESH_PER_LOAD: usize = 4;
pub const UPLOADS_PER_CHANNEL: usize = 3;
/// New neighbours seeded from one load's server feed and related lane, at most.
pub const SEED_PER_LOAD: usize = 8;
const REFRESH_AFTER_MS: u64 = 6 * 3_600_000;
pub const UPLOAD_WINDOW_MS: u64 = 14 * 86_400_000;
const IGNORED_IMPRESSIONS: i64 = 6;
const MAX_STORED: i64 = 100;

#[derive(Debug, Clone)]
pub struct Neighbour {
    pub channel_id: String,
    pub name: String,
    /// The names of the viewer's channels that point here, strongest first.
    pub pointer_names: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Stored {
    pub name: String,
    pub fetched_at: u64,
    pub uploads: Vec<Card>,
    pub dropped: bool,
}

/// The stored neighbours worth showing: named and not given up on. New neighbours arrive only
/// from the viewer's own channels (channel memory); there is no engine to discover new ones.
#[must_use]
pub fn stored_neighbours(stored: &HashMap<String, Stored>) -> Vec<Neighbour> {
    let mut neighbours: Vec<Neighbour> = stored
        .iter()
        .filter(|(_, s)| !s.dropped && !s.name.is_empty())
        .map(|(channel_id, s)| Neighbour {
            channel_id: channel_id.clone(),
            name: s.name.clone(),
            pointer_names: Vec::new(),
        })
        .collect();
    neighbours.sort_by(|a, b| a.channel_id.cmp(&b.channel_id));
    neighbours
}

/// The named neighbours whose uploads are older than six hours, at most a load's worth.
#[must_use]
pub fn refresh_queue<'a>(
    neighbours: &'a [Neighbour],
    stored: &HashMap<String, Stored>,
    now_ms: u64,
) -> Vec<&'a Neighbour> {
    neighbours
        .iter()
        .filter(|n| !n.name.is_empty())
        .filter(|n| {
            now_ms.saturating_sub(stored.get(&n.channel_id).map_or(0, |s| s.fetched_at))
                >= REFRESH_AFTER_MS
        })
        .take(REFRESH_PER_LOAD)
        .collect()
}

pub async fn load(pool: &SqlitePool) -> AppResult<HashMap<String, Stored>> {
    // `name` may be NULL on rows written before it was stored; those read as nameless.
    let rows: Vec<(String, Option<String>, i64, String, i64)> = sqlx::query_as(
        "SELECT channel_id, name, fetched_at, uploads, dropped FROM home_neighbour_channels",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(channel, name, fetched, uploads, dropped)| {
            let stored = Stored {
                name: name.unwrap_or_default(),
                fetched_at: u64::try_from(fetched).unwrap_or(0),
                uploads: serde_json::from_str(&uploads).unwrap_or_default(),
                dropped: dropped != 0,
            };
            (channel, stored)
        })
        .collect())
}

pub async fn save_uploads(
    pool: &SqlitePool,
    channel_id: &str,
    name: &str,
    uploads: &[Card],
    now_ms: u64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO home_neighbour_channels (channel_id, name, fetched_at, uploads) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at,
             uploads = excluded.uploads",
    )
    .bind(channel_id)
    .bind(name)
    .bind(i64::try_from(now_ms).unwrap_or(i64::MAX))
    .bind(serde_json::to_string(uploads).unwrap_or_else(|_| "[]".into()))
    .execute(pool)
    .await?;
    sqlx::query(
        "DELETE FROM home_neighbour_channels WHERE channel_id NOT IN (
             SELECT channel_id FROM home_neighbour_channels ORDER BY fetched_at DESC LIMIT ?)",
    )
    .bind(MAX_STORED)
    .execute(pool)
    .await?;
    Ok(())
}

/// Counts one showing of each channel; one shown too often without a watch is dropped.
pub async fn note_shown(pool: &SqlitePool, channel_ids: &HashSet<String>) -> AppResult<()> {
    for channel in channel_ids {
        sqlx::query(
            "INSERT INTO home_neighbour_channels (channel_id, impressions) VALUES (?, 1)
             ON CONFLICT(channel_id) DO UPDATE SET impressions = impressions + 1,
                 dropped = CASE WHEN impressions + 1 >= ? THEN 1 ELSE dropped END",
        )
        .bind(channel)
        .bind(IGNORED_IMPRESSIONS)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Channels from the server home feed and the related lane worth seeding
/// as neighbours, with their feed videos as uploads: the neighbour lane
/// only ever served rows already in the store, so without a live source
/// it slowly empties. A channel is offered once, in server-page order,
/// with at most three uploads; excluded channels never seed. Shorts,
/// live videos and uploads without a recent known age are not uploads.
#[must_use]
pub fn pick_new_neighbours(
    page: Option<&ServerFeedPage>,
    related: &[GraphCandidate],
    excluded: &HashSet<&str>,
    now_ms: u64,
) -> Vec<(String, String, Vec<Card>)> {
    let mut names: HashMap<&str, String> = HashMap::new();
    let mut order: Vec<(String, String, Vec<Card>)> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    if let Some(page) = page {
        for channel in &page.channels {
            names.insert(channel.channel_id.as_str(), channel.name.clone());
        }
        for video in page.videos.iter().chain(&page.shorts) {
            offer_neighbour(
                &mut order,
                &mut at,
                &Card::from_summary(video.clone(), now_ms),
                &names,
                excluded,
                now_ms,
            );
        }
    }
    for candidate in related {
        offer_neighbour(
            &mut order,
            &mut at,
            &candidate.card,
            &names,
            excluded,
            now_ms,
        );
    }
    order
}

fn offer_neighbour(
    order: &mut Vec<(String, String, Vec<Card>)>,
    at: &mut HashMap<String, usize>,
    card: &Card,
    names: &HashMap<&str, String>,
    excluded: &HashSet<&str>,
    now_ms: u64,
) {
    if !card.is_valid() || card.video.is_live {
        return;
    }
    let channel_id = card.channel_id();
    if channel_id.is_empty() || excluded.contains(channel_id) {
        return;
    }
    if card.age_ms(now_ms).is_none_or(|age| age > UPLOAD_WINDOW_MS) {
        return;
    }
    let name = if card.video.channel_name.is_empty() {
        names.get(channel_id).cloned().unwrap_or_default()
    } else {
        card.video.channel_name.clone()
    };
    if name.is_empty() {
        return;
    }
    match at.get(channel_id) {
        Some(&index) => {
            let uploads = &mut order[index].2;
            if uploads.len() < UPLOADS_PER_CHANNEL && !uploads.iter().any(|c| c.id() == card.id()) {
                uploads.push(card.clone());
            }
        }
        None => {
            if order.len() >= SEED_PER_LOAD {
                return;
            }
            at.insert(channel_id.to_string(), order.len());
            order.push((channel_id.to_string(), name, vec![card.clone()]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::extractors::server_feed::ServerFeedPage;
    use crate::models::channel::ChannelSummary;
    use crate::models::video::VideoSummary;

    const NOW: u64 = 30 * 86_400_000;

    fn video(id: &str, channel_id: &str, channel_name: &str) -> VideoSummary {
        VideoSummary {
            id: id.to_string(),
            title: id.to_string(),
            channel_name: channel_name.to_string(),
            channel_id: Some(channel_id.to_string()),
            published_text: Some("2 days ago".to_string()),
            duration_seconds: Some(600),
            ..VideoSummary::default()
        }
    }

    fn page(videos: Vec<VideoSummary>) -> ServerFeedPage {
        ServerFeedPage {
            videos,
            shorts: vec![],
            channels: vec![],
            playlists: vec![],
            chips: vec![],
            continuation: None,
            clear_history_token: None,
            remove_tokens: HashMap::new(),
        }
    }

    fn candidate(card: Card) -> GraphCandidate {
        GraphCandidate {
            card,
            seed_id: "seed".to_string(),
            seed_score: 1.0,
            graph_rank: 0,
            seed_result_count: 1,
            hit_count: 1,
        }
    }

    #[test]
    fn only_named_channels_still_wanted_are_offered() {
        let stored = HashMap::from([
            (
                "kept".to_string(),
                Stored {
                    name: "Kept".into(),
                    ..Stored::default()
                },
            ),
            (
                "nameless".to_string(),
                Stored {
                    name: String::new(),
                    ..Stored::default()
                },
            ),
            (
                "dropped".to_string(),
                Stored {
                    name: "Dropped".into(),
                    dropped: true,
                    ..Stored::default()
                },
            ),
        ]);
        let offered = stored_neighbours(&stored);
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].channel_id, "kept");
        assert_eq!(offered[0].name, "Kept");
    }

    #[test]
    fn new_channels_seed_from_the_server_page_in_order() {
        let mut videos = vec![
            video("v1", "UCnew1", "New One"),
            video("v2", "UCnew1", "New One"),
            video("v3", "UCnew1", "New One"),
            video("v4", "UCnew1", "New One"),
            video("v5", "UCnew2", "New Two"),
        ];
        videos.push(VideoSummary {
            is_short: true,
            ..video("s1", "UCshort", "Shorts Only")
        });
        let excluded: HashSet<&str> = ["UCfollowed".into()].into_iter().collect();
        let seeded = pick_new_neighbours(Some(&page(videos)), &[], &excluded, NOW);
        assert_eq!(seeded.len(), 2);
        assert_eq!(seeded[0].0, "UCnew1");
        assert_eq!(seeded[0].1, "New One");
        assert_eq!(seeded[0].2.len(), 3);
        assert_eq!(seeded[1].0, "UCnew2");
    }

    #[test]
    fn excluded_nameless_and_stale_channels_never_seed() {
        let mut stale = video("v9", "UCstale", "Stale");
        stale.published_text = Some("30 days ago".to_string());
        let mut nameless = video("v8", "UCnameless", "");
        nameless.channel_name = String::new();
        let page = page(vec![video("v7", "UCblocked", "Blocked"), stale, nameless]);
        let excluded: HashSet<&str> = ["UCblocked".into()].into_iter().collect();
        assert!(pick_new_neighbours(Some(&page), &[], &excluded, NOW).is_empty());
    }

    #[test]
    fn related_channels_seed_after_server_ones_and_the_cap_holds() {
        let server = (0..7)
            .map(|i| video(&format!("sv{i}"), &format!("UCsrv{i}"), "Server"))
            .collect::<Vec<_>>();
        let related = (0..3)
            .map(|i| {
                candidate(Card::from_summary(
                    video(&format!("rv{i}"), &format!("UCrel{i}"), "Related"),
                    NOW,
                ))
            })
            .collect::<Vec<_>>();
        let seeded = pick_new_neighbours(Some(&page(server)), &related, &HashSet::new(), NOW);
        assert_eq!(seeded.len(), SEED_PER_LOAD);
        assert_eq!(seeded[7].0, "UCrel0");
    }

    #[test]
    fn a_channel_name_from_the_rail_covers_a_nameless_video() {
        let mut page = page(vec![VideoSummary {
            channel_name: String::new(),
            ..video("v1", "UCrail", "")
        }]);
        page.channels = vec![ChannelSummary {
            channel_id: "UCrail".to_string(),
            name: "Rail Name".to_string(),
            avatar_url: None,
            subscriber_count_text: None,
        }];
        let seeded = pick_new_neighbours(Some(&page), &[], &HashSet::new(), NOW);
        assert_eq!(seeded.len(), 1);
        assert_eq!(seeded[0].1, "Rail Name");
    }
}
