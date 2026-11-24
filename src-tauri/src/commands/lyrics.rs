//! The lyrics disk cache, one `lyrics/<videoId>.json` file per song in app data as on Android,
//! and the synced lyrics written next to a downloaded song.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, ErrorResponse};
use crate::security::validation::validate_video_id;

type CmdResult<T> = Result<T, ErrorResponse>;

/// Far above any song's lyrics, so a bad write cannot fill the disk.
const MAX_LYRICS_BYTES: usize = 2 * 1024 * 1024;

fn cache_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(format!("No app data dir: {error}")))?
        .join("lyrics"))
}

fn cache_file(app: &AppHandle, video_id: &str) -> CmdResult<PathBuf> {
    validate_video_id(video_id).map_err(ErrorResponse::from)?;
    Ok(cache_dir(app)?.join(format!("{}.json", video_id.trim())))
}

fn check_size(text: &str) -> CmdResult<()> {
    if text.len() > MAX_LYRICS_BYTES {
        return Err(ErrorResponse::from(AppError::Validation(
            "Lyrics are too large".into(),
        )));
    }
    Ok(())
}

fn io_error(error: &std::io::Error) -> ErrorResponse {
    ErrorResponse::from(AppError::Internal(error.to_string()))
}

/// Writes through a temporary file, so a crash mid-write never leaves half a cache entry.
async fn write_atomically(path: &Path, text: &str) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| io_error(&e))?;
    }
    let partial = path.with_extension("json.partial");
    tokio::fs::write(&partial, text)
        .await
        .map_err(|e| io_error(&e))?;
    tokio::fs::rename(&partial, path)
        .await
        .map_err(|e| io_error(&e))
}

#[tauri::command]
pub async fn get_cached_lyrics(app: AppHandle, video_id: String) -> CmdResult<Option<String>> {
    let path = cache_file(&app, &video_id)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(&error)),
    }
}

#[tauri::command]
pub async fn put_cached_lyrics(app: AppHandle, video_id: String, entries: String) -> CmdResult<()> {
    check_size(&entries)?;
    let path = cache_file(&app, &video_id)?;
    write_atomically(&path, &entries).await
}

#[tauri::command]
pub async fn evict_cached_lyrics(app: AppHandle, video_id: String) -> CmdResult<()> {
    let path = cache_file(&app, &video_id)?;
    match tokio::fs::remove_file(&path).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_error(&error)),
        _ => Ok(()),
    }
}

async fn dir_size(dir: &Path) -> u64 {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };
    let mut total = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(metadata) = entry.metadata().await
            && metadata.is_file()
        {
            total += metadata.len();
        }
    }
    total
}

#[tauri::command]
pub async fn lyrics_cache_size(app: AppHandle) -> CmdResult<u64> {
    Ok(dir_size(&cache_dir(&app)?).await)
}

#[tauri::command]
pub async fn clear_lyrics_cache(app: AppHandle) -> CmdResult<()> {
    match tokio::fs::remove_dir_all(cache_dir(&app)?).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_error(&error)),
        _ => Ok(()),
    }
}

/// "Save lyrics as an .lrc file" for downloaded songs; on unless turned off.
const LYRICS_FILE_KEY: &str = "download_lyrics_file";

/// Writes the lyrics the provider chain found into a downloaded song's tags, and into
/// an `.lrc` file beside it when they are synced and the user wants the file.
#[tauri::command]
pub async fn save_download_lyrics(
    video_id: String,
    lrc: String,
    pool: State<'_, SqlitePool>,
) -> CmdResult<bool> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    check_size(&lrc)?;
    if lrc.trim().is_empty() {
        return Ok(false);
    }
    let Some(record) =
        crate::db::downloads::download_by_video_id(&pool, video_id.trim(), &["music", "audio"])
            .await
            .map_err(ErrorResponse::from)?
    else {
        return Ok(false);
    };
    if tokio::fs::metadata(&record.file_path).await.is_err() {
        return Ok(false);
    }
    // A clipped song's lyrics are the clip's lyrics: timed lines shift to the
    // clip start, lines before it are dropped, and a clip with no timed lines
    // left saves nothing. Plain (unsynced) lyrics pass through untouched —
    // they carry no timing to shift.
    let lrc = match (record.clip_start_ms, record.clip_end_ms) {
        (Some(start_ms), Some(end_ms)) => match shift_lrc(&lrc, start_ms, end_ms) {
            Some(shifted) => shifted,
            None => return Ok(false),
        },
        _ => lrc,
    };
    let media_path = Path::new(&record.file_path);
    let wants_file = crate::db::settings::get_setting(&pool, LYRICS_FILE_KEY)
        .await
        .ok()
        .flatten()
        .is_none_or(|value| value != "false");
    if wants_file && is_synced_lrc(&lrc) {
        tokio::fs::write(media_path.with_extension("lrc"), &lrc)
            .await
            .map_err(|e| io_error(&e))?;
    }
    if let Err(error) = crate::commands::downloads::embed_download_lyrics(media_path, lrc).await {
        tracing::warn!(video_id = %video_id, %error, "Could not embed lyrics into a download");
    }
    Ok(true)
}

