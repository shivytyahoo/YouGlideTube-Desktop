//! Channels the viewer already knows sit next to, and their latest uploads, from the Android app's
//! `NeighbourChannels` and its repository. A neighbour ignored too often is dropped.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use super::card::Card;
use crate::errors::AppResult;

pub const REFRESH_PER_LOAD: usize = 4;
pub const UPLOADS_PER_CHANNEL: usize = 3;
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
