# YouGlideTube Desktop — Tauri plan

Fork of [Flow Desktop](https://github.com/Flow-Tube/Flow-Desktop) v0.1.0-beta4,
rebranded + rethemed for YouGlideTube. The Compose Multiplatform app at
`~/workspace/youglide-desktop/` stays untouched as the working fallback
(87/87 tests green) until the Tauri app reaches feature parity on a real
machine. Full size analysis: `~/workspace/youglide-desktop/SIZE_SPIKE.md`.

## Standing rule — YouGlideTube parity (user explicit, 2026-11-21)

The Tauri app must look, feel and behave like the user's YouGlideTube
mobile app — settings, screens, features, naming, everything. Flow
contributes ONLY its method (the Tauri size/architecture), NEVER its look,
feel, branding or feature set. Flow's UI is a starting point, never the
target. Where a Flow pattern and a YouGlideTube pattern conflict, the
YouGlideTube pattern wins; where the mobile app has no equivalent (desktop
layout), mirror the CMP app at `~/workspace/youglide-desktop/`, which was
built to the same rule. Step 3 must include a full feature-by-feature
parity audit against the Android app (1,703 files) and close the gaps.

## Step 1 — Fork + build + rebrand + retheme ✅ DONE (2026-11-21)

- Cloned Flow at `v0.1.0-beta4` (commit `106a0a2b`) with full history.
- Toolchains: Rust stable 1.100.0 (rustup), pnpm 11.9.0, Node 24.22.1.
  System deps for Tauri on Linux installed via apt
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, …).
- Frontend build green: `tsc` exit 0, `vite build` exit 0 (dist 7.6 MB).
- `cargo check` in `src-tauri/` — **green**: `Finished dev profile in
  30m 15s`, exit 0, one pre-existing upstream warning (`dead_code`:
  `ACTIVATE_NOTIFICATION_EVENT` in `notification_service.rs`, not ours).
- Frontend tests green: full `vitest run` = **2,706 tests, 2,705 passed**;
  the single failure was the pre-fix `themes.test.ts` fallback assertion
  (the suite had loaded the file before the test was updated to the new
  default); re-run of the 4 theme files after the fix = **64/64 green**.
- Backend tests (final): `cargo test -j 1 --lib --tests --no-fail-fast`
  = **74 binaries, 1,850 passed, 1 failed, 11 ignored** (exit 101,
  ~7.5 min execution after the ~20 min first build). The single failure
  is `sync2_lan::a_dial_tries_lower_epochs_and_stops_after_four_attempts`
  (expected dial epochs `[5,4,3,2]`, got `[]` under load); it **passed
  on isolated retry** — a load/timing-flaky LAN test, not a regression
  (step 1 changed zero Rust files). Lib unittests alone: 1,257 passed,
  0 failed, 6 ignored.
- Rebrand: product `YouGlideTube`, identifier
  `io.github.shivytyahoo.glidetube.desktop`, window title, package name,
  README header, copyright. License stays GPL-3.0-only (Flow's `LICENSE`
  kept); attribution in `FORK.md`.
- Retheme: new `youglidetube` theme seed is the default (dark `#1A1C1E`,
  brand `#1E5AA8`, saffron `#E85D04`, coral `#FF3D68` as a CSS token).
  No layouts redesigned.

## Step 2 — Google sign-in ✅ DONE (2026-11-21)

Ported the CMP app's WebView sign-in to Tauri 2 (Flow has none). Backend
approach unchanged by the parity rule below — only the UI follows the
mobile app.

**Backend (Rust, `src-tauri/src/auth/` + transport):**
- `auth/sapisid.rs` — SHA-1 `SAPISIDHASH`, cookie parsing, session-proof
  rule (SAPISID + one of SID/HSID/LOGIN_INFO), cookie priority
  SAPISID → `__Secure-3PSAPISID` → `__Secure-1PSAPISID`, header building.
- `auth/session.rs` — `AuthSession`: persists the cookie string to
  `google-session.txt` in the app-data dir (0600 on Unix), restores on
  startup (drops stale cookies), sign-out deletes the file.
