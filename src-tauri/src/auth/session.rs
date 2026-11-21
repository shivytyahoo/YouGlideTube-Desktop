//! The Google sign-in session: one stored `Cookie` header, restored on
//! startup, cleared on sign-out. Mirrors the CMP app's `JvmAuthSession`
//! (cookie file under the app-data dir, restrictive permissions).
//!
//! The cookie session always wins when both exist (Android
//! `OAuthSessionManager` rule); there is no TV-code OAuth session in this
//! app yet, so the cookie is the only session. The stored value is never
//! logged — not even its length in a debug message.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::identity::AccountInfo;
use super::sapisid::{self, AuthHeaders};

/// File holding the captured session cookies, inside the app-data dir.
const SESSION_FILE: &str = "google-session.txt";

/// File holding the fetched account identity (display name, handle,
/// photo URL — no secrets), next to the session file.
const IDENTITY_FILE: &str = "google-account.json";

/// The signed-in Google session: the raw `Cookie` header captured from the
/// login window, kept in memory and persisted to disk.
pub struct AuthSession {
    file: PathBuf,
    identity_file: PathBuf,
    cookie: RwLock<Option<String>>,
    identity: RwLock<Option<AccountInfo>>,
}

impl AuthSession {
    #[must_use]
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            file: app_data_dir.join(SESSION_FILE),
            identity_file: app_data_dir.join(IDENTITY_FILE),
            cookie: RwLock::new(None),
            identity: RwLock::new(None),
        }
    }

    /// Restores a previously stored session, if the stored cookies still
    /// prove one. A stale cookie (e.g. SAPISID expired out from under us)
    /// is deleted instead of restoring a session that can never
    /// authenticate. The cached identity is restored alongside it, so the
    /// top bar shows the account name before the first live fetch.
    pub fn restore(&self) {
        if let Some(identity) = std::fs::read_to_string(&self.identity_file)
            .ok()
            .and_then(|text| serde_json::from_str::<AccountInfo>(&text).ok())
        {
            *self.identity.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(identity);
        }
        let stored = std::fs::read_to_string(&self.file)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty());
        match stored {
            Some(header) if Self::is_valid_cookie(&header) => {
                *self.cookie.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(header);
            }
            Some(_) => {
                let _ = std::fs::remove_file(&self.file);
                *self.identity.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
                    None;
                let _ = std::fs::remove_file(&self.identity_file);
            }
            None => {}
        }
    }

    /// Stores a captured cookie header after validation. The session only
    /// flips once the header is validated *and* persisted, so a failed
    /// sign-in can never leave the app half-logged-in.
    pub fn sign_in(&self, cookie_header: &str) -> Result<(), String> {
        let header = cookie_header.trim();
        if !Self::is_valid_cookie(header) {
            return Err(
                "No signed-in session in these cookies. Sign in on Google's page first — \
                 the cookies must contain SAPISID plus SID, HSID or LOGIN_INFO \
                 (same rule as the Android app)."
                    .to_string(),
            );
        }
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&self.file, header).map_err(|error| error.to_string())?;
        restrict_permissions(&self.file);
        *self.cookie.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(header.to_string());
        Ok(())
    }

    /// Deletes the stored session. The caller also clears the webview's
    /// browsing data, so no copy of the session survives anywhere. The
    /// cached identity goes with it — it belongs to that session.
    pub fn sign_out(&self) {
        let _ = std::fs::remove_file(&self.file);
        let _ = std::fs::remove_file(&self.identity_file);
        *self.cookie.write().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self.identity.write().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    /// Stores a freshly fetched account identity (from
    /// `account/account_menu`) next to the session, so the top bar and
    /// the Account settings tab can show it without a network round trip.
    /// A failed write keeps the previous identity rather than dropping it.
    pub fn set_identity(&self, info: AccountInfo) {
        if let Some(parent) = self.identity_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(&info) {
            if std::fs::write(&self.identity_file, json).is_ok() {
                restrict_permissions(&self.identity_file);
            }
        }
        *self.identity.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(info);
    }

    /// The cached account identity, if one was fetched (or restored).
    #[must_use]
    pub fn identity(&self) -> Option<AccountInfo> {
        self.identity
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    #[must_use]
    pub fn is_signed_in(&self) -> bool {
        self.cookie
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
    }

    /// The stored `Cookie` header, if signed in. Callers must treat it as a
    /// secret: send it, never log it.
    #[must_use]
    pub fn cookie_header(&self) -> Option<String> {
        self.cookie
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Both signed-in headers for one InnerTube call, computed fresh so the
    /// SAPISIDHASH timestamp is never stale. `None` when signed out.
    #[must_use]
    pub fn auth_headers(&self) -> Option<AuthHeaders> {
        self.cookie_header()
            .as_deref()
            .and_then(sapisid::auth_headers)
    }

    /// Android's session proof (SAPISID + SID/HSID/LOGIN_INFO) plus a usable
    /// SAPISID, exactly like the CMP `JvmAuthSession.isValidCookie`.
    fn is_valid_cookie(cookie_header: &str) -> bool {
        sapisid::is_signed_in_header(cookie_header)
            && sapisid::authorization_header(
                cookie_header,
                sapisid::YOUTUBE_ORIGIN,
                sapisid::now_epoch_seconds(),
            )
            .is_some()
    }
}

/// Owner-only read/write on the session file, so other local users cannot
/// steal the session. Unix only; on Windows the app-data dir is already
/// per-user.
#[cfg(unix)]
fn restrict_permissions(file: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_file: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_session() -> (AuthSession, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "youglide-auth-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (AuthSession::new(&dir), dir)
    }

    const GOOD_COOKIE: &str = "SAPISID=abc123; SID=def456; other=1";

    #[test]
    fn sign_in_persists_and_restores() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(GOOD_COOKIE).is_ok());
        assert!(session.is_signed_in());
        assert!(dir.join(SESSION_FILE).exists());

        let restored = AuthSession::new(&dir);
        restored.restore();
        assert!(restored.is_signed_in());
        assert_eq!(restored.cookie_header().as_deref(), Some(GOOD_COOKIE));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_in_rejects_an_anonymous_cookie() {
        let (session, dir) = temp_session();
        assert!(session.sign_in("SAPISID=abc123; other=1").is_err());
        assert!(!session.is_signed_in());
        assert!(!dir.join(SESSION_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn restore_drops_a_stale_cookie() {
        let (session, dir) = temp_session();
        std::fs::write(dir.join(SESSION_FILE), "SAPISID=abc123; other=1").unwrap();
        session.restore();
        assert!(!session.is_signed_in());
        assert!(!dir.join(SESSION_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_out_deletes_the_file() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(GOOD_COOKIE).is_ok());
        session.sign_out();
        assert!(!session.is_signed_in());
        assert!(!dir.join(SESSION_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auth_headers_are_fresh_per_call() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(GOOD_COOKIE).is_ok());
        let first = session.auth_headers().unwrap();
        assert!(first.authorization.starts_with("SAPISIDHASH "));
        assert_eq!(first.cookie, GOOD_COOKIE);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn signed_out_has_no_headers() {
        let (session, dir) = temp_session();
        assert!(session.auth_headers().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn identity_persists_and_restores() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(GOOD_COOKIE).is_ok());
        let info = AccountInfo {
            name: Some("Shivam".to_string()),
            email: Some("shivam@example.com".to_string()),
            channel_handle: Some("@shivyt".to_string()),
            thumbnail_url: None,
        };
        session.set_identity(info.clone());
        assert_eq!(session.identity().as_ref(), Some(&info));
        assert!(dir.join(IDENTITY_FILE).exists());

        let restored = AuthSession::new(&dir);
        restored.restore();
        assert!(restored.is_signed_in());
        assert_eq!(restored.identity().as_ref(), Some(&info));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_out_clears_the_identity() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(GOOD_COOKIE).is_ok());
        session.set_identity(AccountInfo {
            name: Some("Shivam".to_string()),
            ..AccountInfo::default()
        });
        session.sign_out();
        assert!(session.identity().is_none());
        assert!(!dir.join(IDENTITY_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stale_cookie_drops_the_identity() {
        let (session, dir) = temp_session();
        std::fs::write(dir.join(SESSION_FILE), "SAPISID=abc123; other=1").unwrap();
        std::fs::write(
            dir.join(IDENTITY_FILE),
            r#"{"name":"Shivam","email":null,"channelHandle":null,"thumbnailUrl":null}"#,
        )
        .unwrap();
        session.restore();
        assert!(!session.is_signed_in());
        assert!(session.identity().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
