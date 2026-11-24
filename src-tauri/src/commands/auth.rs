//! Google sign-in commands: status, the WebView login flow, manual cookie
//! paste (advanced fallback), multi-account switching, and sign-out.
//!
//! The login flow itself lives in `crate::auth::login_window`: the command
//! only opens the window and starts the background poll task. `cookies()`
//! is never called from a command body — it deadlocks on Windows in sync
//! commands, so it only runs on a `spawn_blocking` thread inside the poll
//! task.
//!
//! Every account switch, removal, and sign-out that changes which account
//! is active emits `google-account-switched` (payload: the new active
//! account, or null when the app is a guest again) so the server surfaces
//! reload under the new account. The visitor identity is re-minted with
//! the switch, like Android resetting `visitorData` on apply.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::api::innertube::InnertubeClient;
use crate::auth::AuthSession;
use crate::auth::identity::AccountInfo;
use crate::auth::login_window;
use crate::auth::session::{ACCOUNT_SWITCHED_EVENT, AccountSummary};
use crate::errors::{AppError, ErrorResponse};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Whether a Google session is stored. The cookie itself is never
    /// exposed to the frontend.
    pub signed_in: bool,
    /// The cached account identity, if one was fetched (or restored).
    /// Absent until the first `get_account_info` call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountInfo>,
}

#[tauri::command]
pub async fn get_auth_status(
    auth: State<'_, Arc<AuthSession>>,
) -> Result<AuthStatus, ErrorResponse> {
    Ok(AuthStatus {
        signed_in: auth.is_signed_in(),
        account: auth.identity(),
    })
}

/// Fetches the signed-in account's display identity from InnerTube
/// `account/account_menu` (Android's `YouTube.accountInfo()`) and caches
/// it next to the session, so the top bar and the Account settings tab
/// show the real name without a round trip on every launch. Errors while
/// signed out, or when the menu carries no account.
#[tauri::command]
pub async fn get_account_info(
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<AccountInfo, ErrorResponse> {
    let info = extractor
        .account_info()
        .await
        .map_err(ErrorResponse::from)?;
    auth.set_identity(info.clone());
    Ok(info)
}

/// Opens the Google sign-in window (or focuses it when already open) and
/// starts polling its cookies for a session. Idempotent when already
/// signed in: there is nothing to sign into — use `add_account` to sign
/// in with another account while one is active.
#[tauri::command]
pub async fn start_google_sign_in(
    app: AppHandle,
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<(), ErrorResponse> {
    if auth.is_signed_in() {
        return Ok(());
    }
    match login_window::open_login_window(&app) {
        Ok(true) => {
            login_window::spawn_sign_in_poll(app, auth.inner().clone(), extractor.inner().clone())
                .await;
            Ok(())
        }
        Ok(false) => Ok(()),
        Err(message) => Err(ErrorResponse::from(AppError::Internal(message))),
    }
}

/// Closes the sign-in window without signing in. The poll task notices the
/// missing window and reports cancellation; the auth session is untouched.
#[tauri::command]
pub async fn cancel_google_sign_in(app: AppHandle) -> Result<(), ErrorResponse> {
    login_window::close_login_window(&app);
    Ok(())
}

/// Every saved Google account, oldest first, with the active one flagged.
/// Display fields only — cookies never leave the backend.
#[tauri::command]
pub async fn list_accounts(
    auth: State<'_, Arc<AuthSession>>,
) -> Result<Vec<AccountSummary>, ErrorResponse> {
    Ok(auth.list_accounts())
}

/// Makes a saved account the active one: its session applies to every
/// InnerTube call from here on, the visitor identity is re-minted for it,
/// and the frontend reloads every server surface through
/// `google-account-switched`.
#[tauri::command]
pub async fn switch_account(
    app: AppHandle,
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
    id: String,
) -> Result<AccountSummary, ErrorResponse> {
    let summary = auth
        .switch_account(&id)
        .map_err(|message| ErrorResponse::from(AppError::Validation(message)))?;
    extractor.reset_visitor_identity();
    let _ = app.emit(ACCOUNT_SWITCHED_EVENT, summary.clone());
    Ok(summary)
}

/// Opens the Google sign-in window to add another account. Unlike
/// `start_google_sign_in` this works while signed in: the captured
/// session joins the saved accounts and becomes active instead of
/// replacing the current one.
#[tauri::command]
pub async fn add_account(
    app: AppHandle,
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<(), ErrorResponse> {
    match login_window::open_login_window(&app) {
        Ok(true) => {
            login_window::spawn_sign_in_poll(app, auth.inner().clone(), extractor.inner().clone())
                .await;
            Ok(())
        }
        Ok(false) => Ok(()),
        Err(message) => Err(ErrorResponse::from(AppError::Internal(message))),
    }
}

/// Removes one saved account. Removing the active one activates the next
/// saved account; with none left the app is a guest again. Returns the
/// account that is active afterwards, if any.
#[tauri::command]
pub async fn remove_account(
    app: AppHandle,
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
    id: String,
) -> Result<Option<AccountSummary>, ErrorResponse> {
    let was_active = auth.active_account_id().as_deref() == Some(id.as_str());
    let next = auth
        .remove_account(&id)
        .map_err(|message| ErrorResponse::from(AppError::Validation(message)))?;
    if was_active {
        extractor.reset_visitor_identity();
        let _ = app.emit(ACCOUNT_SWITCHED_EVENT, next.clone());
    }
    Ok(next)
}

/// Deletes the stored session and wipes the main window's browsing data so
/// no copy of the session survives. Best-effort wipe: on Linux the WebKit
/// context is shared, so this also clears the poToken minter's transient
/// state — that is re-minted on demand.
///
/// Signs out of the ACTIVE account only: the next saved account (if any)
/// becomes active and the app stays signed in under it; with none left the
/// app is a guest again.
#[tauri::command]
pub async fn sign_out(
    app: AppHandle,
    extractor: State<'_, Arc<InnertubeClient>>,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<(), ErrorResponse> {
    let had_active = auth.active_account_id().is_some();
    let next_active = auth.sign_out();
    if next_active.is_some() {
        extractor.reset_visitor_identity();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = tokio::task::spawn_blocking(move || window.clear_all_browsing_data()).await;
    }
    if had_active {
        let _ = app.emit(ACCOUNT_SWITCHED_EVENT, next_active);
    }
    Ok(())
}
