//! The BotGuard challenge YouTube's WEB/MWEB sessions actually accept.
//!
//! Port of the Android app's `PoTokenWebView4` + `HomepageChallenge.kt` +
//! `JavaScriptUtil.kt` (`parseDescrambledChallengeData`, `parseLooseJSON`).
//!
//! The desktop used to mint its web poTokens from the legacy WAA `Create`
//! challenge (`jnn-pa.googleapis.com ... /Waa/Create` with no page, no `ytcfg`
//! and no `EVENT_ID`). Android's Report 51 measured that YouTube now refuses
//! tokens minted from it for WEB/MWEB sessions (HTTP 403 TOKEN_REJECTED): the
//! token is accepted at load time and refused once enforcement kicks in —
//! exactly the user's SABR death ~4s into playback. The working challenge
//! comes from the youtube.com homepage itself: the first `ytcfg.set({...})`
//! (which carries the `EVENT_ID` BotGuard reads from `yt.config_`) and the
//! `window.ytAtN({...}).R` challenge from that same page, with the BotGuard
//! interpreter downloaded from the challenge's `interpreterUrl`.
//!
//! Fallback chain mirrors Android: homepage → legacy WAA `Create` (kept in
//! the mint page; a legacy token beats no token at all). The `/att/get`
//! middle step is skipped — it carries no page either, so its tokens are
//! rejected the same way for WEB/MWEB sessions.

use std::time::Duration;

use serde_json::Value;
use tracing::{debug, warn};

/// The homepage challenge, ready for the mint page: the Android-shaped
/// challenge-data JSON (interpreter JS included) plus the page's `ytcfg`.
#[derive(Debug, Clone)]
pub struct HomepageChallengeData {
    /// `{"interpreterJavascript": {...}, "interpreterHash": ..., "program": ...,
    /// "globalName": ..., "clientExperimentsStateBlob": ...}` — the exact
    /// object Android's `runBotGuard` consumes.
    pub challenge_json: String,
    /// The page's first `ytcfg.set({...})` object as JSON text, or `None`
    /// when the page had none (the challenge is still used; BotGuard just
    /// sees no `EVENT_ID`).
    pub ytcfg: Option<String>,
}

/// What the HTML half of the homepage fetch found. Pure, so it is unit-tested
/// without a network — mirrors Android's `extractHomepageChallenge`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedChallenge {
    /// `window.ytAtN({...}).R` as JSON text holding `bgChallenge`; `None`
    /// when unusable, see `failure`.
    pub raw_challenge: Option<String>,
    /// The page's first `ytcfg.set({...})` object as JSON text.
    pub ytcfg: Option<String>,
    /// Whether `ytcfg` carries a non-empty `EVENT_ID`.
    pub has_event_id: bool,
    /// `html5_generate_content_po_token` in the page: "y", "n", or "?".
    pub content_flag: String,
    /// Why `raw_challenge` is `None` (`no-atn`, `atn-parse`,
    /// `no-bgchallenge`); `None` when usable.
    pub failure: Option<&'static str>,
}

const HOMEPAGE_URL: &str = "https://www.youtube.com";
/// Android's V4 user agent for the homepage fetch (PoTokenWebView4).
const HOMEPAGE_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36(KHTML, like Gecko)";
/// The consent cookie: without it the homepage can answer a consent
/// interstitial, which carries no `ytAtN` challenge.
const HOMEPAGE_COOKIE: &str = "SOCS=CAI";
/// Bound on the whole homepage + interpreter fetch; the mint page's own
/// WebView timeout bounds the rest.
const FETCH_TIMEOUT: Duration = Duration::from_secs(12);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Fetch the homepage challenge: GET the homepage, extract `(ytcfg, ytAtN)`,
/// download the BotGuard interpreter, build the challenge-data JSON.
/// `None` on any failure — the caller falls back to the legacy WAA `Create`
/// challenge. Only the failure kind is logged, never page content.
pub async fn fetch_homepage_challenge() -> Option<HomepageChallengeData> {
    tokio::time::timeout(FETCH_TIMEOUT, fetch_homepage_challenge_inner())
        .await
        .ok()
        .flatten()
}

