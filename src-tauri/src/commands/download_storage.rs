//! How much disk the saved downloads use, per type, and the limits that
//! hold new downloads to them. Android meters the same split — videos,
//! songs, artwork, other — and caps the video and song caches; the desktop
//! mirrors the meter and the two media limits. The limits are settings, not
//! cache state: downloads are the user's own files, so nothing is ever
//! deleted to hold a limit — a new download of a kind already at its limit
//! is refused with an honest message instead.

use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::downloads::DownloadMediaKind;
use crate::db::settings;
use crate::errors::{AppError, AppResult, ErrorResponse};

const MB: u64 = 1024 * 1024;
/// Android's size choices, in megabytes; 0 means no limit.
const MAX_LIMIT_MB: u64 = 5120;

const VIDEO_LIMIT_KEY: &str = "download_video_storage_limit_mb";
const MUSIC_LIMIT_KEY: &str = "download_music_storage_limit_mb";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStorageRow {
    pub kind: &'static str,
    pub bytes: u64,
    pub files: u64,
    /// Megabytes; 0 means no limit.
    pub limit_mb: u64,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct StorageTotals {
    video_bytes: u64,
    video_files: u64,
    music_bytes: u64,
    music_files: u64,
}

/// What the saved files of each kind add up to. A record whose file is
/// gone counts for nothing — the meter measures the disk, not the table.
fn measure_download_files(entries: &[(String, PathBuf)]) -> StorageTotals {
    let mut totals = StorageTotals::default();
    for (kind, path) in entries {
        let Ok(metadata) = std::fs::metadata(path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if kind == "video" {
            totals.video_bytes += metadata.len();
            totals.video_files += 1;
        } else {
            totals.music_bytes += metadata.len();
            totals.music_files += 1;
        }
    }
    totals
}

async fn limit_mb(pool: &SqlitePool, key: &str) -> u64 {
    settings::get_setting(pool, key)
        .await
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0)
        .min(MAX_LIMIT_MB)
}

async fn totals(pool: &SqlitePool) -> AppResult<StorageTotals> {
    let records = crate::db::downloads::list_downloads(pool).await?;
    let entries: Vec<(String, PathBuf)> = records
        .into_iter()
        .map(|record| (record.media_kind, PathBuf::from(record.file_path)))
        .collect();
    tokio::task::spawn_blocking(move || measure_download_files(&entries))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
}

#[tauri::command]
pub async fn download_storage_usage(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DownloadStorageRow>, ErrorResponse> {
    let totals = totals(&pool).await.map_err(ErrorResponse::from)?;
    let video_limit = limit_mb(&pool, VIDEO_LIMIT_KEY).await;
    let music_limit = limit_mb(&pool, MUSIC_LIMIT_KEY).await;
    Ok(vec![
        DownloadStorageRow {
            kind: "video",
            bytes: totals.video_bytes,
            files: totals.video_files,
            limit_mb: video_limit,
        },
        DownloadStorageRow {
            kind: "music",
            bytes: totals.music_bytes,
            files: totals.music_files,
            limit_mb: music_limit,
        },
    ])
}

/// Refuses a new download of a kind already at its limit. Nothing is
/// deleted to make room — the user frees space or raises the limit.
pub(crate) async fn check_storage_limit(
    pool: &SqlitePool,
    kind: DownloadMediaKind,
) -> AppResult<()> {
    let (key, label) = match kind {
        DownloadMediaKind::Video => (VIDEO_LIMIT_KEY, "Video"),
        DownloadMediaKind::Music | DownloadMediaKind::Audio => (MUSIC_LIMIT_KEY, "Song"),
    };
    let limit = limit_mb(pool, key).await;
    if limit == 0 {
        return Ok(());
    }
    let totals = totals(pool).await?;
    let used = match kind {
        DownloadMediaKind::Video => totals.video_bytes,
        DownloadMediaKind::Music | DownloadMediaKind::Audio => totals.music_bytes,
    };
    if used >= limit.saturating_mul(MB) {
        return Err(AppError::Validation(format!(
            "{label} downloads have reached the {limit} MB limit — delete some downloads or raise the limit in Settings."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(dir: &std::path::Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::File::create(&path)
            .unwrap()
            .write_all(bytes)
            .unwrap();
        path
    }

    #[test]
    fn sizes_are_split_by_kind_and_missing_files_count_for_nothing() {
        let dir = std::env::temp_dir().join(format!(
            "youglidetube-storage-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let video = write_file(&dir, "clip.mp4", &[0u8; 100]);
        let song = write_file(&dir, "song.m4a", &[0u8; 40]);
        let entries = vec![
            ("video".to_string(), video),
            ("music".to_string(), song),
            ("audio".to_string(), dir.join("gone.opus")),
            ("video".to_string(), dir.join("sub")),
        ];
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let totals = measure_download_files(&entries);
        assert_eq!(
            totals,
            StorageTotals {
                video_bytes: 100,
                video_files: 1,
                music_bytes: 40,
                music_files: 1,
            }
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
