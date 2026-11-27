//! Saving a finished download as one file beside the downloads: the finished
//! file is already a single muxed file, so the export copies it under the
//! video's own title instead of muxing it again.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use super::{download_error, naming};
use crate::db::downloads;
use crate::errors::ErrorResponse;

/// A title is capped at this many characters in the exported file name.
const MAX_EXPORT_TITLE_CHARS: usize = 120;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedDownload {
    pub file_path: String,
}

/// The exported file name's stem: the title, sanitized for the file system and
/// capped at 120 characters.
fn export_file_stem(title: &str) -> String {
    let stem = naming::sanitize_file_stem(title);
    let stem: String = stem.chars().take(MAX_EXPORT_TITLE_CHARS).collect();
    let stem = stem.trim_end_matches(['.', ' ']).to_string();
    if stem.is_empty() {
        "YouGlideTube download".to_string()
    } else {
        stem
    }
}

/// Where the single file goes: beside the downloads folder — the parent of the
/// folder the download itself lives in, one level up again for a collection item.
fn export_directory(media_path: &Path, in_collection: bool) -> PathBuf {
    let folder = media_path.parent();
    let root = if in_collection {
        folder.and_then(Path::parent)
    } else {
        folder
    };
    root.and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| {
            folder
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// Copies a finished download to one file beside the downloads, named after its
/// title. The path comes from the library row, never from the caller.
#[tauri::command]
pub async fn export_download_as_single_file(
    download_id: i64,
    pool: State<'_, SqlitePool>,
) -> Result<ExportedDownload, ErrorResponse> {
    let record = downloads::downloads_by_ids(&pool, &[download_id])
        .await
        .map_err(ErrorResponse::from)?
        .into_iter()
        .next()
        .ok_or_else(|| download_error("No saved download for this item"))?;
    let media_path = Path::new(&record.file_path);
    if !media_path.is_file() {
        return Err(download_error("The downloaded file is no longer available"));
    }
    let extension = media_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("mp4");
    let directory = export_directory(media_path, record.collection_db_id.is_some());
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| {
            download_error(format!(
                "Could not open the folder beside the downloads: {error}"
            ))
        })?;
    let stem = export_file_stem(&record.title);
    let target = naming::available_file_path(&directory, &stem, extension, &HashSet::new());
    tokio::fs::copy(media_path, &target)
        .await
        .map_err(|error| download_error(format!("Could not save the single file: {error}")))?;
    Ok(ExportedDownload {
        file_path: target.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_names_are_sanitized_and_capped() {
        assert_eq!(export_file_stem("A/B: Title?"), "A_B_ Title_");
        assert_eq!(export_file_stem("  title.  "), "title");
        assert_eq!(export_file_stem(""), "YouGlideTube download");
        let long = "a".repeat(200);
        assert_eq!(
            export_file_stem(&long).chars().count(),
            MAX_EXPORT_TITLE_CHARS
        );
        // A multibyte title hits the sanitizer's 239-byte cap first.
        let wide = "é".repeat(200);
        assert_eq!(export_file_stem(&wide).chars().count(), 119);
        assert_eq!(export_file_stem("CON"), "_CON");
    }

    #[test]
    fn exports_land_beside_the_downloads_folder() {
        assert_eq!(
            export_directory(Path::new("/home/user/Videos/YouGlideTube/Song.m4a"), false),
            PathBuf::from("/home/user/Videos")
        );
        assert_eq!(
            export_directory(
                Path::new("/home/user/Videos/YouGlideTube/My List/Video.mp4"),
                true
            ),
            PathBuf::from("/home/user/Videos")
        );
    }
}
