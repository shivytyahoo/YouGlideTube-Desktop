//! Best-effort extras of a finished download: the poster image beside it when asked
//! for, the app's own cover copy, and `SponsorBlock` segments for the library. Lyrics
//! are saved by `save_download_lyrics` once the provider chain has them.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::{DownloadMediaKind, ProgressEmitter};
use crate::commands::youtube::fetch_sponsorblock_segments;
use crate::db::settings::get_setting;

/// "Also save a poster image next to the file"; the cover is always embedded.
const POSTER_SIDECAR_KEY: &str = "download_poster_sidecar";
const SPONSORBLOCK_ENABLED_KEY: &str = "sponsorblock_enabled";
const SPONSORBLOCK_SERVER_KEY: &str = "sponsorblock_server";
const COVER_STORE_DIR: &str = "download_covers";

/// Keeps the app's own copy of the cover in app data, for the library and offline UI.
pub async fn store_cover(app: &AppHandle, id: &str, jpeg: &[u8]) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?.join(COVER_STORE_DIR);
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let path = dir.join(format!("{id}.jpg"));
    tokio::fs::write(&path, jpeg).await.ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// A download that has just been moved to its final name.
pub struct FinishedFile<'a> {
    pub media_kind: DownloadMediaKind,
    pub media_path: &'a Path,
    pub cover: Option<&'a [u8]>,
    /// The muxer already put the cover inside the media file.
    pub cover_in_file: bool,
}

pub async fn write_sidecars(file: &FinishedFile<'_>, emitter: &ProgressEmitter, pool: &SqlitePool) {
    if let Some(cover) = file.cover {
        write_cover(file, cover, emitter, pool).await;
    }
}

/// A video's `SponsorBlock` segments as JSON, kept with the download so skipping works
/// offline. Asked for only when `SponsorBlock` is on, so no video id is sent otherwise.
pub async fn sponsorblock_segments(
    pool: &SqlitePool,
    video_id: &str,
    emitter: &ProgressEmitter,
) -> Option<String> {
    let enabled = get_setting(pool, SPONSORBLOCK_ENABLED_KEY)
        .await
        .ok()
        .flatten()
        .is_none_or(|value| value != "false");
    if !enabled {
        return None;
    }
    let server = get_setting(pool, SPONSORBLOCK_SERVER_KEY)
        .await
        .ok()
        .flatten()
        .filter(|server| !server.trim().is_empty());
    match fetch_sponsorblock_segments(video_id, server.as_deref()).await {
        Ok(segments) if segments.as_array().is_some_and(|list| !list.is_empty()) => {
            serde_json::to_string(&segments).ok()
        }
        Ok(_) => None,
        Err(error) => {
            emitter.log(format!("Could not save SponsorBlock segments: {error}"));
            None
        }
    }
}

/// Shifts `SponsorBlock` segments into a clip's time: segments outside the
/// clip are dropped, the rest are clamped to it and shifted so the clip starts
/// at zero. `None` when no segment survives, so nothing is recorded.
pub fn shift_segments_for_clip(json: &str, clip: super::ClipRange) -> Option<String> {
    let segments: Vec<serde_json::Value> = serde_json::from_str(json).ok()?;
    let start = clip.start_ms as f64 / 1000.0;
    let end = clip.end_ms as f64 / 1000.0;
    let mut kept = Vec::new();
    for mut segment in segments {
        let Some(bounds) = segment.get("segment").and_then(|value| value.as_array()) else {
            continue;
        };
        let (Some(from), Some(to)) = (
            bounds.first().and_then(|value| value.as_f64()),
            bounds.get(1).and_then(|value| value.as_f64()),
        ) else {
            continue;
        };
        if to <= start || from >= end {
            continue;
        }
        let shifted = [from.max(start) - start, to.min(end) - start];
        if shifted[1] <= shifted[0] {
            continue;
        }
        if let Some(object) = segment.as_object_mut() {
            object.insert("segment".to_string(), serde_json::json!(shifted));
        }
        kept.push(segment);
    }
    if kept.is_empty() {
        return None;
    }
    serde_json::to_string(&kept).ok()
}