/// Shifts synced `[mm:ss.xx]` lyric lines into a clip: lines before the clip
/// are dropped, the rest move so the clip starts at zero. Metadata tags
/// (`[ti:…]`, `[ar:…]`) and untimed lines pass through. `None` when the lyrics
/// had timed lines and none survived the clip; plain lyrics (no timed lines at
/// all) come back unchanged.
fn shift_lrc(lrc: &str, clip_start_ms: i64, clip_end_ms: i64) -> Option<String> {
    let mut out = String::new();
    let mut timed = 0_usize;
    let mut kept = 0_usize;
    for line in lrc.lines() {
        let trimmed = line.trim_start();
        let Some(tag) = trimmed.strip_prefix('[') else {
            out.push_str(line);
            out.push('\n');
            continue;
        };
        let Some(close) = tag.find(']') else {
            out.push_str(line);
            out.push('\n');
            continue;
        };
        let Some(ms) = lrc_time_ms(&tag[..close]) else {
            out.push_str(line);
            out.push('\n');
            continue;
        };
        timed += 1;
        if ms < clip_start_ms || ms >= clip_end_ms {
            continue;
        }
        kept += 1;
        let _ = write!(
            out,
            "[{}]{}",
            format_lrc_time(ms - clip_start_ms),
            &trimmed[close + 2..]
        );
        out.push('\n');
    }
    if timed > 0 && kept == 0 {
        return None;
    }
    Some(out)
}

/// `[mm:ss.xx]` / `[mm:ss]` / `[hh:mm:ss.xx]` → milliseconds. `None` for
/// metadata tags like `[ti:…]`.
fn lrc_time_ms(content: &str) -> Option<i64> {
    let parts: Vec<&str> = content.split(':').collect();
    match parts.as_slice() {
        [minutes, seconds] => {
            Some(minutes.parse::<i64>().ok()? * 60_000 + parse_lrc_seconds(seconds)?)
        }
        [hours, minutes, seconds] => Some(
            hours.parse::<i64>().ok()? * 3_600_000
                + minutes.parse::<i64>().ok()? * 60_000
                + parse_lrc_seconds(seconds)?,
        ),
        _ => None,
    }
}

fn parse_lrc_seconds(value: &str) -> Option<i64> {
    match value.split_once('.') {
        Some((seconds, fraction)) => {
            let seconds = seconds.parse::<i64>().ok()?;
            let mut fraction = fraction.to_string();
            while fraction.len() < 3 {
                fraction.push('0');
            }
            let millis = fraction[..3].parse::<i64>().ok()?;
            Some(seconds * 1000 + millis)
        }
        None => value.parse::<i64>().ok().map(|seconds| seconds * 1000),
    }
}

fn format_lrc_time(ms: i64) -> String {
    let total_seconds = ms / 1000;
    format!(
        "{:02}:{:02}.{:02}",
        total_seconds / 60,
        total_seconds % 60,
        (ms % 1000) / 10
    )
}

/// True when the text has at least one `[mm:ss…]` time tag.
fn is_synced_lrc(text: &str) -> bool {
    text.lines().any(|line| {
        let Some(rest) = line.trim_start().strip_prefix('[') else {
            return false;
        };
        let mut parts = rest.splitn(2, ':');
        let minutes = parts.next().unwrap_or_default();
        let seconds = parts.next().unwrap_or_default();
        !minutes.is_empty()
            && minutes.chars().all(|c| c.is_ascii_digit())
            && seconds.chars().next().is_some_and(|c| c.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_timed_text_counts_as_synced() {
        assert!(is_synced_lrc("[ar:M83]\n[00:12.30]Waiting in a car"));
        assert!(!is_synced_lrc("[ar:M83]\nWaiting in a car"));
        assert!(!is_synced_lrc("Waiting in a car"));
    }

    #[tokio::test]
    async fn the_cache_size_counts_every_file() {
        let dir =
            std::env::temp_dir().join(format!("youglidetube-lyrics-test-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&dir).await;
        assert_eq!(dir_size(&dir).await, 0);
        write_atomically(&dir.join("aaaaaaaaaaa.json"), "[1]")
            .await
            .unwrap();
        write_atomically(&dir.join("bbbbbbbbbbb.json"), "[12]")
            .await
            .unwrap();
        assert_eq!(dir_size(&dir).await, 7);
        assert!(!dir.join("aaaaaaaaaaa.json.partial").exists());
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }

    #[test]
    fn oversized_lyrics_are_refused() {
        assert!(check_size("x").is_ok());
        assert!(check_size(&"x".repeat(MAX_LYRICS_BYTES + 1)).is_err());
    }

    #[test]
    fn clip_shifts_synced_lyrics_to_the_clip_start() {
        let lrc = "[ti:Song]\n[ar:M83]\n[00:12.30]Waiting in a car\n[01:05.00]Inside the clip\n[02:00.00]After the clip\n";
        let shifted = shift_lrc(lrc, 60_000, 70_000).expect("a line survives");
        assert!(shifted.contains("[ti:Song]\n[ar:M83]\n"));
        assert!(shifted.contains("[00:05.00]Inside the clip\n"));
        assert!(!shifted.contains("Waiting in a car"));
        assert!(!shifted.contains("After the clip"));
    }

    #[test]
    fn a_clip_with_no_timed_lines_saves_nothing() {
        let lrc = "[00:12.30]Waiting in a car\n";
        assert!(shift_lrc(lrc, 60_000, 70_000).is_none());
    }

    #[test]
    fn plain_lyrics_have_no_timing_to_shift() {
        let lrc = "[ar:M83]\nWaiting in a car\n";
        assert_eq!(shift_lrc(lrc, 60_000, 70_000).as_deref(), Some(lrc));
    }
}
