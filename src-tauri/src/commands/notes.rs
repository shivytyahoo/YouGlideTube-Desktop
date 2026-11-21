use sqlx::SqlitePool;
use tauri::State;

use crate::commands::backup::sync_err;
use crate::db::notes::{self, NoteRow};
use crate::errors::{AppError, ErrorResponse};
use crate::services::notes_service::{self, NoteSubject};

/// Every note this build can show, newest edit first.
#[tauri::command]
pub async fn list_notes(pool: State<'_, SqlitePool>) -> Result<Vec<NoteRow>, ErrorResponse> {
    let rows = notes::all(&pool)
        .await
        .map_err(|e| ErrorResponse::from(AppError::from(e)))?;
    Ok(rows
        .into_iter()
        .filter(|row| row.kind == "Video" || row.kind == "Channel")
        .collect())
}

#[tauri::command]
pub async fn save_note(
    kind: String,
    target_id: String,
    text: String,
    subject: Option<NoteSubject>,
    pool: State<'_, SqlitePool>,
) -> Result<Option<NoteRow>, ErrorResponse> {
    if !matches!(kind.as_str(), "Video" | "Channel") || target_id.trim().is_empty() {
        return Err(AppError::Validation("Unknown note target".into()).into());
    }
    let saved = notes_service::save_note(&pool, &kind, &target_id, &text, subject)
        .await
        .map_err(sync_err)?;
    Ok(saved)
}

#[tauri::command]
pub async fn delete_notes(
    ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    notes_service::delete_notes(&pool, &ids)
        .await
        .map_err(sync_err)?;
    Ok(())
}

#[tauri::command]
pub async fn save_note_subject(
    kind: String,
    target_id: String,
    subject: NoteSubject,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    notes_service::fill_subject(&pool, &notes_service::note_id(&kind, &target_id), subject)
        .await
        .map_err(sync_err)?;
    Ok(())
}

/// Stays on this device: the hand-made order never travels.
#[tauri::command]
pub async fn save_notes_order(
    ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    notes_service::save_order(&pool, &ids)
        .await
        .map_err(sync_err)
}

#[tauri::command]
pub async fn restore_notes(
    notes: Vec<NoteRow>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<NoteRow>, ErrorResponse> {
    let restored = notes_service::restore_notes(&pool, notes)
        .await
        .map_err(sync_err)?;
    Ok(restored)
}
