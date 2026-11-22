//! Real-browser poToken minter via a hidden Tauri web view.
//!
//! The headless Node sidecar ([`super::botguard`]) mints a valid token, but its
//! attestation is synthetic (a `vm` sandbox + DOM mock). The mobile app mints in
//! a real web view, so this runs the *same* bgutils flow inside a hidden web view
//! ([`super::hidden_webview`]): the proxy serves [`MINT_PAGE_HTML`] at `/potmint`,
//! and the page runs the BotGuard challenge + VM snapshot + `GenerateIT` + mint
//! in the real engine (the WAA endpoints are CORS-permissive, so no Rust round
//! trip) and reports the token back. Without a GUI `mint()` returns `None` and
//! the caller falls back to the Node sidecar.
//!
//! The challenge comes from the youtube.com homepage first (see
//! [`super::homepage_challenge`]): Android measured that tokens minted from the
//! legacy WAA `Create` challenge are refused for WEB/MWEB sessions, so the page
//! tries the homepage challenge and only falls back to `Waa/Create` when no
//! homepage challenge is available.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tracing::debug;

use super::homepage_challenge::HomepageChallengeData;

// A successful in-browser mint takes ~1-2s; cap failures so a broken WebView path
// can't stall a stream resolve for long before the Node-sidecar fallback.
const MINT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long one homepage BotGuard challenge serves mints. The challenge
/// (program + interpreter + `ytcfg`) is identity-independent — only the mint
/// callback takes the binding — so one fetch serves every mint until it goes
/// stale. Android keeps the same session until its integrity token expires
/// (~12h); six hours here leaves margin against a rotated program.
const CHALLENGE_TTL: Duration = Duration::from_secs(6 * 3600);

static CHALLENGE_CACHE: OnceLock<Mutex<Option<(HomepageChallengeData, Instant)>>> =
    OnceLock::new();

fn challenge_cache() -> &'static Mutex<Option<(HomepageChallengeData, Instant)>> {
    CHALLENGE_CACHE.get_or_init(|| Mutex::new(None))
}

/// The cached homepage challenge as the JSON the mint page fetches from
/// `/potchallenge`: `{"challenge": {...}, "ytcfg": "..."|null}`. `None` when
/// no fresh challenge is cached — the page then falls back to the legacy
/// WAA `Create` challenge.
pub(crate) fn cached_challenge_json() -> Option<String> {
    let cached = challenge_cache().lock().ok()?;
    let (data, fetched_at) = cached.as_ref()?;
    if fetched_at.elapsed() > CHALLENGE_TTL {
        return None;
    }
    let challenge: serde_json::Value =
        serde_json::from_str(&data.challenge_json).ok()?;
    serde_json::to_string(&serde_json::json!({
        "challenge": challenge,
        "ytcfg": data.ytcfg,
    }))
    .ok()
}

/// Fetch the homepage challenge into the cache unless a fresh one is already
/// there. Best-effort: a failed fetch just leaves the legacy path in place.
async fn ensure_homepage_challenge() {
    let fresh = challenge_cache()
        .lock()
        .map(|cached| {
            matches!(cached.as_ref(), Some((_, fetched_at)) if fetched_at.elapsed() <= CHALLENGE_TTL)
        })
        .unwrap_or(false);
    if fresh {
        return;
    }
    if let Some(data) = super::homepage_challenge::fetch_homepage_challenge().await {
        if let Ok(mut cached) = challenge_cache().lock() {
            *cached = Some((data, Instant::now()));
        }
    }
}

#[derive(Clone)]
pub struct PotResult {
    pub po_token: String,
    pub integrity_token: String,
    pub ttl: u64,
}

/// Mint a poToken bound to `content_binding` (visitor data) in a hidden WebView.
/// Returns `None` if there is no GUI app handle, the proxy isn't up, or the mint
/// times out — the caller then falls back to the headless sidecar.
pub async fn mint(content_binding: &str) -> Option<PotResult> {
    // Warm the homepage challenge first: the mint page tries it before the
    // legacy WAA Create flow. Cached process-wide, so this fetch runs at most
    // once per session.
    ensure_homepage_challenge().await;
    let result = super::hidden_webview::run(
        "youglidetube-pot-minter",
        "/potmint",
        &[("binding", content_binding)],
        MINT_TIMEOUT,
    )
    .await?;
    let po_token = result
        .get("poToken")
        .filter(|token| !token.is_empty())?
        .clone();
    let ttl = result
        .get("ttl")
        .and_then(|ttl| ttl.parse().ok())
        .unwrap_or(43200);
    let challenge = result
        .get("challenge")
        .map(String::as_str)
        .unwrap_or("legacy");
    debug!(ttl, challenge, "Minted PO token via WebView");
    Some(PotResult {
        po_token,
        integrity_token: String::new(),
        ttl,
    })
}

