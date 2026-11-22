use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;

use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// A freshly minted attestation result from the headless BotGuard sidecar.
///
/// `po_token` is the visitorData-bound PO token used both in the `/player`
/// request body (`serviceIntegrityDimensions.poToken`) and as the SABR
/// `StreamerContext.po_token`. `integrity_token` is retained for callers that
/// need the raw GenerateIT token; `ttl` is the server-estimated lifetime.
#[derive(Debug, Clone)]
pub struct MintedToken {
    pub po_token: String,
    #[allow(dead_code)]
    pub integrity_token: String,
    pub ttl: u64,
    minted_at: Instant,
}

impl MintedToken {
    fn is_fresh(&self) -> bool {
        const REFRESH_MARGIN_SECS: u64 = 300;
        let lifetime = self.ttl.saturating_sub(REFRESH_MARGIN_SECS).max(60);
        self.minted_at.elapsed().as_secs() < lifetime
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResponse {
    success: bool,
    #[serde(default)]
    po_token: Option<String>,
    #[serde(default)]
    integrity_token: Option<String>,
    #[serde(default)]
    ttl: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

/// Cache of minted tokens keyed by content binding (visitor data). The mutex is
/// held across the mint so concurrent requests for the same binding don't each
/// spawn the (multi-second) BotGuard VM.
fn token_cache() -> &'static Mutex<HashMap<String, MintedToken>> {
    static CACHE: OnceLock<Mutex<HashMap<String, MintedToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve the Node executable. Honors `YOUGLIDETUBE_NODE`, else relies on PATH.
pub(crate) fn node_command() -> String {
    std::env::var("YOUGLIDETUBE_NODE").unwrap_or_else(|_| "node".to_string())
}

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record Tauri's resource directory. Linux bundles install resources under
/// `<prefix>/lib/<productName>/`, which is not an ancestor of the executable,
/// so the walk in [`sidecar_candidates`] alone never finds them there.
pub(crate) fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Locate a bundled `sidecar/<name>` script, in packaged (Tauri resource dir,
/// next to the executable or under its `resources`) and dev (repo or
/// `src-tauri`) layouts.
pub(crate) fn sidecar_script_path(name: &str, override_var: &str) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var(override_var) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    let cwd = std::env::current_dir().ok();
    let exe = std::env::current_exe().ok();
    sidecar_candidates(
        name,
        RESOURCE_DIR.get().map(PathBuf::as_path),
        cwd.as_deref(),
        exe.as_deref(),
    )
    .into_iter()
    .find(|path| path.is_file())
}

fn sidecar_candidates(
    name: &str,
    resource_dir: Option<&Path>,
    cwd: Option<&Path>,
    exe: Option<&Path>,
) -> Vec<PathBuf> {
    let rel = Path::new("sidecar").join(name);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = resource_dir {
        candidates.push(dir.join(&rel));
    }

    candidates.push(rel.clone());
    candidates.push(Path::new("src-tauri").join(&rel));

    if let Some(cwd) = cwd {
        candidates.push(cwd.join(&rel));
        candidates.push(cwd.join("src-tauri").join(&rel));
    }

    let mut dir = exe.and_then(Path::parent);
    for _ in 0..5 {
        let Some(current) = dir else { break };
        candidates.push(current.join(&rel));
        candidates.push(current.join("resources").join(&rel));
        dir = current.parent();
    }

    candidates
}

async fn run_sidecar(content_binding: &str) -> Option<MintedToken> {
    let Some(script) = sidecar_script_path("integrity.cjs", "YOUGLIDETUBE_INTEGRITY_SCRIPT") else {
        warn!("integrity.cjs sidecar not found; cannot mint PO token");
        return None;
    };

    let output = match crate::appimage::host_tokio_command(node_command())
        .arg(&script)
        .arg(content_binding)
        .output()
        .await
    {
        Ok(output) => output,
        Err(error) => {
            warn!(%error, "Failed to spawn Node integrity sidecar (is Node installed / on PATH?)");
            return None;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    // The sidecar writes exactly one JSON object to stdout; be tolerant of any
    // stray output by taking the last brace-delimited line.
    let json_line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{') && line.ends_with('}'))
        .unwrap_or_else(|| stdout.trim());

    let parsed: SidecarResponse = match serde_json::from_str(json_line) {
        Ok(parsed) => parsed,
        Err(error) => {
            warn!(
                %error,
                stderr = %String::from_utf8_lossy(&output.stderr).trim(),
                "Could not parse integrity sidecar output"
            );
            return None;
        }
    };

    if !parsed.success {
        warn!(
            error = parsed.error.as_deref().unwrap_or("unknown"),
            "Integrity sidecar reported failure"
        );
        return None;
    }

    let po_token = parsed.po_token?;
    if po_token.is_empty() {
        return None;
    }

    debug!(
        ttl = parsed.ttl.unwrap_or(0),
        "Minted PO token via BotGuard sidecar"
    );
    Some(MintedToken {
        po_token,
        integrity_token: parsed.integrity_token.unwrap_or_default(),
        ttl: parsed.ttl.unwrap_or(43200),
        minted_at: Instant::now(),
    })
}

/// The 11-character visitor ID a GVS streaming token must be bound to.
///
/// Port of Android `VisitorId`: `visitorData` is a base64url protobuf several
/// hundred characters long, and its first field is the short visitor ID. GVS
/// binds a logged-out streaming token to **that ID**, not to the surrounding
/// blob — binding to the blob produces a token the server accepts at load time
/// and refuses once enforcement kicks in (`sabr.media_serving_enforcement_id_error`
/// on the SABR path, a plain 403 past the free window on direct URLs).
/// Mirrors yt-dlp's `_extract_visitor_id`, including its default of preferring
/// the visitor ID over the raw blob.
pub fn extract_visitor_id(visitor_data: &str) -> Option<String> {
    if visitor_data.is_empty() {
        return None;
    }
    // Field 1 (`0x0A`), length 11 (`0x0B`) — the two header bytes before the
    // ID itself.
    const ID_START: usize = 2;
    const ID_LENGTH: usize = 11;
    let decoded = decode_b64url_loose(visitor_data)?;
    if decoded.len() < ID_START + ID_LENGTH {
        return None;
    }
    let id = std::str::from_utf8(&decoded[ID_START..ID_START + ID_LENGTH]).ok()?;
    let is_id_char = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    if id.chars().all(is_id_char) {
        Some(id.to_string())
    } else {
        None
    }
}

/// The identifier a GVS/streaming token should be minted against for this
/// session: the extracted visitor ID, or the full visitor data when it cannot
/// be read — matching yt-dlp's fallback.
#[must_use]
pub fn gvs_binding(visitor_data: &str) -> String {
    extract_visitor_id(visitor_data).unwrap_or_else(|| visitor_data.to_string())
}

/// Base64url with optional padding, tolerant of the `-`/`_` alphabet.
/// Mirrors the SABR engine's `decode_b64_loose` without depending on it.
fn decode_b64url_loose(input: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let normalized = input.replace('-', "+").replace('_', "/");
    let trimmed = normalized.trim_end_matches('=');
    base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(trimmed)
        .ok()
}

/// BgUtils documents a healthy content-bound PO token as 110-128 **characters**
/// of base64url — the unit matters. An earlier reading compared 110-128 against
/// the *decoded bytes*, which no real token can reach (measured over 88 mints
/// on Android, every token was 116 or 120 characters / 87 or 90 decoded
/// bytes), and classed every token cold. Port of Android
/// `PoTokenAttestationPolicy`, whose current rule is that length is a stable
/// property of the session: a short token is logged, not re-minted — re-running
/// the same challenge cannot lengthen it, it only holds the attestation lock
/// for seconds on every mint. A token the server actually refuses is handled
/// by evidence, not length: the refusal forces the next mint to re-attest
/// (`remint_po_token`).
pub const MIN_TRUSTED_POT_LENGTH: usize = 110;

/// Length of a base64 token in characters, ignoring padding.
#[must_use]
pub fn po_token_length_chars(base64_token: &str) -> usize {
    base64_token.trim_end_matches('=').len()
}

/// Whether a minted token is shorter than any healthy one. A low-trust token
/// is still used — see [`MIN_TRUSTED_POT_LENGTH`].
#[must_use]
pub fn is_low_trust_po_token(base64_token: &str) -> bool {
    po_token_length_chars(base64_token) < MIN_TRUSTED_POT_LENGTH
}

/// Mint (or reuse a cached) attestation token bound to `content_binding`.
/// The two bindings are minted separately and must not be mixed:
/// - the `/player` request and the SABR `StreamerContext.po_token` bind to
///   the **video id** (Android mints its player pot that way, and measured
///   the video-id-bound token to work in the session);
/// - the direct format URLs bind to the **visitor ID** ([`gvs_binding`]),
///   the 11-character ID extracted from the session visitor data — that
///   token rides on the URLs as `pot=`, never in the session.
/// For logged-out playback the binding must match the identity the requests
/// the token accompanies carry.
pub async fn mint_po_token(content_binding: &str) -> Option<MintedToken> {
    if content_binding.is_empty() {
        return None;
    }

    let mut cache = token_cache().lock().await;
    if let Some(cached) = cache.get(content_binding) {
        if cached.is_fresh() {
            return Some(cached.clone());
        }
    }

    // Prefer the real-browser WebView mint (highest-fidelity attestation); fall
    // back to the headless Node sidecar when there is no GUI (unit tests, dev).
    let minted = match crate::api::innertube::core::webview_pot::mint(content_binding).await {
        Some(result) => MintedToken {
            po_token: result.po_token,
            integrity_token: result.integrity_token,
            ttl: result.ttl,
            minted_at: Instant::now(),
        },
        None => run_sidecar(content_binding).await?,
    };
    // Observability, without ever logging the token or the binding itself: a
    // SABR session that dies on attestation is otherwise indistinguishable
    // from a good one until the server refuses it mid-playback.
    let binding_kind = if content_binding.len() == 11 {
        "short-id"
    } else {
        "visitor-data"
    };
    let token_chars = po_token_length_chars(&minted.po_token);
    if is_low_trust_po_token(&minted.po_token) {
        warn!(
            binding_kind,
            binding_chars = content_binding.len(),
            token_chars,
            "Minted a low-trust PO token; using it anyway — length is a property of the session, re-minting cannot lengthen it"
        );
    } else {
        debug!(
            binding_kind,
            binding_chars = content_binding.len(),
            token_chars,
            "Minted PO token via BotGuard"
        );
    }
    cache.insert(content_binding.to_string(), minted.clone());
    Some(minted)
}

/// Generate a BotGuard PO token bound to `content_binding`. Thin wrapper over
/// [`mint_po_token`] kept for existing call sites that only need the token
/// string.
pub async fn generate_po_token(content_binding: &str) -> Option<String> {
    mint_po_token(content_binding)
        .await
        .map(|token| token.po_token)
}

/// Mint a new token for `content_binding`, replacing any cached one. For a SABR
/// session the server has escalated to `ATTESTATION_REQUIRED`: handing back the
/// cached token it just refused would only be refused again.
pub async fn remint_po_token(content_binding: &str) -> Option<String> {
    token_cache().lock().await.remove(content_binding);
    generate_po_token(content_binding).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_dir_is_tried_first() {
        let candidates = sidecar_candidates(
            "nsig.cjs",
            Some(Path::new("/usr/lib/YouGlideTube Beta")),
            None,
            Some(Path::new("/usr/bin/youglidetube-beta")),
        );
        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/usr/lib/YouGlideTube Beta/sidecar/nsig.cjs"))
        );
    }

    #[test]
    fn flatpak_resource_dir_is_a_candidate() {
        let candidates = sidecar_candidates(
            "integrity.cjs",
            Some(Path::new("/app/lib/YouGlideTube")),
            None,
            Some(Path::new("/app/bin/youglidetube")),
        );
        assert!(candidates.contains(&PathBuf::from("/app/lib/YouGlideTube/sidecar/integrity.cjs")));
    }

    #[test]
    fn executable_ancestors_are_still_walked() {
        let candidates = sidecar_candidates(
            "nsig.cjs",
            None,
            None,
            Some(Path::new("C:/Program Files/YouGlideTube/youglidetube.exe")),
        );
        assert!(
            candidates.contains(
                &Path::new("C:/Program Files/YouGlideTube")
                    .join("sidecar")
                    .join("nsig.cjs")
            )
        );
    }

    #[test]
    fn dev_layouts_follow_the_working_directory() {
        let candidates = sidecar_candidates("integrity.cjs", None, Some(Path::new("/repo")), None);
        assert!(candidates.contains(&PathBuf::from("/repo/src-tauri/sidecar/integrity.cjs")));
    }

    fn visitor_data_for(id: &str) -> String {
        use base64::Engine;
        let mut bytes = vec![0x0Au8, 0x0Bu8];
        bytes.extend_from_slice(id.as_bytes());
        bytes.extend_from_slice(b"trailing-protobuf-bytes");
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    #[test]
    fn visitor_id_is_the_first_field_of_visitor_data() {
        // Android VisitorIdTest's shape: field 1, length 11, then the ID.
        assert_eq!(
            extract_visitor_id(&visitor_data_for("dDVKxQaQeTg")).as_deref(),
            Some("dDVKxQaQeTg")
        );
        assert_eq!(
            gvs_binding(&visitor_data_for("dDVKxQaQeTg")),
            "dDVKxQaQeTg"
        );
    }

    #[test]
    fn visitor_id_falls_back_to_the_blob_when_it_cannot_be_read() {
        assert_eq!(extract_visitor_id(""), None);
        assert_eq!(extract_visitor_id("not-base64!!!"), None);
        assert_eq!(extract_visitor_id("aGk"), None);
        let blob = visitor_data_for("bad id!!!!!");
        assert_eq!(extract_visitor_id(&blob), None);
        assert_eq!(gvs_binding(&blob), blob);
    }

    #[test]
    fn trust_is_measured_in_characters_not_bytes() {
        // Android measured every healthy token at 116 or 120 characters
        // (87 or 90 decoded bytes): a byte reading would class them all cold.
        assert!(!is_low_trust_po_token(&"a".repeat(116)));
        assert!(!is_low_trust_po_token(&"a".repeat(120)));
        assert!(!is_low_trust_po_token(&format!("{}==", "a".repeat(116))));
        assert!(is_low_trust_po_token(&"a".repeat(109)));
        assert_eq!(po_token_length_chars(&format!("{}==", "a".repeat(116))), 116);
    }
}
