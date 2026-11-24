//! The saved Google accounts: every WebView sign-in joins the list, one
//! stays active, and the rest wait to be switched to — Android's
//! `AccountSessionManager` + `SavedAccount`, in desktop form.
//!
//! Layout under the app-data dir:
//!
//! ```text
//! google-sessions/
//!   active.json                  {"active": "<account id>"}
//!   <account id>/session.txt     the captured Cookie header (0600)
//!   <account id>/account.json    the fetched display identity (0600)
//! ```
//!
//! The account id is an opaque uuid minted at sign-in: stable across the
//! identity backfill (Android's key starts as `cookie:<hash>` and is
//! re-keyed to the handle once the account menu answers, which would mean
//! renaming the directory mid-flight here). The display key Android uses
//! — channel handle, else email, else name — lives inside `account.json`
//! and is what dedupes a fresh login against a stale entry for the same
//! person.
//!
//! A single session stored by an older build (`google-session.txt` +
//! `google-account.json`) migrates in place on first run: it becomes the
//! first saved account and stays active, so the current user is never
//! signed out by the upgrade. A stale legacy cookie is deleted, exactly
//! like the old single-session restore did.
//!
//! The cookie session always wins when both exist (Android
//! `OAuthSessionManager` rule); there is no TV-code OAuth session in this
//! app yet, so the cookie is the only session. The stored value is never
//! logged — not even its length in a debug message.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::identity::AccountInfo;
use super::sapisid::{self, AuthHeaders};

/// Directory holding every saved account, inside the app-data dir.
const SESSIONS_DIR: &str = "google-sessions";

/// File holding one account's captured session cookies.
const SESSION_FILE: &str = "session.txt";

/// File holding one account's fetched display identity.
const IDENTITY_FILE: &str = "account.json";

/// File holding the id of the account in use: `{"active": "<id>"}`.
const ACTIVE_FILE: &str = "active.json";

/// The pre-multi-account single session, for the one-time migration.
const LEGACY_SESSION_FILE: &str = "google-session.txt";
/// Its display identity, for the one-time migration.
const LEGACY_IDENTITY_FILE: &str = "google-account.json";

/// Emitted when the active account changes — a switch, a sign-out that
/// leaves another account active, or a removal — and when the last account
/// goes away and the app is a guest again. Payload is the new active
/// account, or null when signed out. Server surfaces (subscriptions feed,
/// history, Watch Later, home feed) reload on it; local data stays shared.
pub const ACCOUNT_SWITCHED_EVENT: &str = "google-account-switched";

/// One saved account as the frontend lists it. Display fields only — the
/// cookie never leaves the backend.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub channel_handle: Option<String>,
    pub thumbnail_url: Option<String>,
    pub is_active: bool,
}

/// One account on disk: the display identity plus when it was added (the
/// list order — Android keeps insertion order). A bare `AccountInfo` JSON
/// still parses, with `added_at` defaulting to 0.
#[derive(Serialize, Deserialize)]
struct StoredAccount {
    #[serde(flatten)]
    info: AccountInfo,
    #[serde(default)]
    added_at: i64,
}

/// The active-account pointer file.
#[derive(Serialize, Deserialize)]
struct ActivePointer {
    active: Option<String>,
}

/// The saved Google accounts: the active one's raw `Cookie` header kept in
/// memory and persisted per account, the rest on disk waiting to switch to.
pub struct AuthSession {
    dir: PathBuf,
    legacy_file: PathBuf,
    legacy_identity_file: PathBuf,
    active_id: RwLock<Option<String>>,
    cookie: RwLock<Option<String>>,
    identity: RwLock<Option<AccountInfo>>,
}

