//! Google sign-in commands: status, the WebView login flow, manual cookie
//! paste (advanced fallback), and sign-out.
//!
//! The login flow itself lives in `crate::auth::login_window`: the command
//! only opens the window and starts the background poll task. `cookies()`
//! is never called from a command body — it deadlocks on Windows in sync
//! commands, so it only runs on a `spawn_blocking` thread inside the poll
//! task.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::api::innertube::InnertubeClient;
use crate::auth::identity::AccountInfo;
use crate::auth::login_window;
use crate::auth::AuthSession;
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
/// signed in: there is nothing to sign into.
#[tauri::command]
pub async fn start_google_sign_in(
    app: AppHandle,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<(), ErrorResponse> {
    if auth.is_signed_in() {
        return Ok(());
    }
    match login_window::open_login_window(&app) {
        Ok(true) => {
            login_window::spawn_sign_in_poll(app, auth.inner().clone()).await;
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

/// Advanced fallback: store a cookie header pasted by the user (the same
/// "paste cookies" option the CMP sign-in dialog offers). Validated with
/// Android's session rule before anything is persisted.
#[tauri::command]
pub async fn sign_in_with_cookie(
    auth: State<'_, Arc<AuthSession>>,
    cookie_header: String,
) -> Result<(), ErrorResponse> {
    auth.sign_in(&cookie_header)
        .map_err(|message| ErrorResponse::from(AppError::Validation(message)))
}

/// Deletes the stored session and wipes the main window's browsing data so
/// no copy of the session survives. Best-effort wipe: on Linux the WebKit
/// context is shared, so this also clears the poToken minter's transient
/// state — that is re-minted on demand.
#[tauri::command]
pub async fn sign_out(
    app: AppHandle,
    auth: State<'_, Arc<AuthSession>>,
) -> Result<(), ErrorResponse> {
    auth.sign_out();
    if let Some(window) = app.get_webview_window("main") {
        let _ = tokio::task::spawn_blocking(move || window.clear_all_browsing_data()).await;
    }
    Ok(())
}