async fn write_cover(
    file: &FinishedFile<'_>,
    cover: &[u8],
    emitter: &ProgressEmitter,
    pool: &SqlitePool,
) {
    let mut embedded = file.cover_in_file;
    if !embedded
        && matches!(
            file.media_kind,
            DownloadMediaKind::Music | DownloadMediaKind::Audio
        )
    {
        // Audio saved as the original stream is tagged in place after the fact.
        match embed_cover(file.media_path.to_path_buf(), cover.to_vec()).await {
            Ok(()) => embedded = true,
            Err(error) => emitter.log(format!(
                "Could not embed cover art (saving it beside the file instead): {error}"
            )),
        }
    }
    if embedded {
        emitter.log("Embedded cover art into the media file");
    }

    let wants_sidecar = get_setting(pool, POSTER_SIDECAR_KEY)
        .await
        .ok()
        .flatten()
        .is_some_and(|value| value == "true");
    // A cover that could not go inside the file is never silently lost.
    if wants_sidecar || !embedded {
        match write_poster_file(file.media_path, cover).await {
            Ok(Some(path)) => emitter.log(format!("Saved poster image to `{}`", path.display())),
            Ok(None) => emitter.log("A file with the poster's name already exists; left it alone"),
            Err(error) => emitter.log(format!("Could not save the poster image: {error}")),
        }
    }
}

/// Writes `<media>.jpg` unless something else already owns that name.
async fn write_poster_file(media_path: &Path, jpeg: &[u8]) -> Result<Option<PathBuf>, String> {
    let path = media_path.with_extension("jpg");
    if tokio::fs::try_exists(&path).await.unwrap_or(true) {
        return Ok(None);
    }
    tokio::fs::write(&path, jpeg)
        .await
        .map_err(|error| format!("could not write image: {error}"))?;
    Ok(Some(path))
}

async fn embed_cover(media_path: PathBuf, jpeg: Vec<u8>) -> Result<(), String> {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::probe::Probe;
    use lofty::tag::{Tag, TagExt};

    tokio::task::spawn_blocking(move || {
        let tagged = Probe::open(&media_path)
            .map_err(|error| format!("could not probe media file: {error}"))?
            .read()
            .map_err(|error| format!("could not read media file: {error}"))?;
        let mut tag = tagged
            .primary_tag()
            .cloned()
            .unwrap_or_else(|| Tag::new(tagged.primary_tag_type()));
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(
            Picture::unchecked(jpeg)
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Jpeg)
                .build(),
        );
        tag.save_to_path(&media_path, WriteOptions::default())
            .map_err(|error| format!("could not write cover art: {error}"))
    })
    .await
    .map_err(|error| format!("embed task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::super::ClipRange;
    use super::shift_segments_for_clip;

    fn segments() -> String {
        r#"[{"segment":[10.0,20.0],"category":"sponsor","UUID":"a"},{"segment":[65.0,75.0],"category":"intro","UUID":"b"},{"segment":[130.0,140.0],"category":"outro","UUID":"c"}]"#
            .to_string()
    }

    #[test]
    fn segments_shift_into_the_clip_and_keep_their_fields() {
        let clip = ClipRange::new(60_000, 120_000).unwrap();
        let shifted = shift_segments_for_clip(&segments(), clip).expect("one survives");
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&shifted).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["segment"], serde_json::json!([5.0, 15.0]));
        assert_eq!(parsed[0]["category"], "intro");
        assert_eq!(parsed[0]["UUID"], "b");
    }

    #[test]
    fn a_segment_spanning_the_clip_start_is_trimmed_to_it() {
        let clip = ClipRange::new(15_000, 120_000).unwrap();
        let shifted = shift_segments_for_clip(&segments(), clip).expect("two survive");
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&shifted).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0]["segment"], serde_json::json!([0.0, 5.0]));
        assert_eq!(parsed[1]["segment"], serde_json::json!([50.0, 60.0]));
    }

    #[test]
    fn no_segment_in_the_clip_records_nothing() {
        let clip = ClipRange::new(80_000, 90_000).unwrap();
        assert!(shift_segments_for_clip(&segments(), clip).is_none());
    }
}
