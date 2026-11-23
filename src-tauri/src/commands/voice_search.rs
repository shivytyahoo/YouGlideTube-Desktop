//! Voice search: one spoken query through the OS speech recognizer.
//!
//! The frontend calls this instead of the Web Speech API, which the
//! desktop webviews do not expose; see `services::voice_search`.

use crate::errors::ErrorResponse;
use crate::services::voice_search;

type CmdResult<T> = Result<T, ErrorResponse>;

/// Listens once on the OS recognizer and returns the recognised text, or
/// `None` when the user cancelled before speaking. `lang` is a BCP-47 tag
/// such as `en-US`.
#[tauri::command]
pub async fn voice_search_listen(lang: Option<String>) -> CmdResult<Option<String>> {
    voice_search::listen(lang)
        .await
        .map_err(ErrorResponse::from)
}

/// Cancels an in-flight `voice_search_listen`, if any.
#[tauri::command]
pub fn voice_search_cancel() -> CmdResult<()> {
    voice_search::cancel();
    Ok(())
}