async fn fetch_homepage_challenge_inner() -> Option<HomepageChallengeData> {
    // The shared client (never a new client per request — see api/http.rs);
    // per-request headers override its default UA below.
    let client = crate::api::http::shared_client();
    let started = std::time::Instant::now();
    let response = client
        .get(HOMEPAGE_URL)
        .header("User-Agent", HOMEPAGE_USER_AGENT)
        .header("Accept", "*/*")
        .header("Accept-Language", "en-US,en;q=0.7")
        .header("Cookie", HOMEPAGE_COOKIE)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        warn!(
            status = response.status().as_u16(),
            "Homepage challenge fetch failed"
        );
        return None;
    }
    let html = response.text().await.ok()?;
    let page_ms = started.elapsed().as_millis();
    let extracted = extract_homepage_challenge(&html);
    let Some(raw_challenge) = extracted.raw_challenge.as_deref() else {
        warn!(
            failure = extracted.failure.unwrap_or("no-challenge"),
            page_ms, "Homepage has no usable ytAtN challenge"
        );
        return None;
    };
    let interpreter_url = match interpreter_url(&raw_challenge) {
        Some(url) => url,
        None => {
            warn!("Homepage challenge has no interpreterUrl");
            return None;
        }
    };
    let interpreter_js = async {
        let response = client
            .get(&interpreter_url)
            .header("User-Agent", HOMEPAGE_USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.text().await.ok()
    }
    .await;
    let Some(interpreter_js) = interpreter_js else {
        warn!("Homepage challenge interpreter download failed");
        return None;
    };
    let challenge_json = build_challenge_data(raw_challenge, &interpreter_js)?;
    debug!(
        page_ms,
        has_event_id = extracted.has_event_id,
        content_flag = extracted.content_flag.as_str(),
        challenge_chars = challenge_json.len(),
        "Homepage BotGuard challenge ready"
    );
    Some(HomepageChallengeData {
        challenge_json,
        ytcfg: extracted.ytcfg,
    })
}

/// The `interpreterUrl` of a raw `ytAtN` challenge, as a full `https:` URL.
fn interpreter_url(raw_challenge: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw_challenge).ok()?;
    let trusted = value["bgChallenge"]["interpreterUrl"]
        ["privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"]
        .as_str()?;
    if trusted.is_empty() {
        return None;
    }
    Some(
        if trusted.starts_with("https:") || trusted.starts_with("http:") {
            trusted.to_string()
        } else {
            format!("https:{trusted}")
        },
    )
}

/// Build the Android-shaped challenge-data JSON from a raw `ytAtN` challenge
/// (`R` as JSON text) and the downloaded interpreter JS. Mirrors Android's
/// `parseDescrambledChallengeData`.
pub fn build_challenge_data(raw_challenge: &str, interpreter_js: &str) -> Option<String> {
    let root: Value = serde_json::from_str(raw_challenge).ok()?;
    let bg = root.get("bgChallenge")?;
    let get = |key: &str| bg.get(key)?.as_str().map(str::to_string);
    let trusted_url =
        bg["interpreterUrl"]["privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"]
            .as_str()?
            .to_string();
    let data = serde_json::json!({
        "interpreterJavascript": {
            "privateDoNotAccessOrElseSafeScriptWrappedValue": interpreter_js,
            "privateDoNotAccessOrElseTrustedResourceUrlWrappedValue": trusted_url,
        },
        "interpreterHash": get("interpreterHash")?,
        "program": get("program")?,
        "globalName": get("globalName")?,
        "clientExperimentsStateBlob": get("clientExperimentsStateBlob")?,
    });
    serde_json::to_string(&data).ok()
}

