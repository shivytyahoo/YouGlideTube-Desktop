//! Moving the download folder: every saved file and unfinished job moves to the
//! new location, the library rows follow, and a failure anywhere rolls the
//! files back so nothing is left half-moved.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use super::{DownloadManager, DownloadMediaKind, download_error, naming, saved_subtitles};
use crate::db::download_jobs::DownloadJobRow;
use crate::db::downloads::DownloadRecord;
use crate::db::{download_collections, download_jobs, downloads, settings};
use crate::errors::{AppError, ErrorResponse};

const VIDEO_LOCATION_KEY: &str = "download_location";
const MUSIC_LOCATION_KEY: &str = "music_download_location";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDownloadFolderResult {
    pub moved_files: usize,
    pub moved_collections: usize,
    pub new_folder: String,
    /// Which folders the move rewrote: both when video and music shared one folder.
    pub moved_kinds: Vec<String>,
}

/// Everything one move has to do, collected before anything moves so a failure
/// part-way can be undone from this same list.
struct RelocationPlan {
    /// Files to move, in order: media and sidecars, then a job's partials.
    moves: Vec<(PathBuf, PathBuf)>,
    /// Library rows to repoint at their file's new home: `(row id, old path, new path)`.
    record_paths: Vec<(i64, String, String)>,
    /// Unfinished jobs to repoint: `(job id, old path, new path)`.
    job_paths: Vec<(String, String, String)>,
    /// Collections to repoint at their folder's new home.
    collection_paths: Vec<(i64, String, String)>,
    /// Location settings to rewrite: `(key, old folder, new folder)`.
    setting_updates: Vec<(String, String, String)>,
    /// Old collection folders to remove once their files have moved, when empty.
    old_collection_folders: Vec<PathBuf>,
    moved_kinds: Vec<String>,
}

/// The new home of a path under the old folder: the same path relative to the new folder.
fn relocated(path: &Path, old_folder: &Path, new_folder: &Path) -> Option<PathBuf> {
    path.strip_prefix(old_folder)
        .ok()
        .map(|relative| new_folder.join(relative))
}

fn is_under(path: &Path, folder: &Path) -> bool {
    path.strip_prefix(folder).is_ok()
}

fn kind_names(kind: DownloadMediaKind) -> &'static [&'static str] {
    match kind {
        DownloadMediaKind::Video => &["video"],
        DownloadMediaKind::Music | DownloadMediaKind::Audio => &["music", "audio"],
    }
}

fn setting_key(kind: DownloadMediaKind) -> &'static str {
    match kind {
        DownloadMediaKind::Video => VIDEO_LOCATION_KEY,
        DownloadMediaKind::Music | DownloadMediaKind::Audio => MUSIC_LOCATION_KEY,
    }
}

/// The files that travel with a saved download: the media itself, its poster,
/// lyrics and SponsorBlock companions, the `.srt` beside it, and a retag
/// partial an interrupted retag left behind.
fn record_files(record: &DownloadRecord) -> Vec<PathBuf> {
    let media_path = Path::new(&record.file_path);
    let mut files = vec![media_path.to_path_buf()];
    for extension in ["jpg", "png", "webp", "lrc", "sponsorblock.json"] {
        files.push(media_path.with_extension(extension));
    }
    for subtitle in saved_subtitles(record) {
        files.push(super::subtitles::srt_path(
            media_path,
            &subtitle.language_code,
        ));
    }
    if let Some(stem) = media_path.file_stem().and_then(|stem| stem.to_str())
        && let Some(parent) = media_path.parent()
    {
        for suffix in ["retag.youglidetube-part", "retag.flowpart"] {
            files.push(parent.join(format!("{stem}.{suffix}")));
        }
    }
    files
}

/// A job's partial files in its folder: `.‹job id›.…part` pieces the resume
/// logic reads back by id.
async fn job_partial_files(job: &DownloadJobRow) -> Vec<PathBuf> {
    let Some(dir) = Path::new(&job.file_path).parent() else {
        return Vec::new();
    };
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return Vec::new();
    };
    let prefix = format!(".{}.", job.id);
    let mut partials = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix)
            && (name.contains(".youglidetube-part") || name.contains(".flowpart"))
        {
            partials.push(entry.path());
        }
    }
    partials
}

