//! Google sign-in for YouGlideTube. This is the Tauri port of the CMP
//! app's WebView sign-in (Android's `GoogleLoginActivity` sign-in): a second
//! webview opens Google's sign-in page, the session cookies are captured,
//! and every InnerTube call then carries `SAPISIDHASH` auth.

pub mod identity;
pub mod login_window;
pub mod sapisid;
pub mod session;

pub use session::AuthSession;