/// Extract `(ytcfg, ytAtN)` from a youtube.com page. Mirrors Android's
/// `extractHomepageChallenge`: the FIRST `ytcfg.set({...})` that parses as a
/// JSON object is the page config, and the challenge is the FIRST
/// `window.ytAtN({...})` object-literal call and must mention `bgChallenge`,
/// `program` and `interpreterUrl`. YouTube now emits two-argument
/// `ytcfg.set(key, value)` calls (e.g. `ytcfg.set('EMERGENCY_BASE_URL', ...)`)
/// ahead of the config object, a no-argument `window.ytAtN();` stub ahead of
/// the real challenge, and a later object can even carry single-quoted values
/// (`{"CSI_SERVICE_NAME": 'youtube', ...}`), so a candidate that is not a
/// JSON object is skipped instead of failing the page — Android's regexes
/// require `{` right after the call for the same reason. A page with no
/// usable config still yields its challenge with `ytcfg` unset (BotGuard just
/// sees no `EVENT_ID`). Never throws.
pub fn extract_homepage_challenge(html: &str) -> ExtractedChallenge {
    let content_flag = content_po_token_flag(html);
    let mut ytcfg: Option<String> = None;
    let mut has_event_id = false;

    if let Some(candidate) = extract_ytcfg_config(html) {
        if let Ok(config) = serde_json::from_str::<Value>(&candidate) {
            has_event_id = config
                .get("EVENT_ID")
                .and_then(Value::as_str)
                .map(|event_id| !event_id.is_empty())
                .unwrap_or(false);
            ytcfg = Some(candidate);
        }
    }

    let Some((_, payload)) = next_object_arg(html, "window.ytAtN(", 0) else {
        return ExtractedChallenge {
            raw_challenge: None,
            ytcfg,
            has_event_id,
            content_flag,
            failure: Some("no-atn"),
        };
    };
    let raw_challenge = match parse_loose_r(&payload) {
        Some(raw) => raw,
        None => {
            return ExtractedChallenge {
                raw_challenge: None,
                ytcfg,
                has_event_id,
                content_flag,
                failure: Some("atn-parse"),
            };
        }
    };
    if !raw_challenge.contains("bgChallenge")
        || !raw_challenge.contains("program")
        || !raw_challenge.contains("interpreterUrl")
    {
        return ExtractedChallenge {
            raw_challenge: None,
            ytcfg,
            has_event_id,
            content_flag,
            failure: Some("no-bgchallenge"),
        };
    }
    ExtractedChallenge {
        raw_challenge: Some(raw_challenge),
        ytcfg,
        has_event_id,
        content_flag,
        failure: None,
    }
}

fn content_po_token_flag(html: &str) -> String {
    let marker = "html5_generate_content_po_token";
    let Some(at) = html.find(marker) else {
        return "?".to_string();
    };
    let rest = &html[at + marker.len()..];
    let rest = rest
        .strip_prefix('=')
        .or_else(|| rest.strip_prefix("\\u003d"))
        .or_else(|| rest.strip_prefix("\\u003D"));
    match rest {
        Some(rest) if rest.starts_with("true") => "y".to_string(),
        Some(rest) if rest.starts_with("false") => "n".to_string(),
        _ => "?".to_string(),
    }
}

/// The page's first `ytcfg.set({...})` object that parses as JSON text.
/// YouTube now emits two-argument `ytcfg.set(key, value)` calls ahead of the
/// config object, so only a call whose next non-whitespace character is `{`
/// is a candidate at all, and a candidate that is not a JSON object (a JS
/// fragment, or an object with single-quoted values) is skipped in favour of
/// the next one. `None` when no candidate parses; the caller still uses the
/// challenge without a `ytcfg`.
fn extract_ytcfg_config(html: &str) -> Option<String> {
    const MARKER: &str = "ytcfg.set(";
    let mut from = 0;
    while let Some((next, candidate)) = next_object_arg(html, MARKER, from) {
        if serde_json::from_str::<Value>(&candidate)
            .map(|value| value.is_object())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
        from = next;
    }
    None
}