/// A destination no file already occupies: the planned name, or the next free
/// `name (2)` when the new folder already holds one.
fn free_destination(dst: &Path, reserved: &mut HashSet<PathBuf>) -> PathBuf {
    if !dst.exists() && !reserved.contains(dst) {
        reserved.insert(dst.to_path_buf());
        return dst.to_path_buf();
    }
    let dir = dst.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = dst
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    let extension = dst
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    let free = naming::available_file_path(&dir, stem, extension, reserved);
    reserved.insert(free.clone());
    free
}

async fn plan_relocation(
    app: &AppHandle,
    pool: &SqlitePool,
    media_kind: DownloadMediaKind,
    new_folder: &Path,
) -> Result<RelocationPlan, ErrorResponse> {
    let old_video_folder = naming::resolve_destination_directory(
        app,
        DownloadMediaKind::Video,
        settings::get_setting(pool, VIDEO_LOCATION_KEY)
            .await
            .map_err(ErrorResponse::from)?
            .as_deref(),
    )?;
    let old_music_folder = naming::resolve_destination_directory(
        app,
        DownloadMediaKind::Music,
        settings::get_setting(pool, MUSIC_LOCATION_KEY)
            .await
            .map_err(ErrorResponse::from)?
            .as_deref(),
    )?;
    let old_folder = match media_kind {
        DownloadMediaKind::Video => old_video_folder.clone(),
        DownloadMediaKind::Music | DownloadMediaKind::Audio => old_music_folder.clone(),
    };
    if new_folder == old_folder {
        return Err(ErrorResponse::from(AppError::Validation(
            "That is already the download folder".into(),
        )));
    }
    if new_folder.starts_with(&old_folder) {
        return Err(ErrorResponse::from(AppError::Validation(
            "The new folder cannot sit inside the current download folder".into(),
        )));
    }
    // One shared folder moves both kinds together, and rewrites both settings.
    let shared = old_video_folder == old_music_folder;
    let kinds = if shared {
        vec![DownloadMediaKind::Video, DownloadMediaKind::Music]
    } else {
        vec![media_kind]
    };
    let moved_kinds: Vec<String> = kinds.iter().map(|kind| kind.as_str().to_string()).collect();
    let wanted: HashSet<&str> = kinds
        .iter()
        .flat_map(|kind| kind_names(*kind))
        .copied()
        .collect();
    let wanted_collections: HashSet<&str> = kinds
        .iter()
        .map(|kind| match kind {
            DownloadMediaKind::Video => "playlist",
            DownloadMediaKind::Music | DownloadMediaKind::Audio => "album",
        })
        .collect();

    let mut plan = RelocationPlan {
        moves: Vec::new(),
        record_paths: Vec::new(),
        job_paths: Vec::new(),
        collection_paths: Vec::new(),
        setting_updates: kinds
            .iter()
            .map(|kind| {
                let old = match kind {
                    DownloadMediaKind::Video => old_video_folder.clone(),
                    _ => old_music_folder.clone(),
                };
                (
                    setting_key(*kind).to_string(),
                    old.to_string_lossy().into_owned(),
                    new_folder.to_string_lossy().into_owned(),
                )
            })
            .collect(),
        old_collection_folders: Vec::new(),
        moved_kinds,
    };
    let mut reserved: HashSet<PathBuf> = HashSet::new();

    for record in downloads::list_downloads(pool)
        .await
        .map_err(ErrorResponse::from)?
    {
        if !wanted.contains(record.media_kind.as_str())
            || !is_under(Path::new(&record.file_path), &old_folder)
        {
            continue;
        }
        let media_path = PathBuf::from(&record.file_path);
        let Some(new_media) = relocated(&media_path, &old_folder, new_folder) else {
            continue;
        };
        let new_media = free_destination(&new_media, &mut reserved);
        for file in record_files(&record) {
            let Some(dst) = relocated(&file, &old_folder, new_folder) else {
                continue;
            };
            if file == media_path {
                // The media file's destination was already reserved above.
                if file.exists() {
                    plan.moves.push((file, new_media.clone()));
                }
            } else if file.exists() {
                plan.moves
                    .push((file, free_destination(&dst, &mut reserved)));
            }
        }
        plan.record_paths.push((
            record.id.unwrap_or_default(),
            record.file_path.clone(),
            new_media.to_string_lossy().into_owned(),
        ));
    }

    for job in download_jobs::list_jobs(pool)
        .await
        .map_err(ErrorResponse::from)?
    {
        if !is_under(Path::new(&job.file_path), &old_folder) {
            continue;
        }
        let job_path = PathBuf::from(&job.file_path);
        let Some(new_path) = relocated(&job_path, &old_folder, new_folder) else {
            continue;
        };
        let new_path = free_destination(&new_path, &mut reserved);
        if job_path.exists() {
            plan.moves.push((job_path.clone(), new_path.clone()));
        }
        for partial in job_partial_files(&job).await {
            let Some(dst) = relocated(&partial, &old_folder, new_folder) else {
                continue;
            };
            plan.moves
                .push((partial, free_destination(&dst, &mut reserved)));
        }
        plan.job_paths.push((
            job.id.clone(),
            job.file_path.clone(),
            new_path.to_string_lossy().into_owned(),
        ));
    }

    for collection in download_collections::list_collections(pool)
        .await
        .map_err(ErrorResponse::from)?
    {
        if !wanted_collections.contains(collection.kind.as_str())
            || !is_under(Path::new(&collection.folder_path), &old_folder)
        {
            continue;
        }
        let Some(new_folder_path) =
            relocated(Path::new(&collection.folder_path), &old_folder, new_folder)
        else {
            continue;
        };
        plan.collection_paths.push((
            collection.id.unwrap_or_default(),
            collection.folder_path.clone(),
            new_folder_path.to_string_lossy().into_owned(),
        ));
        plan.old_collection_folders
            .push(PathBuf::from(&collection.folder_path));
    }

    Ok(plan)
}