/// The mint page served by the proxy at `/potmint`. Runs the full bgutils flow in
/// real Chromium (real DOM/crypto — no mock needed) and reports the token back to
/// the proxy. Its `<meta>` CSP permits `eval` (BotGuard is an interpreter) and the
/// CORS-permissive WAA endpoints. The challenge comes from the youtube.com
/// homepage first (`/potchallenge`, served from Rust): its `ytcfg` is injected
/// as `yt.config_` so BotGuard sees the `EVENT_ID`, and only when no homepage
/// challenge is available does the page fall back to the legacy `Waa/Create`
/// challenge (whose tokens YouTube refuses for WEB/MWEB sessions).
pub const MINT_PAGE_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src https://jnn-pa.googleapis.com http://127.0.0.1:* http://localhost:*;">
</head><body><script>
(function () {
  'use strict';
  var REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
  var API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
  var CREATE = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create';
  var GENERATE_IT = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT';
  var params = new URLSearchParams(location.search);
  var id = params.get('id');
  var visitorData = params.get('binding');

  function report(query) { try { fetch('/webviewresult?' + query); } catch (e) {} }
  function ok(po, ttl, challenge) { report('id=' + encodeURIComponent(id) + '&poToken=' + encodeURIComponent(po) + '&ttl=' + ttl + '&challenge=' + encodeURIComponent(challenge || 'legacy')); }
  function fail(msg) { report('id=' + encodeURIComponent(id) + '&error=' + encodeURIComponent(msg || 'error')); }

  function b64ToU8(b64) {
    var m = b64;
    if (/[-_.]/.test(b64)) { m = b64.replace(/[-_.]/g, function (c) { return { '-': '+', '_': '/', '.': '=' }[c]; }); }
    var raw = atob(m); var u = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  function u8ToB64url(u8) {
    var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  }

  // Shared tail of both challenge paths: run the BotGuard VM, snapshot,
  // GenerateIT, and mint one token bound to `visitorData` (the content
  // binding: a video id for the player token, a visitor ID for the streaming
  // token). Mirrors Android's po_token2.html runBotGuard/loadBotGuard.
  async function runVm(interpreterJs, program, globalName) {
    (0, eval)(interpreterJs);
    var vm = window[globalName];
    if (!vm || typeof vm.a !== 'function') throw new Error('vm init missing');
    var fns = await new Promise(function (res) { vm.a(program, function (as) { res({ as: as }); }, true, undefined, function () {}, [[], []]); });
    if (!fns.as) throw new Error('no async snapshot');
    var webPo = [];
    var bgResp = await new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('snapshot timeout')); }, 10000);
      fns.as(function (resp) { clearTimeout(t); res(resp); }, [undefined, undefined, webPo, true]);
    });
    var it = await fetch(GENERATE_IT, { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': API_KEY, 'X-User-Agent': 'grpc-web-javascript/0.1' }, body: JSON.stringify([REQUEST_KEY, bgResp]) });
    if (!it.ok) throw new Error('GenerateIT ' + it.status);
    var itj = await it.json();
    var integrityToken = itj[0], ttl = itj[1] || 43200;
    var getMinter = webPo[0];
    if (!getMinter) throw new Error('no minter');
    var mintCb = await getMinter(b64ToU8(integrityToken));
    if (typeof mintCb !== 'function') throw new Error('mint callback');
    var rawPo = await mintCb(new TextEncoder().encode(visitorData));
    if (!rawPo || rawPo.constructor.name !== 'Uint8Array') throw new Error('raw token');
    return { po: u8ToB64url(rawPo), ttl: ttl };
  }

  // The homepage challenge (see homepage_challenge.rs): the challenge the
  // page's ytcfg came with, so BotGuard sees the EVENT_ID it reads from
  // yt.config_. One attempt only — a stale challenge will not heal by
  // retrying, and the legacy flow below is the fallback. Null when no
  // homepage challenge is cached.
  async function v4attempt() {
    var r = await fetch('/potchallenge');
    if (!r.ok) return null;
    var ch = await r.json();
    var cd = ch.challenge;
    if (!cd || !cd.program || !cd.globalName) throw new Error('bad challenge');
    var interp = cd.interpreterJavascript && cd.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interp) throw new Error('no interpreter');
    if (ch.ytcfg) { window.yt = { config_: JSON.parse(ch.ytcfg) }; }
    return runVm(interp, cd.program, cd.globalName);
  }

  async function legacyAttempt() {
    var r = await fetch(CREATE, { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': API_KEY, 'X-User-Agent': 'sap/waa/1' }, body: JSON.stringify([REQUEST_KEY, visitorData]) });
    if (!r.ok) throw new Error('Create ' + r.status);
    var raw = await r.json();
    if (!Array.isArray(raw) || typeof raw[1] !== 'string') throw new Error('bad challenge');
    var scrambled = raw[1]; var pad = scrambled.length % 4; if (pad) scrambled += '===='.slice(pad);
    var buf = b64ToU8(scrambled); var out = new Uint8Array(buf.length);
    for (var i = 0; i < buf.length; i++) out[i] = (buf[i] + 97) & 255;
    var challenge = JSON.parse(new TextDecoder().decode(out));
    var wrapped = challenge[1], program = challenge[4], globalName = challenge[5];
    var interp = null;
    if (Array.isArray(wrapped)) {
      for (var j = 0; j < wrapped.length; j++) {
        var v = wrapped[j];
        if (typeof v === 'string' && (v.indexOf('function') >= 0 || v.indexOf('window') >= 0 || v.indexOf('eval') >= 0)) { interp = v; break; }
      }
    }
    if (!interp) throw new Error('no interpreter');
    return runVm(interp, program, globalName);
  }

  (async function () {
    if (!id || !visitorData) { fail('missing params'); return; }
    try { var v4 = await v4attempt(); if (v4) { ok(v4.po, v4.ttl, 'homepage'); return; } } catch (e) { /* fall through to legacy */ }
    for (var k = 0; k < 5; k++) {
      try { var res = await legacyAttempt(); ok(res.po, res.ttl, 'legacy'); return; } catch (e) { /* fresh challenge next loop */ }
    }
    fail('all attempts failed');
  })();
})();
</script></body></html>"#;