/// The next `marker` call at or after `from` whose argument is an object
/// literal: its balanced `{...}` text plus the offset to resume searching
/// after. A call is only a candidate when its next non-whitespace character
/// is `{` — YouTube's pages carry same-named calls that take no object at
/// all (`window.ytAtN(); delete window.ytAtN;`, two-argument
/// `ytcfg.set(key, value)`), which a plain first-match scan mistakes for
/// the real call. `None` when no further candidate exists.
fn next_object_arg(html: &str, marker: &str, from: usize) -> Option<(usize, String)> {
    let mut search_from = from;
    while let Some(at) = html[search_from..].find(marker) {
        let abs = search_from + at;
        let after = abs + marker.len();
        let mut j = after;
        while j < html.len() && (html.as_bytes()[j] as char).is_whitespace() {
            j += 1;
        }
        if j < html.len() && html.as_bytes()[j] == b'{' {
            if let Some(obj) = extract_balanced_object(&html[abs..], marker) {
                return Some((after, obj));
            }
        }
        search_from = after;
    }
    None
}

/// The balanced `{...}` object following `marker` in `html` (the first `{`
/// after the marker, up to its matching `}`), string-aware: braces inside
/// double-quoted strings and `\` escapes do not count. `None` when the
/// marker is absent or the object never closes.
fn extract_balanced_object(html: &str, marker: &str) -> Option<String> {
    let at = html.find(marker)?;
    let bytes = html.as_bytes();
    let mut i = at + marker.len();
    while i < bytes.len() && bytes[i] != b'{' {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let start = i;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let byte = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
        } else if byte == b'{' {
            depth += 1;
        } else if byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(html[start..=i].to_string());
            }
        }
        i += 1;
    }
    None
}

/// The `R` value of a `window.ytAtN({...})` payload as JSON text. Port of
/// Android's `parseLooseJSON`, which parses the JS-object-literal-ish payload:
/// trailing commas are dropped, single-quoted literals become JSON strings,
/// unquoted keys are quoted, and `\xNN` escapes are decoded inside string
/// values (an object/array `R` comes back re-serialized, a string `R` comes
/// back hex-decoded).
fn parse_loose_r(payload: &str) -> Option<String> {
    let step = strip_trailing_commas(payload);
    let step = quote_single_quoted_strings(&step);
    let step = quote_unquoted_keys(&step);
    let parsed: Value = serde_json::from_str(&step).ok()?;
    let raw = parsed.get("R")?;
    Some(match raw {
        Value::String(text) => decode_hex_escapes(text),
        Value::Object(_) | Value::Array(_) => {
            serde_json::to_string(&normalize_loose_value(raw.clone())).ok()?
        }
        _ => return None,
    })
}

/// BgUtils' `normalizeValue` for nested values: strings are hex-decoded, and
/// a decoded string that holds JSON becomes that JSON (normalized in turn).
fn normalize_loose_value(value: Value) -> Value {
    match value {
        Value::String(text) => {
            let decoded = decode_hex_escapes(&text);
            let trimmed = decoded.trim();
            if trimmed.starts_with('{') || trimmed.starts_with('[') {
                if let Ok(parsed) = serde_json::from_str::<Value>(&decoded) {
                    return normalize_loose_value(parsed);
                }
            }
            Value::String(decoded)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(normalize_loose_value).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, normalize_loose_value(value)))
                .collect(),
        ),
        other => other,
    }
}

/// Drop commas that precede `}` or `]` (outside double-quoted strings),
/// mirroring Android's trailing-comma regex.
fn strip_trailing_commas(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let byte = bytes[i];
        if in_string {
            let ch_len = utf8_len(byte);
            let end = (i + ch_len).min(bytes.len());
            out.push_str(&source[i..end]);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            i = end;
            continue;
        }
        match byte {
            b'"' => {
                in_string = true;
                out.push('"');
                i += 1;
            }
            b',' => {
                let mut j = i + 1;
                while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == b'}' || bytes[j] == b']') {
                    i += 1;
                } else {
                    out.push(',');
                    i += 1;
                }
            }
            _ => {
                // Copy one UTF-8 char (the payload is ASCII-shaped, but stay safe).
                let ch_len = utf8_len(bytes[i]);
                let end = (i + ch_len).min(bytes.len());
                out.push_str(&source[i..end]);
                i = end;
            }
        }
    }
    out
}