/// Moves one file, copying across drives when a rename cannot. The copy
/// deletes the source only after the bytes landed.
async fn move_file(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Could not create the new folder: {error}"))?;
    }
    match tokio::fs::rename(src, dst).await {
        Ok(()) => Ok(()),
        Err(error) => {
            // A rename across drives fails; a copy still works.
            tokio::fs::copy(src, dst).await.map_err(|copy_error| {
                format!(
                    "Could not move {}: {error} (copy also failed: {copy_error})",
                    src.display()
                )
            })?;
            tokio::fs::remove_file(src).await.map_err(|error| {
                format!(
                    "Could not remove the copied file {}: {error}",
                    src.display()
                )
            })?;
            Ok(())
        }
    }
}

/// Puts every moved file back where it was, newest first.
async fn rollback_moves(moved: &[(PathBuf, PathBuf)]) {
    for (src, dst) in moved.iter().rev() {
        if let Err(error) = move_file(dst, src).await {
            tracing::warn!(%error, src = %src.display(), "Could not roll a moved download back");
        }
    }
}

/// Applies the plan's database updates; the caller reverts them when one fails.
async fn apply_plan(pool: &SqlitePool, plan: &RelocationPlan) -> Result<(), ErrorResponse> {
    for (id, _, new_path) in &plan.record_paths {
        downloads::update_file_path(pool, *id, new_path)
            .await
            .map_err(ErrorResponse::from)?;
    }
    for (id, _, new_path) in &plan.job_paths {
        download_jobs::update_file_path(pool, id, new_path)
            .await
            .map_err(ErrorResponse::from)?;
    }
    for (id, _, new_folder) in &plan.collection_paths {
        download_collections::update_folder_path(pool, *id, new_folder)
            .await
            .map_err(ErrorResponse::from)?;
    }
    for (key, _, new_folder) in &plan.setting_updates {
        settings::set_setting(pool, key, new_folder)
            .await
            .map_err(ErrorResponse::from)?;
    }
    Ok(())
}

/// Reverts the database updates a failed move already applied, best effort.
async fn revert_plan(pool: &SqlitePool, plan: &RelocationPlan) {
    for (id, old_path, _) in &plan.record_paths {
        let _ = downloads::update_file_path(pool, *id, old_path).await;
    }
    for (id, old_path, _) in &plan.job_paths {
        let _ = download_jobs::update_file_path(pool, id, old_path).await;
    }
    for (id, old_folder, _) in &plan.collection_paths {
        let _ = download_collections::update_folder_path(pool, *id, old_folder).await;
    }
    for (key, old_folder, _) in &plan.setting_updates {
        let _ = settings::set_setting(pool, key, old_folder).await;
    }
}

