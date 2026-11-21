//! Google sign-in for the YouGlideTube fork. Flow has no sign-in at all;
//! this is the Tauri port of the CMP app's WebView sign-in (Android's
//! `GoogleLoginActivity` flow): a second webview opens Google's sign-in
//! page, the session cookies are captured, and every InnerTube call then
//! carries `SAPISIDHASH` auth.

pub mod identity;
pub mod login_window;
pub mod sapisid;
pub mod session;

pub use session::AuthSession;