fn utf8_len(first: u8) -> usize {
    if first < 0x80 {
        1
    } else if first >> 5 == 0b110 {
        2
    } else if first >> 4 == 0b1110 {
        3
    } else {
        4
    }
}

/// BgUtils' `/'((?:[^'\\]|\\[\s\S])*)'/g` replace as a scanner (Android's
/// `quoteSingleQuotedStrings`): each single-quoted literal becomes a JSON
/// string, `\'` unescaped. A quote with no closing quote is left as it is.
fn quote_single_quoted_strings(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len() + 16);
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\'' {
            if let Some(end) = find_closing_single_quote(source, i + 1) {
                let inner = source[i + 1..end].replace("\\'", "'");
                out.push_str(&quote_json_str(&inner));
                i = end + 1;
                continue;
            }
        }
        let ch_len = utf8_len(bytes[i]);
        let end = (i + ch_len).min(bytes.len());
        out.push_str(&source[i..end]);
        i = end;
    }
    out
}

/// Index of the `'` closing a literal whose body starts at `from`, stepping
/// over `\` + any char; `None` when there is none.
fn find_closing_single_quote(source: &str, from: usize) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut j = from;
    while j < bytes.len() {
        match bytes[j] {
            b'\'' => return Some(j),
            b'\\' => j += 2,
            _ => j += 1,
        }
    }
    None
}

/// Quote unquoted object keys (`{key:` / `,key:` → `{"key":`), mirroring
/// Android's unquoted-key regex. Double-quoted strings are skipped.
fn quote_unquoted_keys(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len() + 16);
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let byte = bytes[i];
        if in_string {
            let ch_len = utf8_len(byte);
            let end = (i + ch_len).min(bytes.len());
            out.push_str(&source[i..end]);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            i = end;
            continue;
        }
        if byte == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        if byte == b'{' || byte == b',' {
            out.push(byte as char);
            i += 1;
            // Skip whitespace, then try an unquoted identifier followed by ':'.
            let mut j = i;
            while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                j += 1;
            }
            let key_start = j;
            while j < bytes.len()
                && ((bytes[j] as char).is_ascii_alphanumeric()
                    || bytes[j] == b'_'
                    || bytes[j] == b'$')
            {
                j += 1;
            }
            if j > key_start {
                let mut k = j;
                while k < bytes.len() && (bytes[k] as char).is_whitespace() {
                    k += 1;
                }
                if k < bytes.len() && bytes[k] == b':' {
                    out.push_str(&source[i..key_start]);
                    out.push_str(&quote_json_str(&source[key_start..j]));
                    out.push(':');
                    i = k + 1;
                    continue;
                }
            }
            // Not an unquoted key: copy the skipped whitespace verbatim.
            out.push_str(&source[i..j]);
            i = j;
            continue;
        }
        let ch_len = utf8_len(byte);
        let end = (i + ch_len).min(bytes.len());
        out.push_str(&source[i..end]);
        i = end;
    }
    out
}

/// `\x41` -> `A`, as BgUtils' `decodeHexEscapes`.
fn decode_hex_escapes(value: &str) -> String {
    if !value.contains("\\x") {
        return value.to_string();
    }
    let bytes = value.as_bytes();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && i + 3 < bytes.len()
            && bytes[i + 1] == b'x'
            && (bytes[i + 2] as char).is_ascii_hexdigit()
            && (bytes[i + 3] as char).is_ascii_hexdigit()
        {
            let hex = &value[i + 2..i + 4];
            if let Ok(code) = u8::from_str_radix(hex, 16) {
                out.push(code as char);
                i += 4;
                continue;
            }
        }
        let ch_len = utf8_len(bytes[i]);
        let end = (i + ch_len).min(bytes.len());
        out.push_str(&value[i..end]);
        i = end;
    }
    out
}