/// Moves the download folder: refuses while downloads run, moves every saved
/// file and unfinished job, then repoints the library at the new location.
/// Any failure rolls the files back and restores the old rows.
#[tauri::command]
pub async fn move_download_folder(
    media_kind: DownloadMediaKind,
    new_folder: String,
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<MoveDownloadFolderResult, ErrorResponse> {
    if manager.has_active_downloads() {
        return Err(ErrorResponse::from(AppError::Validation(
            "Downloads are still running: wait for them to finish before moving the folder".into(),
        )));
    }
    let new_folder = PathBuf::from(new_folder.trim());
    if !new_folder.is_absolute() {
        return Err(ErrorResponse::from(AppError::Validation(
            "The new download folder must be an absolute path".into(),
        )));
    }
    tokio::fs::create_dir_all(&new_folder)
        .await
        .map_err(|error| download_error(format!("Could not create the new folder: {error}")))?;
    let plan = plan_relocation(&app, &pool, media_kind, &new_folder).await?;
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (src, dst) in &plan.moves {
        if let Err(error) = move_file(src, dst).await {
            rollback_moves(&moved).await;
            return Err(download_error(error));
        }
        moved.push((src.clone(), dst.clone()));
    }
    // Only removes a collection folder its own files left empty.
    for folder in &plan.old_collection_folders {
        let _ = tokio::fs::remove_dir(folder).await;
    }
    if let Err(error) = apply_plan(&pool, &plan).await {
        revert_plan(&pool, &plan).await;
        rollback_moves(&moved).await;
        return Err(error);
    }
    Ok(MoveDownloadFolderResult {
        moved_files: moved.len(),
        moved_collections: plan.collection_paths.len(),
        new_folder: new_folder.to_string_lossy().into_owned(),
        moved_kinds: plan.moved_kinds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_relocate_by_relative_position() {
        let old = Path::new("/old/YouGlideTube");
        let new = Path::new("/new/YouGlideTube");
        assert_eq!(
            relocated(Path::new("/old/YouGlideTube/Song.m4a"), old, new).as_deref(),
            Some(Path::new("/new/YouGlideTube/Song.m4a"))
        );
        assert_eq!(
            relocated(Path::new("/old/YouGlideTube/List/Video.mp4"), old, new).as_deref(),
            Some(Path::new("/new/YouGlideTube/List/Video.mp4"))
        );
        assert!(relocated(Path::new("/elsewhere/Song.m4a"), old, new).is_none());
        assert!(is_under(Path::new("/old/YouGlideTube/Song.m4a"), old));
        assert!(!is_under(Path::new("/old/YouGlideTube2/Song.m4a"), old));
    }

    #[test]
    fn a_records_companions_travel_with_it() {
        let record = DownloadRecord {
            file_path: "/old/YouGlideTube/Video.mp4".into(),
            subtitles_json: Some(
                r#"[{"languageCode": "en", "label": "English", "path": "/data/s.vtt", "isAutoGenerated": false}]"#
                    .into(),
            ),
            ..DownloadRecord::default()
        };
        let files = record_files(&record);
        assert!(files.contains(&PathBuf::from("/old/YouGlideTube/Video.mp4")));
        assert!(files.contains(&PathBuf::from("/old/YouGlideTube/Video.jpg")));
        assert!(files.contains(&PathBuf::from("/old/YouGlideTube/Video.lrc")));
        assert!(files.contains(&PathBuf::from("/old/YouGlideTube/Video.sponsorblock.json")));
        assert!(files.contains(&PathBuf::from("/old/YouGlideTube/Video.en.srt")));
        assert!(files.contains(&PathBuf::from(
            "/old/YouGlideTube/Video.retag.youglidetube-part"
        )));
    }

    #[test]
    fn a_taken_destination_gets_the_next_free_name() {
        let dir =
            std::env::temp_dir().join(format!("youglidetube-relocate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Song.m4a"), b"x").unwrap();
        let mut reserved: HashSet<PathBuf> = HashSet::new();
        assert_eq!(
            free_destination(&dir.join("Other.m4a"), &mut reserved),
            dir.join("Other.m4a")
        );
        assert_eq!(
            free_destination(&dir.join("Song.m4a"), &mut reserved),
            dir.join("Song (2).m4a")
        );
        assert_eq!(
            free_destination(&dir.join("Song.m4a"), &mut reserved),
            dir.join("Song (3).m4a")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