impl AuthSession {
    #[must_use]
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: app_data_dir.join(SESSIONS_DIR),
            legacy_file: app_data_dir.join(LEGACY_SESSION_FILE),
            legacy_identity_file: app_data_dir.join(LEGACY_IDENTITY_FILE),
            active_id: RwLock::new(None),
            cookie: RwLock::new(None),
            identity: RwLock::new(None),
        }
    }

    /// Restores the saved accounts: the pointer's account when it still
    /// proves a session, else the first surviving one; a legacy single
    /// session migrates in place. A stale cookie is deleted instead of
    /// restoring a session that can never authenticate. The cached identity
    /// is restored alongside, so the top bar shows the account name before
    /// the first live fetch.
    pub fn restore(&self) {
        if let Some(active) = self.read_active_pointer() {
            if self.activate_stored(&active) {
                self.adopt_legacy_if_new();
                return;
            }
        } else if self.migrate_legacy_as_active() {
            return;
        }
        if let Some((id, cookie, identity)) = self.first_valid_account() {
            self.activate(&id, cookie, identity);
        } else {
            self.clear_active();
        }
        self.adopt_legacy_if_new();
    }

    /// Stores a captured cookie header after validation. A sign-in for an
    /// account that is already saved refreshes that entry instead of
    /// duplicating it (Android's onWebLogin matches by cookie); a new
    /// account joins the list and becomes active. The session only flips
    /// once the header is validated *and* persisted, so a failed sign-in
    /// can never leave the app half-logged-in. Returns the account id.
    pub fn sign_in(&self, cookie_header: &str) -> Result<String, String> {
        let header = cookie_header.trim();
        if !Self::is_valid_cookie(header) {
            return Err(
                "No signed-in session in these cookies. Sign in on Google's page first — \
                 the cookies must contain SAPISID plus SID, HSID or LOGIN_INFO \
                 (same rule as the Android app)."
                    .to_string(),
            );
        }
        if let Some(id) = self.account_id_with_cookie(header) {
            if let Some(cookie) = self.read_account_cookie(&id) {
                let identity = self.read_identity(&id);
                self.activate(&id, cookie, identity);
                return Ok(id);
            }
        }
        let id = new_account_id();
        self.write_session_file(&id, header)
            .map_err(|error| error.to_string())?;
        // The empty identity file is the ordering record (`added_at` lives
        // in it): without it, two never-identified accounts would both
        // sort as 0 and the list order would depend on directory order.
        // The in-memory identity still stays `None` until the account menu
        // answers — `read_identity` below drops an identity with no
        // displayable fields — so the frontend refetches the name instead
        // of reading an empty identity as "already known".
        let _ = self.write_identity_file(&id, &AccountInfo::default(), self.next_added_at());
        self.activate(&id, header.to_string(), None);
        Ok(id)
    }

    /// Makes the saved account with `id` the active one: its session
    /// applies to every InnerTube call from here on. Errors when the
    /// account is unknown, or when its cookie went stale (that entry is
    /// deleted — signing in again is the only way back).
    pub fn switch_account(&self, id: &str) -> Result<AccountSummary, String> {
        let Some(cookie) = self.read_account_cookie(id) else {
            return Err("Unknown account.".to_string());
        };
        if !Self::is_valid_cookie(&cookie) {
            let _ = std::fs::remove_dir_all(self.account_dir(id));
            return Err("That account's session has expired. Sign in again to use it.".to_string());
        }
        let identity = self.read_identity(id);
        self.activate(id, cookie, identity);
        self.summary(id)
            .ok_or_else(|| "Unknown account.".to_string())
    }

    /// Removes one saved account. Removing the active one activates the
    /// next saved account (oldest first); with none left the app is a
    /// guest again. Returns the account that is active afterwards, if any.
    pub fn remove_account(&self, id: &str) -> Result<Option<AccountSummary>, String> {
        if !self.account_dir(id).is_dir() {
            return Err("Unknown account.".to_string());
        }
        let was_active = self.active_account_id().as_deref() == Some(id);
        let _ = std::fs::remove_dir_all(self.account_dir(id));
        if !was_active {
            return Ok(self
                .active_account_id()
                .and_then(|active| self.summary(&active)));
        }
        match self.first_valid_account() {
            Some((next, cookie, identity)) => {
                self.activate(&next, cookie, identity);
                Ok(self.summary(&next))
            }
            None => {
                self.clear_active();
                Ok(None)
            }
        }
    }

    /// Signs out of the ACTIVE account: its entry is removed, the next
    /// saved account (if any) becomes active, and with none left the app
    /// is a guest again (Android `signOutActive`). Returns the account
    /// that became active, if any. The caller also clears the webview's
    /// browsing data, so no copy of the session survives anywhere.
    pub fn sign_out(&self) -> Option<AccountSummary> {
        let active = self.active_account_id()?;
        self.remove_account(&active).ok().flatten()
    }

    /// Every saved account, oldest first, with the active one flagged.
    /// Accounts whose identity was never fetched list with empty display
    /// fields until the account menu answers.
    #[must_use]
    pub fn list_accounts(&self) -> Vec<AccountSummary> {
        self.list_account_dirs()
            .into_iter()
            .filter_map(|id| self.summary(&id))
            .collect()
    }

    /// The id of the account in use, if signed in.
    #[must_use]
    pub fn active_account_id(&self) -> Option<String> {
        self.active_id
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Stores a freshly fetched account identity (from
    /// `account/account_menu`) next to the active account's session, so
    /// the top bar and the Account settings tab show it without a network
    /// round trip. A failed write keeps the previous identity rather than
    /// dropping it.
    ///
    /// A fresh login supersedes the stale entry for the same person: any
    /// other saved account with the same channel handle (or, when neither
    /// has a handle, the same email) is dropped — its cookie is older than
    /// the one just captured. Different brand channels of one Google
    /// account keep their own entries: same email, different handles.
    pub fn set_identity(&self, info: AccountInfo) {
        let Some(active) = self.active_account_id() else {
            return;
        };
        let added_at = self
            .read_stored(&active)
            .map(|stored| stored.added_at)
            .unwrap_or_else(now_ms);
        let _ = self.write_identity_file(&active, &info, added_at);
        for other in self.list_account_dirs() {
            if other == active {
                continue;
            }
            let Some(stored) = self.read_stored(&other) else {
                continue;
            };
            let same_person = match (&info.channel_handle, &stored.info.channel_handle) {
                (Some(mine), Some(theirs)) => mine == theirs,
                (None, None) => info.email.is_some() && info.email == stored.info.email,
                _ => false,
            };
            if same_person {
                let _ = std::fs::remove_dir_all(self.account_dir(&other));
            }
        }
        *self
            .identity
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(info);
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

    /// The stored `Cookie` header of the active account, if signed in.
    /// Callers must treat it as a secret: send it, never log it.
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

    fn account_dir(&self, id: &str) -> PathBuf {
        self.dir.join(id)
    }

    fn session_path(&self, id: &str) -> PathBuf {
        self.account_dir(id).join(SESSION_FILE)
    }

    fn identity_path(&self, id: &str) -> PathBuf {
        self.account_dir(id).join(IDENTITY_FILE)
    }

    fn active_path(&self) -> PathBuf {
        self.dir.join(ACTIVE_FILE)
    }

    /// Saved account ids, oldest first (Android keeps insertion order).
    fn list_account_dirs(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut accounts: Vec<(String, i64)> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .map(|entry| {
                let id = entry.file_name().to_string_lossy().into_owned();
                let added_at = self
                    .read_stored(&id)
                    .map(|stored| stored.added_at)
                    .unwrap_or(0);
                (id, added_at)
            })
            .collect();
        // Accounts without a recorded time sort last, in directory order.
        accounts.sort_by_key(|(_, added_at)| (*added_at == 0, *added_at));
        accounts.into_iter().map(|(id, _)| id).collect()
    }

    fn summary(&self, id: &str) -> Option<AccountSummary> {
        if !self.session_path(id).is_file() {
            return None;
        }
        let info = self
            .read_stored(id)
            .map(|stored| stored.info)
            .unwrap_or_default();
        Some(AccountSummary {
            id: id.to_string(),
            name: info.name,
            email: info.email,
            channel_handle: info.channel_handle,
            thumbnail_url: info.thumbnail_url,
            is_active: self.active_account_id().as_deref() == Some(id),
        })
    }

    fn read_account_cookie(&self, id: &str) -> Option<String> {
        std::fs::read_to_string(self.session_path(id))
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
    }

    fn read_stored(&self, id: &str) -> Option<StoredAccount> {
        let text = std::fs::read_to_string(self.identity_path(id)).ok()?;
        serde_json::from_str::<StoredAccount>(&text).ok()
    }

    /// The stored display identity, if it actually identifies the
    /// account. A file with no name, handle or email (written by the
    /// sign-in before the first menu fetch, or by an older build) reads
    /// as "not fetched yet", so the frontend refetches the name instead
    /// of showing a generic label forever. The file itself stays: it is
    /// the ordering record (`added_at`).
    fn read_identity(&self, id: &str) -> Option<AccountInfo> {
        self.read_stored(id)
            .map(|stored| stored.info)
            .filter(|info| info.display_name().is_some())
    }

    fn account_id_with_cookie(&self, cookie: &str) -> Option<String> {
        self.list_account_dirs()
            .into_iter()
            .find(|id| self.read_account_cookie(id).as_deref() == Some(cookie))
    }

    fn read_active_pointer(&self) -> Option<String> {
        let text = std::fs::read_to_string(self.active_path()).ok()?;
        serde_json::from_str::<ActivePointer>(&text)
            .ok()
            .and_then(|pointer| pointer.active)
            .filter(|id| !id.is_empty())
    }

    fn write_active_pointer(&self, id: Option<&str>) {
        if let Err(error) = std::fs::create_dir_all(&self.dir) {
            tracing::warn!(%error, "could not create the sessions dir for the active pointer");
            return;
        }
        restrict_dir_permissions(&self.dir);
        let pointer = ActivePointer {
            active: id.map(ToOwned::to_owned),
        };
        if let Ok(json) = serde_json::to_string(&pointer) {
            let _ = std::fs::write(self.active_path(), json);
        }
    }

    fn write_session_file(&self, id: &str, cookie: &str) -> io::Result<()> {
        let dir = self.account_dir(id);
        std::fs::create_dir_all(&dir)?;
        restrict_dir_permissions(&dir);
        std::fs::write(self.session_path(id), cookie)?;
        restrict_permissions(&self.session_path(id));
        Ok(())
    }

    fn write_identity_file(&self, id: &str, info: &AccountInfo, added_at: i64) -> io::Result<()> {
        let dir = self.account_dir(id);
        std::fs::create_dir_all(&dir)?;
        restrict_dir_permissions(&dir);
        let stored = StoredAccount {
            info: info.clone(),
            added_at,
        };
        let json = serde_json::to_string(&stored).map_err(io::Error::other)?;
        std::fs::write(self.identity_path(id), json)?;
        restrict_permissions(&self.identity_path(id));
        Ok(())
    }

    /// Applies one account's session in memory and on disk (the pointer).
    fn activate(&self, id: &str, cookie: String, identity: Option<AccountInfo>) {
        self.write_active_pointer(Some(id));
        *self
            .active_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(id.to_string());
        *self
            .cookie
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cookie);
        *self
            .identity
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = identity;
    }

    fn clear_active(&self) {
        self.write_active_pointer(None);
        *self
            .active_id
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .cookie
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .identity
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    /// Loads the stored account when its cookie still proves a session;
    /// a stale entry is deleted.
    fn activate_stored(&self, id: &str) -> bool {
        match self.read_account_cookie(id) {
            Some(cookie) if Self::is_valid_cookie(&cookie) => {
                let identity = self.read_identity(id);
                self.activate(id, cookie, identity);
                true
            }
            Some(_) => {
                let _ = std::fs::remove_dir_all(self.account_dir(id));
                false
            }
            None => false,
        }
    }

    /// The first saved account whose cookie still proves a session, oldest
    /// first; stale entries are deleted as they are found.
    fn first_valid_account(&self) -> Option<(String, String, Option<AccountInfo>)> {
        for id in self.list_account_dirs() {
            match self.read_account_cookie(&id) {
                Some(cookie) if Self::is_valid_cookie(&cookie) => {
                    let identity = self.read_identity(&id);
                    return Some((id, cookie, identity));
                }
                Some(_) => {
                    let _ = std::fs::remove_dir_all(self.account_dir(&id));
                }
                None => {}
            }
        }
        None
    }

    /// The pre-multi-account single session becomes the first saved account
    /// and stays active. A stale legacy cookie is deleted, like the old
    /// single-session restore did.
    fn migrate_legacy_as_active(&self) -> bool {
        let Some(header) = self.read_legacy_cookie() else {
            return false;
        };
        if !Self::is_valid_cookie(&header) {
            let _ = std::fs::remove_file(&self.legacy_file);
            let _ = std::fs::remove_file(&self.legacy_identity_file);
            return false;
        }
        let id = new_account_id();
        let identity = self.read_legacy_identity();
        if self.write_session_file(&id, &header).is_err() {
            return false;
        }
        let _ = self.write_identity_file(
            &id,
            identity.as_ref().unwrap_or(&AccountInfo::default()),
            self.next_added_at(),
        );
        self.activate(&id, header, identity);
        let _ = std::fs::remove_file(&self.legacy_file);
        let _ = std::fs::remove_file(&self.legacy_identity_file);
        true
    }

    /// A legacy single-session file left behind after migrating (the user
    /// ran an older build in between): keep it as an extra saved account
    /// instead of dropping a session they may still use.
    fn adopt_legacy_if_new(&self) {
        let Some(header) = self.read_legacy_cookie() else {
            return;
        };
        if !Self::is_valid_cookie(&header) {
            let _ = std::fs::remove_file(&self.legacy_file);
            let _ = std::fs::remove_file(&self.legacy_identity_file);
            return;
        }
        if self.account_id_with_cookie(&header).is_none() {
            let id = new_account_id();
            let identity = self.read_legacy_identity();
            if self.write_session_file(&id, &header).is_ok() {
                let _ = self.write_identity_file(
                    &id,
                    identity.as_ref().unwrap_or(&AccountInfo::default()),
                    self.next_added_at(),
                );
            }
        }
        let _ = std::fs::remove_file(&self.legacy_file);
        let _ = std::fs::remove_file(&self.legacy_identity_file);
    }

    /// The `added_at` for a new account: strictly after every existing one,
    /// so the list order is the insertion order even when two accounts are
    /// added within the same millisecond.
    fn next_added_at(&self) -> i64 {
        let latest = self
            .list_account_dirs()
            .into_iter()
            .filter_map(|id| self.read_stored(&id).map(|stored| stored.added_at))
            .max()
            .unwrap_or(0);
        now_ms().max(latest + 1)
    }

    fn read_legacy_cookie(&self) -> Option<String> {
        std::fs::read_to_string(&self.legacy_file)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
    }

    fn read_legacy_identity(&self) -> Option<AccountInfo> {
        std::fs::read_to_string(&self.legacy_identity_file)
            .ok()
            .and_then(|text| serde_json::from_str::<AccountInfo>(&text).ok())
            .filter(|info| info.display_name().is_some())
    }
}

fn new_account_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Owner-only read/write on the session and identity files, so other local
/// users cannot steal the session. Unix only; on Windows the app-data dir
/// is already per-user.
#[cfg(unix)]
fn restrict_permissions(file: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_file: &Path) {}

/// Owner-only on the sessions dir itself, so other local users cannot even
/// list the saved accounts. Unix only.
#[cfg(unix)]
fn restrict_dir_permissions(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn restrict_dir_permissions(_dir: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_session() -> (AuthSession, PathBuf) {
        // Unique per test: the tests run in parallel in one process, so a
        // timestamp alone can collide and one test would delete another's
        // directory mid-run.
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("youglide-auth-test-{}-{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        (AuthSession::new(&dir), dir)
    }

    const COOKIE_A: &str = "SAPISID=abc123; SID=def456; other=1";
    const COOKIE_B: &str = "SAPISID=xyz789; SID=uvw012; other=1";

    fn info(name: &str, handle: &str, email: &str) -> AccountInfo {
        AccountInfo {
            name: Some(name.to_string()),
            email: Some(email.to_string()),
            channel_handle: Some(handle.to_string()),
            thumbnail_url: None,
        }
    }

    #[test]
    fn sign_in_persists_and_restores() {
        let (session, dir) = temp_session();
        let id = session.sign_in(COOKIE_A).unwrap();
        assert!(session.is_signed_in());
        assert_eq!(session.active_account_id().as_deref(), Some(id.as_str()));
        assert!(dir.join(SESSIONS_DIR).join(&id).join(SESSION_FILE).exists());

        let restored = AuthSession::new(&dir);
        restored.restore();
        assert!(restored.is_signed_in());
        assert_eq!(restored.cookie_header().as_deref(), Some(COOKIE_A));
        assert_eq!(restored.active_account_id().as_deref(), Some(id.as_str()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_in_has_no_identity_until_fetched() {
        // A fresh sign-in has no display identity until the account menu
        // answers: an identity with no name, handle or email reads as
        // "not fetched yet", so the frontend refetches it instead of
        // showing a generic label forever (the 1.0.0 bug on the user's
        // machine, where one failed fetch hid the real name for good).
        let (session, dir) = temp_session();
        let id = session.sign_in(COOKIE_A).unwrap();
        assert!(session.is_signed_in());
        assert_eq!(session.identity(), None);
        let accounts = session.list_accounts();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, id);
        assert_eq!(accounts[0].name, None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_in_rejects_an_anonymous_cookie() {
        let (session, dir) = temp_session();
        assert!(session.sign_in("SAPISID=abc123; other=1").is_err());
        assert!(!session.is_signed_in());
        assert!(session.list_accounts().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn restore_drops_a_stale_legacy_cookie() {
        let (session, dir) = temp_session();
        std::fs::write(dir.join(LEGACY_SESSION_FILE), "SAPISID=abc123; other=1").unwrap();
        session.restore();
        assert!(!session.is_signed_in());
        assert!(!dir.join(LEGACY_SESSION_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_out_deletes_the_active_account() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(COOKIE_A).is_ok());
        assert!(session.sign_out().is_none());
        assert!(!session.is_signed_in());
        assert!(session.list_accounts().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auth_headers_are_fresh_per_call() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(COOKIE_A).is_ok());
        let first = session.auth_headers().unwrap();
        assert!(first.authorization.starts_with("SAPISIDHASH "));
        assert_eq!(first.cookie, COOKIE_A);
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
        assert!(session.sign_in(COOKIE_A).is_ok());
        let expected = info("Shivam", "@shivyt", "shivam@example.com");
        session.set_identity(expected.clone());
        assert_eq!(session.identity().as_ref(), Some(&expected));

        let restored = AuthSession::new(&dir);
        restored.restore();
        assert!(restored.is_signed_in());
        assert_eq!(restored.identity().as_ref(), Some(&expected));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sign_out_clears_the_identity() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(COOKIE_A).is_ok());
        session.set_identity(info("Shivam", "@shivyt", "shivam@example.com"));
        session.sign_out();
        assert!(session.identity().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stale_legacy_cookie_drops_the_identity() {
        let (session, dir) = temp_session();
        std::fs::write(dir.join(LEGACY_SESSION_FILE), "SAPISID=abc123; other=1").unwrap();
        std::fs::write(
            dir.join(LEGACY_IDENTITY_FILE),
            r#"{"name":"Shivam","email":null,"channelHandle":null,"thumbnailUrl":null}"#,
        )
        .unwrap();
        session.restore();
        assert!(!session.is_signed_in());
        assert!(session.identity().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn restore_migrates_the_legacy_single_session() {
        let (session, dir) = temp_session();
        std::fs::write(dir.join(LEGACY_SESSION_FILE), COOKIE_A).unwrap();
        let expected = info("Shivam", "@shivyt", "shivam@example.com");
        std::fs::write(
            dir.join(LEGACY_IDENTITY_FILE),
            serde_json::to_string(&expected).unwrap(),
        )
        .unwrap();

        session.restore();
        assert!(session.is_signed_in());
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_A));
        assert_eq!(session.identity().as_ref(), Some(&expected));
        // The legacy files are gone; the session lives in the new layout.
        assert!(!dir.join(LEGACY_SESSION_FILE).exists());
        assert!(!dir.join(LEGACY_IDENTITY_FILE).exists());
        assert_eq!(session.list_accounts().len(), 1);
        assert!(session.list_accounts()[0].is_active);

        // A second restore keeps the migrated account (no re-migration).
        let again = AuthSession::new(&dir);
        again.restore();
        assert!(again.is_signed_in());
        assert_eq!(again.cookie_header().as_deref(), Some(COOKIE_A));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn second_sign_in_adds_an_account_and_keeps_the_first() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        let second = session.sign_in(COOKIE_B).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            session.active_account_id().as_deref(),
            Some(second.as_str())
        );
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_B));

        let accounts = session.list_accounts();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].id, first);
        assert!(!accounts[0].is_active);
        assert_eq!(accounts[1].id, second);
        assert!(accounts[1].is_active);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn same_cookie_signs_in_once() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        let second = session.sign_in(COOKIE_A).unwrap();
        assert_eq!(first, second);
        assert_eq!(session.list_accounts().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switch_account_flips_the_active_session() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        session.set_identity(info("A", "@a", "a@example.com"));
        let second = session.sign_in(COOKIE_B).unwrap();
        session.set_identity(info("B", "@b", "b@example.com"));

        let switched = session.switch_account(&first).unwrap();
        assert_eq!(switched.id, first);
        assert!(switched.is_active);
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_A));
        assert_eq!(
            session
                .identity()
                .as_ref()
                .unwrap()
                .channel_handle
                .as_deref(),
            Some("@a")
        );

        let accounts = session.list_accounts();
        assert!(accounts.iter().find(|a| a.id == first).unwrap().is_active);
        assert!(!accounts.iter().find(|a| a.id == second).unwrap().is_active);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn switch_to_unknown_or_stale_account_errors() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        assert!(session.switch_account("no-such-id").is_err());
        assert_eq!(session.active_account_id().as_deref(), Some(first.as_str()));

        // A stale cookie is deleted on switch and the account stays active.
        std::fs::write(
            dir.join(SESSIONS_DIR).join(&first).join(SESSION_FILE),
            "SAPISID=abc123; other=1",
        )
        .unwrap();
        assert!(session.switch_account(&first).is_err());
        assert!(!dir.join(SESSIONS_DIR).join(&first).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_active_account_activates_the_next_one() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        let second = session.sign_in(COOKIE_B).unwrap();

        let next = session.remove_account(&second).unwrap().unwrap();
        assert_eq!(next.id, first);
        assert!(session.is_signed_in());
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_A));
        assert_eq!(session.list_accounts().len(), 1);

        let none = session.remove_account(&first).unwrap();
        assert!(none.is_none());
        assert!(!session.is_signed_in());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_inactive_account_keeps_the_active_one() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        let second = session.sign_in(COOKIE_B).unwrap();

        let still_active = session.remove_account(&first).unwrap().unwrap();
        assert_eq!(still_active.id, second);
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_B));
        assert_eq!(session.list_accounts().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_unknown_account_errors() {
        let (session, dir) = temp_session();
        assert!(session.sign_in(COOKIE_A).is_ok());
        assert!(session.remove_account("no-such-id").is_err());
        assert!(session.is_signed_in());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn identity_merge_drops_the_stale_duplicate_for_the_same_person() {
        let (session, dir) = temp_session();
        session.sign_in(COOKIE_A).unwrap();
        session.set_identity(info("A", "@a", "a@example.com"));
        // The same person signs in again with a fresh cookie.
        session.sign_in(COOKIE_B).unwrap();
        session.set_identity(info("A", "@a", "a@example.com"));

        let accounts = session.list_accounts();
        assert_eq!(accounts.len(), 1);
        assert_eq!(session.cookie_header().as_deref(), Some(COOKIE_B));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn brand_channels_keep_separate_entries() {
        let (session, dir) = temp_session();
        session.sign_in(COOKIE_A).unwrap();
        session.set_identity(info("Brand One", "@brand-one", "same@example.com"));
        session.sign_in(COOKIE_B).unwrap();
        session.set_identity(info("Brand Two", "@brand-two", "same@example.com"));

        assert_eq!(session.list_accounts().len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn restore_falls_back_when_the_active_cookie_goes_stale() {
        let (session, dir) = temp_session();
        let first = session.sign_in(COOKIE_A).unwrap();
        let second = session.sign_in(COOKIE_B).unwrap();
        assert_eq!(
            session.active_account_id().as_deref(),
            Some(second.as_str())
        );

        std::fs::write(
            dir.join(SESSIONS_DIR).join(&second).join(SESSION_FILE),
            "SAPISID=xyz789; other=1",
        )
        .unwrap();

        let restored = AuthSession::new(&dir);
        restored.restore();
        assert!(restored.is_signed_in());
        assert_eq!(
            restored.active_account_id().as_deref(),
            Some(first.as_str())
        );
        assert_eq!(restored.cookie_header().as_deref(), Some(COOKIE_A));
        assert!(!dir.join(SESSIONS_DIR).join(&second).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
