use std::collections::HashMap;

use serde::{Serialize, de::DeserializeOwned};
use sqlx::{Row, SqlitePool};

use crate::errors::{AppError, AppResult};
use crate::models::music::{Album, AlbumItem, SongItem, YTItem};

pub const RETENTION_SECONDS: i64 = 60 * 24 * 60 * 60;
const MAX_EDGES_PER_RELATION: usize = 64;

pub async fn get_cached<T: DeserializeOwned>(
    pool: &SqlitePool,
    source_kind: &str,
    source_id: &str,
    max_age_seconds: i64,
) -> AppResult<Option<T>> {
    let row = sqlx::query(
        "SELECT payload_json FROM music_content_cache \
         WHERE source_kind = ? AND source_id = ? AND fetched_at >= unixepoch() - ?",
    )
    .bind(source_kind)
    .bind(source_id)
    .bind(max_age_seconds)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    row.map(|row| {
        let json: String = row.try_get("payload_json").map_err(AppError::from)?;
        serde_json::from_str(&json).map_err(AppError::from)
    })
    .transpose()
}

pub async fn save<T: Serialize>(
    pool: &SqlitePool,
    source_kind: &str,
    source_id: &str,
    page: &T,
    edges: &[(String, YTItem)],
) -> AppResult<()> {
    let json = serde_json::to_string(page).map_err(AppError::from)?;
    let mut transaction = pool.begin().await.map_err(AppError::from)?;
    sqlx::query(
        "INSERT INTO music_content_cache (source_kind, source_id, payload_json, fetched_at) \
         VALUES (?, ?, ?, unixepoch()) ON CONFLICT(source_kind, source_id) \
         DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
    )
    .bind(source_kind)
    .bind(source_id)
    .bind(json)
    .execute(&mut *transaction)
    .await
    .map_err(AppError::from)?;
    sqlx::query("DELETE FROM music_content_edges WHERE source_kind = ? AND source_id = ?")
        .bind(source_kind)
        .bind(source_id)
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
    let mut per_relation: HashMap<&str, usize> = HashMap::new();
    for (relation, item) in edges {
        let position = per_relation.entry(relation.as_str()).or_default();
        if *position >= MAX_EDGES_PER_RELATION {
            continue;
        }
        let Some((target_kind, target_id)) = item_identity(item) else {
            continue;
        };
        let edge_position = *position;
        *position += 1;
        let item_json = serde_json::to_string(item).map_err(AppError::from)?;
        sqlx::query(
            "INSERT INTO music_content_entities (entity_kind, entity_id, payload_json, updated_at) \
             VALUES (?, ?, ?, unixepoch()) ON CONFLICT(entity_kind, entity_id) \
             DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
        )
        .bind(target_kind)
        .bind(target_id)
        .bind(item_json)
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
        sqlx::query(
            "INSERT INTO music_content_edges \
             (source_kind, source_id, relation, target_kind, target_id, position, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, unixepoch()) \
             ON CONFLICT(source_kind, source_id, relation, target_kind, target_id) \
             DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at",
        )
        .bind(source_kind)
        .bind(source_id)
        .bind(relation)
        .bind(target_kind)
        .bind(target_id)
        .bind(i64::try_from(edge_position).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await
        .map_err(AppError::from)?;
    }
    transaction.commit().await.map_err(AppError::from)?;
    Ok(())
}

fn item_identity(item: &YTItem) -> Option<(&'static str, &str)> {
    match item {
        YTItem::Song(song) => Some(("track", song.video_id.as_deref().unwrap_or(&song.id))),
        YTItem::Artist(artist) => Some(("artist", artist.id.as_str())),
        YTItem::Album(album) => Some(("album", album.browse_id.as_str())),
        YTItem::Playlist(playlist) => Some(("playlist", playlist.id.as_str())),
        _ => None,
    }
    .filter(|(_, id)| !id.is_empty())
}

/// Album track rows often omit the artist and cover (the album header carries them),
/// and can even put the play count where the artist goes. A track with no identified
/// artist takes the album's, so graph reads can match it to the user's taste.
pub fn fill_from_album(song: &mut SongItem, album: &AlbumItem) {
    let identified = song.artists.iter().any(|artist| artist.id.is_some());
    if !identified
        && let Some(album_artists) = album.artists.as_ref().filter(|artists| !artists.is_empty())
    {
        song.artists.clone_from(album_artists);
    }
    if song.thumbnail.is_empty() {
        song.thumbnail.clone_from(&album.thumbnail);
    }
    if song.album.is_none() {
        song.album = Some(Album {
            name: album.title.clone(),
            id: album.browse_id.clone(),
        });
    }
}

pub async fn prune(pool: &SqlitePool) -> AppResult<()> {
    for query in [
        "DELETE FROM music_content_cache WHERE fetched_at < unixepoch() - ?",
        "DELETE FROM music_content_edges WHERE updated_at < unixepoch() - ?",
        "DELETE FROM music_content_entities WHERE updated_at < unixepoch() - ?",
    ] {
        sqlx::query(query)
            .bind(RETENTION_SECONDS)
            .execute(pool)
            .await
            .map_err(AppError::from)?;
    }
    sqlx::query(
        "DELETE FROM music_content_entities WHERE entity_kind = 'track' AND entity_id NOT IN \
         (SELECT entity_id FROM music_content_entities WHERE entity_kind = 'track' \
          ORDER BY updated_at DESC LIMIT 20000)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    sqlx::query(
        "DELETE FROM music_content_cache WHERE rowid NOT IN \
         (SELECT rowid FROM music_content_cache ORDER BY fetched_at DESC LIMIT 5000)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    sqlx::query(
        "DELETE FROM music_content_edges WHERE NOT EXISTS \
         (SELECT 1 FROM music_content_entities entity \
          WHERE entity.entity_kind = music_content_edges.target_kind \
          AND entity.entity_id = music_content_edges.target_id)",
    )
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::music::Artist;

    fn song(id: &str, artist: &str) -> SongItem {
        SongItem {
            id: id.into(),
            video_id: Some(id.into()),
            title: id.into(),
            artists: vec![Artist {
                name: artist.into(),
                id: Some(format!("{artist}-id")),
            }],
            album: None,
            duration: Some(200),
            music_video_type: Some("MUSIC_VIDEO_TYPE_ATV".into()),
            thumbnail: String::new(),
            explicit: false,
            playlist_id: None,
            params: None,
            views_text: None,
        }
    }


    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn save_album(pool: &SqlitePool, id: &str, songs: &[SongItem]) {
        let edges: Vec<_> = songs
            .iter()
            .cloned()
            .map(|song| ("tracks".to_owned(), YTItem::Song(song)))
            .collect();
        save(pool, "album", id, &songs.to_vec(), &edges)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn graph_cache_survives_reads_and_prunes_expired_edges() {
        let pool = pool().await;
        save_album(&pool, "album-1", &[song("first", "fav")]).await;
        let cached: Vec<SongItem> = get_cached(&pool, "album", "album-1", 10)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cached[0].id, "first");

        save_album(&pool, "album-1", &[song("second", "fav")]).await;
        let cached: Vec<SongItem> = get_cached(&pool, "album", "album-1", 10)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cached[0].id, "second");

        sqlx::query("UPDATE music_content_edges SET updated_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE music_content_cache SET fetched_at = 0")
            .execute(&pool)
            .await
            .unwrap();
        let stale: Option<Vec<SongItem>> = get_cached(&pool, "album", "album-1", 10).await.unwrap();
        assert!(stale.is_none());
        prune(&pool).await.unwrap();
        let gone: Option<Vec<SongItem>> = get_cached(&pool, "album", "album-1", 10).await.unwrap();
        assert!(gone.is_none());
    }



}