/// JSON-escape a string (Android's `quoteJson`).
fn quote_json_str(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => {
                out.push_str(&format!("\\u00{:02x}", ch as u32));
            }
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOMEPAGE: &str = r#"<!doctype html><html><head><script>
        ytcfg.set({"EVENT_ID":"abc123","SERIALIZED_EXPERIMENT_FLAGS":"html5_generate_content_po_token=true"});
        window.ytAtN({R: {bgChallenge: {interpreterHash: "h1", program: "p1", globalName: "g1", clientExperimentsStateBlob: "b1", interpreterUrl: {privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: "//www.gstatic.com/interp.js"}}}});
        </script></head></html>"#;

    #[test]
    fn extracts_ytcfg_and_challenge() {
        let extracted = extract_homepage_challenge(HOMEPAGE);
        assert_eq!(extracted.failure, None);
        assert!(extracted.has_event_id);
        assert_eq!(extracted.content_flag, "y");
        assert!(extracted.ytcfg.as_deref().unwrap().contains("abc123"));
        let raw = extracted.raw_challenge.unwrap();
        assert!(raw.contains("bgChallenge"));
        assert!(raw.contains("interpreterUrl"));
    }

    #[test]
    fn consent_page_has_no_challenge() {
        let extracted = extract_homepage_challenge("<html><body>consent</body></html>");
        assert_eq!(extracted.failure, Some("no-atn"));
        assert_eq!(extracted.raw_challenge, None);
    }

    #[test]
    fn bad_ytcfg_candidate_is_skipped() {
        // A candidate that is not JSON no longer fails the page: the next
        // parsable config wins, and the challenge is still used.
        let html = "ytcfg.set({not json}); ytcfg.set({\"EVENT_ID\":\"evt9\"}); window.ytAtN({R: {bgChallenge: 1, program: 2, interpreterUrl: 3}});";
        let extracted = extract_homepage_challenge(html);
        assert_eq!(extracted.failure, None);
        assert!(extracted.has_event_id);
        assert!(extracted.ytcfg.as_deref().unwrap().contains("evt9"));
        assert!(extracted.raw_challenge.is_some());
    }

    #[test]
    fn no_usable_ytcfg_still_yields_the_challenge() {
        // No parsable config at all: ytcfg is unset, but the challenge is
        // still extracted (BotGuard just sees no EVENT_ID).
        let html = "ytcfg.set({not json}); window.ytAtN({R: {bgChallenge: 1, program: 2, interpreterUrl: 3}});";
        let extracted = extract_homepage_challenge(html);
        assert_eq!(extracted.failure, None);
        assert_eq!(extracted.ytcfg, None);
        assert!(!extracted.has_event_id);
        assert!(extracted.raw_challenge.is_some());
    }

    #[test]
    fn two_arg_ytcfg_calls_do_not_break_the_challenge() {
        // Regression (2026-11-23): youtube.com now starts the page with
        // two-argument `ytcfg.set(key, value)` calls (`EMERGENCY_BASE_URL`
        // first) and ends it with a single-quoted object; the config object
        // in between must still be found, with the challenge alongside it.
        // Before the fix the first call's trailing JS fragment was taken as
        // the config, its parse failed, and the whole page failed with
        // `ytcfg-parse` — so the V4 mint never ran and every MWEB/WEB SABR
        // session died on a legacy token ~5s into playback.
        let html = r#"<!doctype html><html><head><script>
            ytcfg.set('EMERGENCY_BASE_URL', '\/error_204?t\x3djserror');
            </script><script>
            ytcfg.set({"EVENT_ID":"evt-live","SERIALIZED_EXPERIMENT_FLAGS":"html5_generate_content_po_token=true"});
            window.ytAtN({R: {bgChallenge: {interpreterHash: "h1", program: "p1", globalName: "g1", clientExperimentsStateBlob: "b1", interpreterUrl: {privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: "//www.gstatic.com/interp.js"}}}});
            </script><script>
            ytcfg.set({"CSI_SERVICE_NAME": 'youtube', "TIMING_A": 1});
            </script></head></html>"#;
        let extracted = extract_homepage_challenge(html);
        assert_eq!(extracted.failure, None);
        assert!(extracted.has_event_id);
        assert_eq!(extracted.content_flag, "y");
        assert!(extracted.ytcfg.as_deref().unwrap().contains("evt-live"));
        let raw = extracted.raw_challenge.unwrap();
        assert!(raw.contains("bgChallenge"));
        assert!(raw.contains("interpreterUrl"));
    }

    #[test]
    fn empty_ytatn_stub_call_is_skipped() {
        // Regression (2026-11-23): the page carries a no-argument
        // `window.ytAtN(); delete window.ytAtN;` stub ahead of the real
        // challenge call; a plain first-match scan takes the stub's trailing
        // JS as the payload and fails with `atn-parse`.
        let html = "window.ytAtN(); delete window.ytAtN; window.ytAtN({R: {bgChallenge: 1, program: 2, interpreterUrl: 3}});";
        let extracted = extract_homepage_challenge(html);
        assert_eq!(extracted.failure, None);
        let raw = extracted.raw_challenge.unwrap();
        assert!(raw.contains("bgChallenge"));
    }

    #[test]
    fn challenge_without_bgchallenge_is_unusable() {
        let html = "window.ytAtN({R: {something: 1}});";
        let extracted = extract_homepage_challenge(html);
        assert_eq!(extracted.failure, Some("no-bgchallenge"));
    }

    #[test]
    fn loose_json_single_quotes_and_unquoted_keys() {
        let payload = "{R: {'bgChallenge': 'x', program: 'p',}, trailing: 1,}";
        let raw = parse_loose_r(payload).unwrap();
        assert!(raw.contains("bgChallenge"));
    }

    #[test]
    fn loose_json_hex_escapes_in_string_r() {
        // R as a string holding JSON with \x escapes.
        let payload = r#"{R: "{\"bgChallenge\": \"a\\x62c\", \"program\": \"p\", \"interpreterUrl\": \"u\"}"}"#;
        let raw = parse_loose_r(payload).unwrap();
        assert!(raw.contains("abc"), "{raw}");
    }

    #[test]
    fn loose_json_r_object_round_trips() {
        let payload =
            r#"{R: {bgChallenge: {interpreterHash: "h"}, program: "p", interpreterUrl: "u"}}"#;
        let raw = parse_loose_r(payload).unwrap();
        assert!(raw.contains("\"program\":\"p\""), "{raw}");
    }

    #[test]
    fn challenge_data_shape_matches_android() {
        let raw = r#"{"bgChallenge": {"interpreterHash": "h1", "program": "p1", "globalName": "g1", "clientExperimentsStateBlob": "b1", "interpreterUrl": {"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue": "//www.gstatic.com/interp.js"}}}"#;
        let json = build_challenge_data(raw, "var interp = 1;").unwrap();
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            value["interpreterJavascript"]["privateDoNotAccessOrElseSafeScriptWrappedValue"]
                .as_str(),
            Some("var interp = 1;")
        );
        assert_eq!(
            value["interpreterJavascript"]
                ["privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"]
                .as_str(),
            Some("//www.gstatic.com/interp.js")
        );
        assert_eq!(value["program"].as_str(), Some("p1"));
        assert_eq!(value["globalName"].as_str(), Some("g1"));
    }

    #[test]
    fn interpreter_url_is_completed_to_https() {
        let raw = r#"{"bgChallenge": {"interpreterUrl": {"privateDoNotAccessOrElseTrustedResourceUrlWrappedValue": "//example.com/i.js"}}}"#;
        assert_eq!(
            interpreter_url(raw).as_deref(),
            Some("https://example.com/i.js")
        );
    }

    #[test]
    fn balanced_object_skips_braces_in_strings() {
        let html = r#"ytcfg.set({"a": "};" , "b": 1});"#;
        let found = extract_balanced_object(html, "ytcfg.set(").unwrap();
        assert!(found.contains("\"b\": 1"), "{found}");
    }

    #[test]
    fn content_flag_escaped_equals() {
        let html = r#"html5_generate_content_po_token\u003dfalse"#;
        assert_eq!(content_po_token_flag(html), "n");
        assert_eq!(content_po_token_flag("nothing here"), "?");
    }
}
