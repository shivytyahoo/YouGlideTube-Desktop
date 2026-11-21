//! The Google sign-in window: a second `WebviewWindow` showing Google's own
//! sign-in page, polled for the session cookies — the Tauri port of the CMP
//! app's `WebSignInFlow` (which itself mirrors the Android app's
//! `GoogleLoginActivity`).
//!
//! Flow:
//! 1. "Sign in" opens the window at [`sapisid::LOGIN_URL`].
//! 2. A background task polls the window's `Webview::cookies()` every 1.5 s.
//!    `cookies()` is synchronous and **deadlocks on Windows when called from
//!    a synchronous command or event handler**, so it is only ever called
//!    from a `spawn_blocking` thread — never from a command body and never
//!    from the main thread.
//! 3. As soon as the cookies prove a session (SAPISID + SID/HSID/LOGIN_INFO,
//!    Android's exact rule), the cookie header is persisted, the login
//!    window's browsing data is wiped (so the stored cookie is the only copy,
//!    like Android), the window is closed and the frontend is told via an
//!    event. Closing/cancelling the window leaves auth untouched — a
//!    half-finished sign-in can never leave the app half-logged-in, because
//!    the session only flips inside `AuthSession::sign_in` after validation
//!    + persistence.
//!
//! Events emitted to the frontend: `google-sign-in-completed`,
//! `google-sign-in-failed` (payload: the message), `google-sign-in-cancelled`.

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::sapisid::{self, cookies_to_header, is_signed_in_header};
use super::session::AuthSession;

/// Label of the sign-in window.
pub const LOGIN_WINDOW_LABEL: &str = "google-sign-in";

/// Emitted when the session was captured and stored; payload is empty.
pub const SIGN_IN_COMPLETED_EVENT: &str = "google-sign-in-completed";
/// Emitted when capturing failed; payload is the human-readable message.
pub const SIGN_IN_FAILED_EVENT: &str = "google-sign-in-failed";
/// Emitted when the window was closed before any session was captured.
pub const SIGN_IN_CANCELLED_EVENT: &str = "google-sign-in-cancelled";

/// How often the login window's cookies are polled (same as the CMP app).
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

/// Opens the sign-in window, or focuses it when it is already open.
/// Returns `true` when a fresh window was created (the caller should start
/// the poll task), `false` when an existing window was focused instead.
pub fn open_login_window(app: &tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = window.set_focus();
        return Ok(false);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_build = app.clone();
    let label = LOGIN_WINDOW_LABEL.to_string();
    app.run_on_main_thread(move || {
        let builder = WebviewWindowBuilder::new(
            &app_for_build,
            &label,
            WebviewUrl::External(
                sapisid::LOGIN_URL
                    .parse()
                    .expect("LOGIN_URL is a valid URL"),
            ),
        )
        .title("Sign in with Google — YouGlideTube")
        .inner_size(480.0, 680.0);
        // WebView2 refuses a second webview on the main window's data
        // directory with different arguments (see `webview2`).
        #[cfg(windows)]
        let builder = builder.additional_browser_args(crate::webview2::BROWSER_ARGS);
        let _ = tx.send(builder.build().map(|_| ()).map_err(|error| error.to_string()));
    })
    .map_err(|error| error.to_string())?;
    rx.recv()
        .map_err(|error| error.to_string())?
        .map(|()| true)
}

/// Closes the sign-in window if it is open. The poll task notices the
/// missing window and reports cancellation on its own.
pub fn close_login_window(app: &tauri::AppHandle) {
    let app_for_close = app.clone();
    let label = LOGIN_WINDOW_LABEL.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_close.get_webview_window(&label) {
            let _ = window.close();
        }
    });
}

/// Watches the sign-in window's cookies until a session is proven, the
/// window is closed, or capturing fails. Runs as a background task; never
/// call it from a command body.
pub async fn spawn_sign_in_poll(app: tauri::AppHandle, auth: Arc<AuthSession>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            let Some(window) = app.get_webview_window(LOGIN_WINDOW_LABEL) else {
                let _ = app.emit(SIGN_IN_CANCELLED_EVENT, ());
                return;
            };
            // cookies() is synchronous and deadlocks on Windows in sync
            // commands / event handlers — a dedicated blocking thread only.
            let window_for_cookies = window.clone();
            let cookies = tokio::task::spawn_blocking(move || window_for_cookies.cookies()).await;
            let Ok(Ok(cookies)) = cookies else {
                // Transient read failure (e.g. the window is mid-navigation):
                // keep polling; the window closing is what ends the flow.
                continue;
            };
            let header = cookies_to_header(&cookies);
            if !is_signed_in_header(&header) {
                continue;
            }
            match auth.sign_in(&header) {
                Ok(()) => {
                    // Wipe the login window's cookies so the stored cookie
                    // is the only copy, like Android does. Best-effort:
                    // on Linux this clears the shared WebKit context,
                    // which also holds the poToken minter's transient
                    // state — that is re-minted on demand.
                    let window_for_wipe = window.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        window_for_wipe.clear_all_browsing_data()
                    })
                    .await;
                    close_login_window(&app);
                    let _ = app.emit(SIGN_IN_COMPLETED_EVENT, ());
                    return;
                }
                Err(message) => {
                    close_login_window(&app);
                    let _ = app.emit(SIGN_IN_FAILED_EVENT, message);
                    return;
                }
            }
        }
    });
}
