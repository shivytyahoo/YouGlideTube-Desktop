//! SAPISIDHASH auth, ported from the Compose Multiplatform app's
//! `SapisidAuth.kt` (which itself ports YouGlideTube Android's
//! `innertube/InnerTube.kt`).
//!
//! The client reads SAPISID (falling back to `__Secure-3PSAPISID`, then
//! `__Secure-1PSAPISID`) from the signed-in session's cookies and sends
//! `Authorization: SAPISIDHASH <unix-seconds>_<sha1("<unix-seconds>
//! <sapisid> https://www.youtube.com")>` on WEB-client calls.
//!
//! Pure functions only — no browser, no I/O — so the rule is unit-tested
//! here and the login window only feeds it cookie pairs. No cookie or
//! token value is ever logged.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Google sign-in for YouTube, continuing to youtube.com — the same URL the
/// YouGlideTube Android app's `GoogleLoginActivity` opens.
pub const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/";

/// The origin SAPISIDHASH is computed against (Android `YOUTUBE_URL`).
pub const YOUTUBE_ORIGIN: &str = "https://www.youtube.com";

/// SAPISID cookie names, in the priority `SapisidAuth` reads them.
pub const SAPISID_NAMES: [&str; 3] = ["SAPISID", "__Secure-3PSAPISID", "__Secure-1PSAPISID"];

/// Second-factor cookie names: any one of these plus a SAPISID proves the
/// session (Android's exact rule).
pub const SESSION_PROOF_NAMES: [&str; 3] = ["SID", "HSID", "LOGIN_INFO"];

/// The two headers a signed-in InnerTube call carries, computed fresh per
/// call so the timestamp is never stale.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthHeaders {
    pub authorization: String,
    pub cookie: String,
}

/// Parses a raw `Cookie` header (`"A=1; B=2"`) into name → value. Values may
/// contain `=` (split on the first one); blank parts are skipped.
///
/// Duplicate names collapse, last wins — a header mixing two origins can
/// authenticate with the wrong SAPISID (Google sets SAPISID on both
/// google.com and youtube.com with different values). Capture must stay
/// scoped to youtube.com (see `login_window`); never build a header from
/// the whole cookie store.
#[must_use]
pub fn parse_cookie_header(cookie_header: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for part in cookie_header.split(';') {
        let Some(eq) = part.find('=') else {
            continue;
        };
        let name = part[..eq].trim();
        if name.is_empty() {
            continue;
        }
        out.insert(name.to_string(), part[eq + 1..].trim().to_string());
    }
    out
}