- `auth/login_window.rs` — second `WebviewWindow` at the Android login
  URL, polls `Webview::cookies()` every 1.5 s from `spawn_blocking`
  (never from a sync command — it deadlocks on Windows), emits
  `google-sign-in-completed` / `-failed` / `-cancelled`, wipes the login
  window's browsing data after capture; closing the window cancels
  without touching auth.
- `auth/mod.rs`, `commands/auth.rs` — commands `get_auth_status`,
  `start_google_sign_in`, `cancel_google_sign_in`, `sign_in_with_cookie`
  (advanced fallback), `sign_out` (also wipes the main window's browsing
  data best-effort). Registered in `lib.rs`; session restored in `setup`
  and set on the `InnertubeClient`.
- Transport (`api/innertube/transport/request.rs`, `send.rs`,
  `core/http.rs`, `core/context.rs`): every InnerTube call computes fresh
  auth headers per call — signed-in sends `Authorization: SAPISIDHASH …`
  + the session `Cookie:` (replacing anonymous `SOCS=CAE=`), anonymous
  sends the old headers. `sha1 = "0.10"` added to `Cargo.toml`.
- No secrets in logs or files; no cookies stored anywhere except the
  0600 session file.

**Frontend (YouGlideTube patterns, NOT Flow's account UI):**
- Sign-in lives in the top bar + a "Sign in" dialog, exactly like the
  CMP app (`App.kt` `SignInDialog`) and the mobile app — there is NO
  account settings tab. Top bar shows a text **"Sign in"** button when
  signed out; when signed in, an avatar circle (brand-blue, "Y" initial
  — no display name is stored yet, see step 3) + a logout icon that
  signs out immediately.
- `src/components/GoogleSignInDialog.tsx` — title "Sign in"; Option 1
  "Sign in with Google (WebView)" (opens the login window; closes itself
  on the completed event); Option 2 "Cookie sign-in (advanced)" with the
  `SAPISID=...; LOGIN_INFO=...` placeholder; footer "Your session stays
  on this device and is only sent to YouTube — same promise as the mobile
  app." TV-code is NOT in the dialog and never will be — out of scope
  by explicit user decision (2026-11-21); WebView sign-in is the only
  sign-in path (cookie-paste stays as Option 2).
- `src/lib/useGoogleAccount.ts` — hook: status (`signed-out` /
  `signing-in` / `signed-in`), error, `startSignIn` / `signOut` /
  `signInWithCookie`; subscribes to the three backend events and reloads
  the home feed on sign-in/out. `listen()` is try/catch-guarded so the
  hook degrades in jsdom tests (a bare `listen()` rejects outside
  Tauri and produced 4 unhandled-rejection errors in the suite — fixed
  2026-11-21, see verification).
- Strings in `src/lib/i18n/strings.json` only (`sign_in*`, `sign_out`);
  `getString` falls back to English for other locales.
- Files changed: `src-tauri/src/auth/{sapisid,session,login_window,mod}.rs`,
  `src-tauri/src/commands/{auth.rs,mod.rs}`, `src-tauri/src/lib.rs`,
  `src-tauri/Cargo.{toml,lock}`,
  `src-tauri/src/api/innertube/{transport/request.rs,transport/send.rs,core/http.rs,core/context.rs,mod.rs}`,
  `src/components/{GoogleSignInDialog.tsx,GoogleSignInDialog.test.ts,layout/Topbar.tsx}`,
  `src/lib/{useGoogleAccount.ts,useGoogleAccount.test.ts}`,
  `src/lib/i18n/strings.json`. `~/workspace/youglide-desktop/` untouched.

**Verification:**
- `cargo check` green (1 pre-existing upstream `dead_code` warning only).
- Rust auth tests: `cargo test -j 1 --lib auth::` = **14/14 passed**.
- Full backend suite: `cargo test -j 1 --lib --tests --no-fail-fast` =
  **74 binaries, 1,866 passed, 1 failed, 11 ignored** (exit 101). The
  single failure is the known flaky
  `sync2_lan::a_dial_tries_lower_epochs_and_stops_after_four_attempts`
  (expected dial epochs `[5,4,3,2]`, got `[]` under load) — it **passed
  on clean isolated retry** (`cargo test -j 1 --test sync2_lan
  a_dial_tries_lower_epochs_and_stops_after_four_attempts`, 7.4 s, exit
  0), same as step 1. (An earlier retry that failed 5/23 ran
  concurrently with a second full-suite run — contaminated, ignore it.)
  `tests/sync2_lan.rs` has zero references to `InnertubeClient`/`auth`/
  `lib.rs`, so the sign-in change cannot affect it. Lib unittests alone:
  1,273 passed, 0 failed, 6 ignored (step 1: 1,257 — the +16 is the 14
  new auth tests plus 2).
- `tsc` exit 0; `vite build` exit 0 (dist 7.6 MB, unchanged).
- Full frontend suite after the `listen()` fix: `vitest run` =
  **2,710 passed, 0 errors, exit 0** (457 files).
- After the parity UI rework: affected files `vitest run` =
  **10/10 passed** (`GoogleSignInDialog`, `Topbar`, `settingsIndex`,
  `useGoogleAccount`).

**Not verified here (same sandbox limits as step 1):** no real Google
login ever ran — headless, `google.com` hangs, no display. First login
on the user's machine decides, including whether Google accepts the
embedded webview (same refusal risk as the CMP build). How to test on a
real machine: run the app, click **Sign in** in the top bar, sign in on
Google's page in the window that opens; the window should close by
itself and the home feed should reload signed-in (avatar + logout icon
in the top bar). If Google refuses the window, use Option 2 in the
dialog with a `SAPISID` + `LOGIN_INFO` cookie header copied from a
signed-in youtube.com browser session. Sign-out: the logout icon in the
top bar; the session file and browsing data are deleted.

**Residual risk (same as the CMP build):** Google may refuse the login in
an embedded webview. First real login on a user machine decides.

## Step 3 — Parity audit + gap closes ✅ DONE (2026-11-21)

Full audit: [`PARITY.md`](PARITY.md) — Android v1.1.1 surveyed
read-only from a fresh shallow clone (`/tmp/youglide`), feature by
feature against the fork. **Count: 19 ✅ present · 10 🟡 partial ·
6 ❌ missing · 3 ⏭️ out of scope** (Android TV layout, TV-code OAuth,
widgets — the first two by explicit user decision, 2026-11-21).

**Verdicts settled:** `#00AFAE` is README prose only (one occurrence
in the whole Android repo, `README.md:47`) — NOT a code token, so the
avatar stays brand-blue. The Android top bar has NO avatar (bell +
gear only); the fork's avatar chip is a desktop invention, kept
because the desktop top bar is where sign-in lives. Android HAS an
Account settings screen (`AccountScreen.kt`) — step 2's claim that it
has none was wrong. Android has NO local profiles (only
multi-Google-account switching); Flow's `ProfileMenuButton` /
Profiles tab are NOT YouGlideTube patterns. Sign-out asks for NO
confirmation on Android — the fork already matched.

**Gaps closed in this step:**
- **(a) Avatar display name.** Rust `api/innertube/account.rs`:
  `InnertubeClient::account_info()` POSTs `account/account_menu` as
  WEB_REMIX and parses `activeAccountHeaderRenderer` (Android's
  `YouTube.accountInfo()` shape) into `AccountInfo` (`auth/identity.rs`
  — pure parsing + `displayName` rule). Command `get_account_info`
  fetches it live and caches it to `google-account.json` (0600);
  `get_auth_status` also returns the cached identity. Frontend
  `useGoogleAccount` exposes `account`; the top bar shows the photo
  when present, else the first letter of the real display name
  (title = full name), "Y" only until the first fetch. Known
  deviation: signed-in calls still do not send `dataSyncId`
  (Android does) — source of the value not yet traced.
- **(b) Settings parity.** New `account` category, first in the
  Settings list: `AccountTab` mirrors `AccountScreen.kt` (status row,
  account entry with display name + handle/email, "Sign in with
  Google" / "Add account" / "Sign out" rows, notice text — all
  Android's verbatim strings, added to `strings.json`). Sign-out is
  immediate, no confirmation. "Add account" replaces the single
  stored session (multi-account switching stays a follow-up) and the
  tab says so. Sign-in dialog footer now uses Android's
  `account_body_signed_out` wording; its stale "no account settings
  tab" comment is corrected.
- **(c) Naming/labels.** Sidebar "You" → "Library" (Android's tab
  name); "Extensions" → "Integrations" (Android's settings page
  name); Flow-only "Sync" and "Support Flow" sidebar items removed
  (routes kept, unlinked, pending removal/replacement).
- **(d) Unreachable screens.** Checked: none — subscriptions,
  history, library, downloads, music, Shorts, playlists, albums,
  Watch Later, saved Shorts, liked, notes, local media, Explore,
  Recap, Import/Diagnostics/Discover channels are all already wired.
- **(e) Server history + Watch Later.** NOT done: the backend has no
  hooks for either (`FEhistory`, `edit_playlist`, server `WL` browse
  are all absent from `api/innertube/`). Building them here would be
  a new sync system, explicitly out of scope — recorded in
  `PARITY.md` as the follow-up.

**Verification (this step):**
- `cargo check` green (1 pre-existing upstream `dead_code` warning
  only).
- Rust auth tests: `cargo test -j 1 --lib auth::` = **21/21 passed**
  (14 step-2 tests + 4 new `identity` parse tests + 3 new session
  identity persist/restore/clear tests).
- Full backend suite: `cargo test -j 1 --lib --tests --no-fail-fast` =
  **74 binaries, 1,873 passed, 1 failed** (exit 101, ~22 min). The
  single failure is the known flaky
  `sync2_lan::a_dial_tries_lower_epochs_and_stops_after_four_attempts`
  (expected dial epochs `[5,4,3,2]`, got `[]` under load) — it **passed
  on clean isolated retry** (`cargo test -j 1 --test sync2_lan
  a_dial_tries_lower_epochs_and_stops_after_four_attempts`, 7.5 s, exit
  0), same as steps 1–2. Lib unittests alone: 1,280 passed, 0 failed,
  6 ignored (step 2: 1,273 — the +7 is the 4 new identity parse tests
  + 3 new session identity tests).
- Full frontend suite: `vitest run` = **459 files, 2,718 passed,
  0 failed, exit 0** (~6 min; step 2: 2,710 in 457 files — the
  increase is the new AccountTab + display-name/initial tests).
- `tsc` exit 0; `vite build` exit 0 (dist built in 7.2 s).
- Affected frontend tests: **16/16 passed** (`AccountTab` 4 new,
  `useGoogleAccount` 6 incl. 2 new display-name/initial tests,
  `GoogleSignInDialog` 2, `Topbar` 3, `settingsIndex` 1 — the index
  test now also covers the 3 new account rows).

**Not verified here (same sandbox limits as steps 1–2):** no real
Google login, no live `account_menu` fetch, no live feed — headless,
`google.com`/`youtube.com` hang. First login on the user's machine
decides whether the identity fetch returns a name/photo. How to test
on a real machine: sign in, check the top-bar avatar shows your
photo or initial (not "Y") and Settings → Google account shows your
name + handle; sign out from that tab and confirm the feed goes
anonymous with no confirmation dialog.

**Remaining gaps (owners: step 4 / follow-ups, see `PARITY.md`):**
server subscriptions feed (`FEsubscriptions`) + server
subscribe/unsubscribe; server history (`FEhistory`) merged with local
history; server Watch Later (`WL` browse + `edit_playlist`);
multi-account switching; clip downloads;
onboarding sign-in step; anonymous-search `SOCS=CAE=` cookie if a
live search ever comes back consent-walled; local-profiles
removal/reshape incl. data migration; remove unlinked `/sync` and
`/support` routes; updater re-point (step 4); `dataSyncId` on
signed-in calls.

Old step-3 checklist (kept for reference): verify Flow's InnerTube
vs YouGlideTube behaviour (home, search, player, Shorts, music,
subscriptions); fix divergences the CMP port already found (e.g.
anonymous search should send `Cookie: SOCS=CAE=` + bare `Origin`
like Android's `webSearch`, or a live search comes back
consent-walled). Rename the deep-link scheme `flow` →
`youglidetube` (touches `tauri.conf.json`, `flowHandoff.ts`, Rust
bridge) — deferred from step 1. `Design.md` (referenced by Flow's
`AGENTS.md`) does not exist in the `v0.1.0-beta4` tag; check upstream
`main` for it before UI work. Keep Flow's `AGENTS.md` rules in mind:
run `cargo` from `src-tauri/` (needs `.cargo/config.toml`'s
`reqwest_unstable` rustflag), use `pnpm` (not npm/yarn), never bump
versions in `package.json` / `tauri.conf.json` / `Cargo.toml` (they
must match; bumps are manual), never renumber
`src-tauri/migrations/`, never log auth material.

## Step 4 — Packaging / CI + real-machine verification ✅ DONE (2026-11-21)

### Updater — DISABLED until a release server exists (the step-4 decision)
- Flow's updater pointed at `https://github.com/Flow-Tube/Flow-Desktop/releases/latest/download/latest.json` with Flow's minisign pubkey. Shipping that would have pulled **Flow's** updates into YouGlideTube.
- `tauri-plugin-updater` 2.14.1 **ignores** the `active` config flag (no reference in its source; `tauri-utils` `UpdaterConfig.active` defaults false and nothing in tauri 2.12.5 core reads it) — so the whole `updater` section was **removed** from `src-tauri/tauri.conf.json`. No Flow endpoint or pubkey remains anywhere in the config.
- Backend: new `UpdateBlock::NotConfigured` in `src-tauri/src/update_support.rs`; `decide()`/`detect()` take `updater_configured: bool`. `lib.rs` computes it from the config map — `context.config().plugins.0.get("updater")` → `endpoints` array non-empty (note: `PluginConfig` is a tuple struct; there is no `.updater` field — the first draft used it and `cargo check` failed with E0609, fixed). The updater plugin is only registered `if update_support.supported`, so it is never registered now.
- Frontend: `"not-configured"` added to `UpdateBlockReason` (`src/lib/updateSupport.ts`); AboutTab already renders the blocked reason, so it now shows "In-app updates aren't set up yet" (new string `settings_updates_not_configured`). Tests: 2 new Rust tests + 2 vitest cases.
- **To enable updates for a real release** (user decision needed): (1) create the fork's GitHub repo (name NOT confirmed — placeholder `shivytyahoo/YouGlideTube-Desktop` is used in scripts/PKGBUILDs; search for it); (2) generate a fresh minisign keypair with `tauri signer generate` — **never commit the private key**; the current `src-tauri/updater-nightly.pub` is **Flow's nightly public key** and must be replaced when the user creates their own nightly keypair; (3) add a `plugins.updater` section to `tauri.conf.json` with `endpoints` pointing at the fork's releases and the new `pubkey`; (4) update `package.json` `repository`/`homepage` (still Flow-Tube — no fork repo exists yet); (5) update the `build.yml` repo gates (`github.repository == 'Flow-Tube/Flow-Desktop'`, kept deliberately so nightly publish jobs are safe no-ops in the fork); (6) update the AUR `-bin` sha256sums after the first fork release (they are still Flow's release checksums; CI recomputes them with `updpkgsums`).
- Local builds use `pnpm tauri:build:local` (`tauri build --config src-tauri/tauri.local.conf.json`, `createUpdaterArtifacts: false`) — no signing key needed.

### Cleanup — unlinked routes + Flow strings removed
- Deleted `/sync` and `/support` routes (`App.tsx` routes + imports; `src/pages/Sync.tsx`, `src/pages/Sync.test.ts`, `src/pages/Donations.tsx`, `src/components/donations/`, `src/lib/donationPrompt.ts`, `src/lib/supportLinks.ts`, `src/components/sync/linked/` + `transfer/` + `SyncParts/CameraScanner/SyncTaskView/PairingHelp`, `public/donations/` QR images, `SupportPlatformIcons`); AboutTab Contact + Support groups removed; PlayOnPopover "Manage linked devices" button removed (and its now-unused `onClose` prop). KEPT deliberately: sync backend (`src-tauri/src/sync/`, sync stores, `lib/api/sync.ts`, `lib/syncErrors.ts`, `lib/syncFirewall.ts`, `lib/linked/*`) and `HistorySettleController.tsx` — backend remains for a future YouGlideTube-appropriate sync surface. Local-profiles removal (follow-up C1) NOT attempted.
- Strings: 249 keys removed from `src/lib/i18n/strings.json` and 1,532 entries across 33 locale files (line-based deletion, `/tmp/clean-strings.mjs` — a JSON round-trip would have unescaped `\u00b0` etc.; diff is pure deletions, all files still parse). Keys still referenced by kept code were kept. `settings_updates_move_to_applications` reworded ("move Flow to…" → "move YouGlideTube to…").
- **Incident during this cleanup (recovered):** the first cleanup run used `git ls-files src/` to find key usages, which misses *untracked* files — steps 2–3's new files (`GoogleSignInDialog.tsx`, `AccountTab.tsx`, `useGoogleAccount.ts`) are uncommitted, so their `sign_in*`/`account_*` keys looked unused and were deleted; then `git checkout -- src/lib/i18n/` (run to reset a bad edit) also wiped the uncommitted step 1–3 string additions (`sign_in*`, `account_*`, `theme_description_youglidetube`). All 28 keys were **recovered verbatim from the step-3 vite build output** (`dist/assets/index-*.js` bundles `strings.json`; `sign_in`/`sign_out` English values from the dialog/Topbar tests, since the dist match for those two was an Arabic locale chunk) and re-inserted line-wise with `\uXXXX` escaping to match file convention. Lesson: **never `git checkout --` a file with uncommitted step work in it; and any usage scan must walk the filesystem, not `git ls-files`.**
- Bundle identity: `mainBinaryName` `flow-desktop` → `youglidetube` (stable) / `youglidetube-beta` (prerelease); prerelease product "YouGlideTube Beta", id `io.github.shivytyahoo.glidetube.desktop.beta`; macOS window title "YouGlideTube"; `linux/youglidetube.desktop`, firewall `youglidetube.xml`/`.ufw`; `botguard.rs` `/usr/bin/youglidetube-beta`; `player_js.rs` temp dir `youglidetube-player`. Deliberately NOT renamed: DB file `flow-desktop.sqlite` (data migration), `legacy_link_handler.rs` `flow-desktop-handler.desktop`, deep-link scheme `flow` (browser-extension compat — follow-up), Cargo package name `flow`, `tauri.flatpak.conf.json` identifier + `packaging/flatpak/io.github.flow_tube.Flow-Desktop.*` (flatpak follow-up), `package.json` repository/homepage (no fork repo yet).
- `release.yml`: asset prefix `Flow_` → `YouGlideTube_`, release titles, DMG checks, Linux-package check arg, AUR matrix `[youglidetube-desktop, youglidetube-desktop-bin]`, plus a guard step in the `sign` job that fails clearly when no updater pubkey is configured. `build.yml` (nightly): `Flow-Nightly_` → `YouGlideTube-Nightly_`, repo gates kept (see updater note). Scripts: `release-updater-manifest.mjs` / `nightly-updater-manifest.mjs` prefixes, `release-notes.mjs` (Flow support message removed, heading `# YouGlideTube`), `write-nightly-config.mjs` (no longer reads `plugins.updater`; repository required from `GITHUB_REPOSITORY`; "YouGlideTube Nightly"), `generate-notices.mjs` own-packages, `verify-updater-manifests.test.mjs` fixture URL — all with `shivytyahoo/YouGlideTube-Desktop` as the single greppable placeholder.
- AUR: dirs renamed to `youglidetube-desktop`, `-bin`, `-git`; all three PKGBUILDs + `.SRCINFO` files renamed (pkgname, maintainer `shivyt`, `_github_repo` placeholder, pkgdesc, binary loop `youglidetube`/`youglidetube-beta`, shared install-steps block byte-identical across all three — verified by script); README + `aur.yml` updated (shared marker, package names, archive prefix `YouGlideTube-Desktop-$tag`, desktop/binary checks). `.SRCINFO` correctness can only be fully confirmed by `makepkgs --printsrcinfo` in the aur.yml lint job (no Arch here).

### Build — Linux bundles (built in the sandbox, 2026-11-21)
- **Debug .deb: BUILT** — `src-tauri/target/debug/bundle/deb/YouGlideTube_0.1.0-beta4_amd64.deb`, **193 MB** (201,697,180 bytes), installed size 838,105 KB (~819 MB extracted). Verified: `Maintainer: shivyt` (Cargo.toml `authors` fixed this step — it was still `A-EDev`), binary `/usr/bin/youglidetube`, desktop `YouGlideTube.desktop` (`Exec=youglidetube %u`, `StartupWMClass=youglidetube`), icons, firewall files, sidecar scripts. No `distro-managed` marker in the .deb — correct per upstream design (only the AUR repackages add it; a .deb install is expected to self-update once an updater is configured — moot now, the updater is NotConfigured).
- **These are DEBUG sizes** (817 MB unoptimized binary with debuginfo). They say nothing about release size — see the release-build note below.
- **Release build: NOT feasible in this sandbox (OOM) — but the nightly profile IS, and it answers the size question.** `cargo build --release` (profile: `panic=abort`, `codegen-units=1`, `lto=true`) is OOM-killed compiling the `flow` lib (2 kills; dev-profile compile of the same lib peaks ~3.2 GB and succeeds, release codegen-units=1 pushes it over the 8 GB sandbox). Retry path that WORKED: the `nightly` profile (`lto=thin`, `codegen-units=16`) — `cargo build --profile nightly -j 1` finished in 55m 44s with no OOM (flow-lib rustc peaked ~3.4 GB RSS and survived). Optimized stripped binary: **55 MB** (vs 817 MB debug). Bundled via `tauri bundle --bundles deb` (binary copied to `target/release/youglidetube`, since the CLI has no `--profile` flag): **`YouGlideTube_0.1.0-beta4_amd64.deb` = 21.73 MiB (22,786,938 bytes), installed size 56,359 KB (~56 MB extracted)** — essentially Flow's release .deb (21.5 MB). `node scripts/report-bundle-sizes.mjs`: debug .deb 192.35 MiB, release .deb 21.73 MiB. The 14 MB Windows promise is still unverified here (Linux-only sandbox; Windows/macOS bundles come from CI), but on Linux the size story checks out: the Tauri pivot delivers the Flow-level size.
- **.rpm: BLOCKED on the version string (verified).** `tauri build --bundles rpm` fails: `invalid version "0.1.0-beta4": contains invalid character` — the string is inside the CLI binary itself (tauri-bundler 2.12.4's rpm validation, `rpm-rs` charset: no `-`). Flow's beta4 shipped an `.rpm` built with an older CLI that didn't validate. A stable `x.y.z` version builds fine; a prerelease needs either a CLI version that handles `-` or a version-sanitizing step in the release workflow. Same `-` rejection likely applies to AppImage (appimagetool rejects `-` in VERSION) — untested, the rpm step fails first.
- **Two sandbox build gotchas found this step:** (1) `/tmp` is a 512 MB tmpfs — the bundler stages there and dies with ENOSPC; set `TMPDIR=~/workspace/.cache/tmp` (on the big disk) for every `tauri build`. (2) A VM restart during the first release-build attempt wiped `/tmp` (build log + local config) and reverted libzstd1 to `+hatch1` + wiped the `-dev` packages — recovered by re-running `apt-get update`, `apt-get install --allow-downgrades libzstd1=1.5.5+dfsg2-2build1.1 libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf` (+ `rpm` for rpmbuild) and restarting the CONNECT shim; the release `target/` cache survived, so the resumed build went straight to the `flow` lib compile.
- `target/` is bloated: `target/debug/build/flow/` holds **165 stale build-script hash dirs** (~109 GB logical, mostly 650 MB test binaries each — btrfs+zstd compresses them, `df` still shows 113 GB free). `cargo clean` reclaims it but forces a full rebuild; leave it until the release question is settled.
- Local build command (this sandbox): `pnpm build`/`pnpm test` wrappers fail with `[EPERM] chown` on `node_modules/.pnpm`, so the Tauri build's `beforeBuildCommand` (`pnpm build`) fails too — run the CLI directly with an override config: `./node_modules/.bin/tauri build --config /tmp/tauri-local-build.conf.json` (sets `createUpdaterArtifacts: false` + `beforeBuildCommand` to `./node_modules/.bin/tsc && ./node_modules/.bin/vite build`). Release `cargo build` needs `CARGO_BUILD_JOBS=1` here (parallel rustc OOMs at 6 GB) and `CARGO_NET_OFFLINE=true` (all deps cached). `tauri bundle` (no `build`) bundles an already-built binary — the route for a nightly-profile .deb.
- Expected sizes (Flow's published numbers for reference): Windows setup.exe 14.4 MB, Linux `.deb` ~21 MB, AppImage ~173 MB. Measure ours with `dpkg-deb -I`, extracted size, and `node scripts/report-bundle-sizes.mjs`.

### Verification (this sandbox)
- `tsc` clean; `vite build` green (dist 6.9 MB); `vitest run`: 2,710 passed, 1 failed — the failure was a stale expectation in `scripts/release-updater-manifest.test.mjs:78` (still expected a `Flow_0.1.0-beta3…` error message after the rename); fixed to `YouGlideTube_…` and that file re-runs 7/7. Full re-run after the fix: **458 files, 2,711 tests, all passed, 0 failed**.
- `cargo check` green (1 pre-existing dead-code warning: `ACTIVATE_NOTIFICATION_EVENT` in `notification_service.rs`, untouched by this step).
- `cargo test -j 1 --lib --tests --no-fail-fast`: **1,875 passed, 1 failed** — the failure is the known flaky `sync2_lan::a_dial_tries_lower_epochs_and_stops_after_four_attempts` (timing-flaky on 1.5 CPUs; failed twice under load, **passed** when run alone). Nothing in step 4 touches sync. Step 3 had 1,873; +2 are the new `update_support` tests.
- All four workflows parse as YAML; `node scripts/verify-release-version.mjs` → `Release version verified: 0.1.0-beta4`.
- **Not verified here (same as steps 1–3):** nothing live — headless sandbox, youtube.com/google.com hang, no display. No real Google login, feed, playback, search, Shorts or sign-out has ever run. The release bundle below is built, not launched.

### Real-machine verification checklist
See README's "Real-machine checklist" — install from the artifact → launch → sign in with Google (watch for Google refusing the embedded webview) → home feed loads signed-in → avatar shows photo/real initial (not "Y") → Settings → Google account shows name + handle → search works → play a video (dash.js player) → Shorts → sign out (no confirmation, goes anonymous) → close/reopen keeps session. Each step: what to expect, what to report back if it fails.

### Remaining follow-ups (NOT step 4 — see PARITY.md)
Server subscriptions feed (`FEsubscriptions`) + subscribe/unsubscribe; server history (`FEhistory`) merged with local; server Watch Later (`WL` + `edit_playlist`); multi-account switching; clip downloads; onboarding sign-in step; anonymous-search `SOCS=CAE=` cookie if live search is ever consent-walled; local-profiles removal/reshape (C1) incl. data migration; `dataSyncId` on signed-in calls; deep-link scheme `flow` → `youglidetube` (needs browser-extension update too); flatpak id rename; updater re-point (done above — disabled until a repo + keypair exist). (TV-code OAuth and Android TV layout are out of scope by explicit user decision, 2026-11-21 — not follow-ups; WebView sign-in is the only sign-in path.)

## Sandbox limits (recorded 2026-11-21)

- Headless: no display, no system webview at runtime — the app itself can
  never be launched here. `cargo check` + frontend build + vitest are the
  verification ceiling in this sandbox.
- `youtube.com` / `google.com` hang from the sandbox egress proxy; no live
  feed/playback/login checks are possible here.
- `objects.githubusercontent.com` (GitHub release asset downloads) is
  blocked by the egress proxy; GitHub API + git clone work.
- `pnpm build` / `pnpm test` wrappers fail here with
  `[EPERM] chown .../node_modules/.pnpm/lock.yaml.*` (sandbox blocks
  `chown`). Run the binaries directly: `./node_modules/.bin/tsc`,
  `./node_modules/.bin/vite build`, `./node_modules/.bin/vitest run`.
- `libzstd1` was downgraded from the sandbox's `+hatch1` build to stock
  Ubuntu (see `FORK.md`); `apt-get check` is clean. **A VM restart
  reverts this** (back to `+hatch1`) **and wipes all apt-installed `-dev`
  packages** — after any restart, re-run `apt-get update`, re-downgrade
  `libzstd1`, and reinstall the Tauri `-dev` packages before any
  `cargo test` / `cargo tauri build` (linking fails without them;
  `cargo check` does not link, so it passes anyway). A stuck boot-time
  `apt-get update` may hold the apt lock — kill it before updating.
- `cargo test` at default parallelism OOM-kills in this 6 GB sandbox;
  always use `cargo test -j 1` here (slower, ~20 min first build).
  The `sync2_lan` timing test is flaky under load; retry a single
  failure before treating it as a regression.