/// Builds a `Cookie` header from name → value pairs (`"A=1; B=2"`).
#[must_use]
pub fn build_cookie_header(cookies: &[(String, String)]) -> String {
    cookies
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Builds a `Cookie` header from the webview's cookies (name=value pairs).
/// Only the name and value travel — flags such as HttpOnly, Secure or
/// SameSite are transport metadata, not header content.
#[must_use]
pub fn cookies_to_header(cookies: &[tauri::webview::Cookie<'_>]) -> String {
    cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ")
}

/// The SAPISID value, in Android's priority order. A map lookup, not
/// first-in-header-order: a header listing `__Secure-1PSAPISID` before
/// `SAPISID` still authenticates with `SAPISID`.
#[must_use]
pub fn sapisid_value(cookies: &HashMap<String, String>) -> Option<&str> {
    SAPISID_NAMES
        .iter()
        .find_map(|name| cookies.get(*name).map(String::as_str))
}

/// Android's session proof: a SAPISID-family cookie AND any of
/// SID / HSID / LOGIN_INFO. A SAPISID on its own is not enough (the browser
/// sets one for anonymous visitors too), and LOGIN_INFO on its own is not
/// enough either. LOGIN_INFO must NOT be required on its own: it is
/// short-lived and is often already gone by the time youtube.com finishes
/// loading, which used to leave the Android screen stuck after a successful
/// sign-in.
#[must_use]
pub fn is_signed_in(cookies: &HashMap<String, String>) -> bool {
    let has_sapisid = SAPISID_NAMES.iter().any(|name| cookies.contains_key(*name));
    let has_second_factor = SESSION_PROOF_NAMES
        .iter()
        .any(|name| cookies.contains_key(*name));
    has_sapisid && has_second_factor
}

/// [`is_signed_in`] over a raw `Cookie` header.
#[must_use]
pub fn is_signed_in_header(cookie_header: &str) -> bool {
    is_signed_in(&parse_cookie_header(cookie_header))
}

/// SHA-1 hex digest of the UTF-8 bytes of `input`.
#[must_use]
pub fn sha1_hex(input: &str) -> String {
    use sha1::Digest;
    let digest = sha1::Sha1::digest(input.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Current Unix time in seconds.
#[must_use]
pub fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Builds the SAPISIDHASH `Authorization` header from a raw `Cookie` header,
/// or `None` when no SAPISID cookie is present. `now_epoch_seconds` is a
/// parameter so the header is unit-testable with a fixed timestamp.
#[must_use]
pub fn authorization_header(
    cookie_header: &str,
    origin: &str,
    now_epoch_seconds: u64,
) -> Option<String> {
    let cookies = parse_cookie_header(cookie_header);
    let sapisid = sapisid_value(&cookies)?;
    let hash = sha1_hex(&format!("{now_epoch_seconds} {sapisid} {origin}"));
    Some(format!("SAPISIDHASH {now_epoch_seconds}_{hash}"))
}

/// Both signed-in headers for one InnerTube call, computed fresh so the
/// timestamp is never stale. `None` when the cookie header carries no
/// usable SAPISID.
#[must_use]
pub fn auth_headers(cookie_header: &str) -> Option<AuthHeaders> {
    let authorization =
        authorization_header(cookie_header, YOUTUBE_ORIGIN, now_epoch_seconds())?;
    Some(AuthHeaders {
        authorization,
        cookie: cookie_header.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookies(header: &str) -> HashMap<String, String> {
        parse_cookie_header(header)
    }

    #[test]
    fn sha1_known_vector() {
        // FIPS 180-1 test vector (ported from the CMP SapisidAuthTest).
        assert_eq!(
            sha1_hex("abc"),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
    }

    #[test]
    fn header_uses_sapisid_cookie() {
        let header = authorization_header(
            "LOGIN_INFO=xyz; SAPISID=abc123; other=1",
            YOUTUBE_ORIGIN,
            1000,
        )
        .unwrap();
        let expected_hash = sha1_hex("1000 abc123 https://www.youtube.com");
        assert_eq!(header, format!("SAPISIDHASH 1000_{expected_hash}"));
    }

    #[test]
    fn header_prefers_secure_3p_sapisid() {
        let header = authorization_header(
            "__Secure-3PSAPISID=secure1",
            YOUTUBE_ORIGIN,
            2000,
        )
        .unwrap();
        let expected_hash = sha1_hex("2000 secure1 https://www.youtube.com");
        assert_eq!(header, format!("SAPISIDHASH 2000_{expected_hash}"));
    }

    #[test]
    fn header_priority_is_sapisid_then_3p_then_1p() {
        // SAPISID wins over both __Secure- variants.
        let with_all = authorization_header(
            "__Secure-1PSAPISID=one; __Secure-3PSAPISID=three; SAPISID=plain",
            YOUTUBE_ORIGIN,
            3000,
        )
        .unwrap();
        assert_eq!(
            with_all,
            format!(
                "SAPISIDHASH 3000_{}",
                sha1_hex("3000 plain https://www.youtube.com")
            )
        );
        // __Secure-3PSAPISID wins over __Secure-1PSAPISID.
        let with_secure = authorization_header(
            "__Secure-1PSAPISID=one; __Secure-3PSAPISID=three",
            YOUTUBE_ORIGIN,
            3000,
        )
        .unwrap();
        assert_eq!(
            with_secure,
            format!(
                "SAPISIDHASH 3000_{}",
                sha1_hex("3000 three https://www.youtube.com")
            )
        );
    }

    #[test]
    fn header_is_none_without_sapisid() {
        assert!(
            authorization_header("LOGIN_INFO=xyz; other=1", YOUTUBE_ORIGIN, 1000).is_none()
        );
    }

    #[test]
    fn parse_skips_blanks_and_keeps_equals_in_values() {
        let parsed = cookies("A=1; ; B=x=y; C=");
        assert_eq!(parsed.get("A").map(String::as_str), Some("1"));
        assert_eq!(parsed.get("B").map(String::as_str), Some("x=y"));
        assert_eq!(parsed.get("C").map(String::as_str), Some(""));
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn session_proof_needs_sapisid_and_a_second_factor() {
        assert!(is_signed_in(&cookies("SAPISID=a; SID=b")));
        assert!(is_signed_in(&cookies("SAPISID=a; HSID=b")));
        assert!(is_signed_in(&cookies("SAPISID=a; LOGIN_INFO=b")));
        assert!(is_signed_in(&cookies("__Secure-3PSAPISID=a; SID=b")));
        // SAPISID alone is not enough (anonymous visitors get one too).
        assert!(!is_signed_in(&cookies("SAPISID=a")));
        // A second factor alone is not enough either.
        assert!(!is_signed_in(&cookies("SID=b; LOGIN_INFO=c")));
        assert!(!is_signed_in(&cookies("")));
    }

    #[test]
    fn merged_multi_domain_header_authenticates_with_the_wrong_sapisid() {
        // Regression: the sign-in poll used to capture every domain's
        // cookies, so a google.com SAPISID listed after the youtube.com one
        // overwrote it in this map (last wins) and SAPISIDHASH was computed
        // from the wrong value — the app showed "Signed in" while every
        // signed-in call answered as anonymous. Capture must stay scoped to
        // youtube.com (see login_window); this test pins the collapse so
        // the reason stays visible.
        let header = "SAPISID=youtube-value; SID=x; SAPISID=google-value";
        assert_eq!(sapisid_value(&cookies(header)), Some("google-value"));
        let auth = authorization_header(header, YOUTUBE_ORIGIN, 1000).unwrap();
        assert_eq!(
            auth,
            format!(
                "SAPISIDHASH 1000_{}",
                sha1_hex("1000 google-value https://www.youtube.com")
            )
        );
    }

    #[test]
    fn cookie_header_round_trips() {
        let pairs = vec![
            ("SAPISID".to_string(), "abc".to_string()),
            ("SID".to_string(), "def".to_string()),
        ];
        let header = build_cookie_header(&pairs);
        assert_eq!(header, "SAPISID=abc; SID=def");
        assert_eq!(parse_cookie_header(&header).get("SAPISID").unwrap(), "abc");
    }
}
