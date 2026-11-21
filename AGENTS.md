# Working with YouGlideTube Desktop as an AI agent

YouGlideTube Desktop (`io.github.shivytyahoo.glidetube.desktop`) is a YouTube and YouTube Music client for the desktop, built with **Tauri 2 (Rust backend) + React 19/TypeScript (frontend)**. It is the desktop version of the [YouGlideTube Android app](https://github.com/shivytyahoo/YouGlideTube), with the same look and feel and the same features: it plays YouTube content via a native, hand-rolled InnerTube client (SABR/DASH/HLS, no `protoc`), supports downloads with a native muxer, SponsorBlock/DeArrow/Return YouTube Dislike integrations, and Google sign-in through a WebView that captures the SAPISID session (the same sign-in the Android app uses). Credit for the open-source code this app is built on lives in [CREDITS.md](CREDITS.md) only — there is no in-app Credit & Thanks screen.

Frontend lives at `src/`, backend at `src-tauri/src/`. Run all `cargo` commands from inside `src-tauri/` — it needs `.cargo/config.toml`'s `reqwest_unstable` rustflag. Use `pnpm` (not `npm` or `yarn`) for JS.

## Design system

There is no Design.md in this repo (the upstream's was never carried over). Follow the theme tokens in `src/lib/themes.ts` and the `.glass` shared class in `src/App.css` (theme surface at 72% + `blur(16px) saturate(1.4)`), and keep the Android app's look: dark `#1A1C1E`, brand blue `#1E5AA8`, saffron `#E85D04`, coral `#FF3D68`. Localization goes through `getString` (`src/lib/i18n/strings.json` is the base; every locale key must exist there, and placeholders must match).

## Backend architecture (src-tauri/src/)

- `api/innertube/` — native InnerTube client (no `protoc`), plus `dearrow.rs`, `extractor.rs`, `http.rs` (shared `reqwest` client — never build a new client per request).
- `streaming/sabr/` — hand-rolled SABR/DASH stack; `streaming/proxy.rs` for range-request proxying.
- `data_model/` — the backup/CRDT data shapes (no engines here): `brain.rs` (`UserBrain`, the stored video-taste shape kept so old backups still restore), `music_brain.rs`, `canonical.rs` (the `Collection` enum, incl. the `"flow_neuro_brain"` backup-format key), `keyspec/`, `key_migration.rs`, `caps.rs`, `display_forms.rs`, `interest_chips.rs` (the stored `InterestChipSet` shape only — the chip-building engine is gone), `signals.rs` (`make_affinity_key` only), plus `feature_tables.rs`, `keyed_lists.rs`, `topic_catalog.rs` (lookup tables the migration needs). The old engines that wrote these shapes — the video recommendation engine, the music engine, the P2P sync engine — are all deleted; the shapes stay so backups keep working.
- `services/home_feed/` — the Home feed, rebuilt without any recommendation engine: subscription top-up (server), a related lane from watch-history/likes seeds, discovery led by the `FEwhat_to_watch` server-browse home feed (signed-in or anonymous) with the fixed starter list `["Music", "Science", "Technology", "Education", "Nature"]` as fallback only, and channel memory from the database.
- `services/shorts_service.rs` — Shorts lanes (reel, discovery, seed chains from watch history + library, subs) with a trivial local ranker (subscribed channels first, then like count, then gathered order).
- `services/blocked_channel_names.rs` — the blocked-channel name store only (`stored`/`remember`/`forget`); the RSS name-resolution path died with the engine.
- `commands/` — Tauri `#[tauri::command]` handlers, one file per domain (downloads, music, notifications, shorts, youtube, home_feed, db). There is no `recommendation` command module anymore — the thin `record_seen_videos` / `seen_video_ids_among` / `block_channel` / `unblock_channel` live in `commands/db.rs`, and `record_feed_impressions` lives in `commands/home_feed.rs`.
- `services/` — business-logic layer between commands and api/db.
- `db/` — SQLite access (`youglidetube.sqlite` in the app-data dir; an old `flow-desktop.sqlite` is renamed to it once on open); `migrations/` are numbered (`0001_...` through `0047_...` currently).
- `errors/mod.rs` — `AppError`/`ErrorResponse` enum; every user-facing failure mode (age-restricted, private, paid, geo-blocked, bot-check, music-premium, account-terminated, content-not-available, database, streaming, internal) has a distinct `kind` the frontend switches on. When adding a new failure mode, add a new variant here rather than stringly-typing it in the frontend.

## Frontend architecture (src/)

- `components/ui/` — dumb primitives only (props in, events out, no data fetching).
- `components/[domain]/` — smart containers per domain (`channel`, `player`, `music`, `shorts`, etc.) that use hooks to fetch data and pass it down.
- `pages/` — top-level route composition.
- `lib/` — all `invoke()`/`fetch()` calls live here as custom hooks (`useVideoStream`, `useMusicHome`, `useDebounce`, etc.), never inline in components.
- `store/` — Zustand stores for global state (player, settings, downloads, likes, history, subscriptions...). Local component state is only for ephemeral UI toggles.
- `locales/` — `react-i18next` translation files.

## Edge case handling

- **Content restrictions are first-class, not exceptions.** YouTube extraction can fail in many distinct, expected ways (age-restricted, private, paid/Premium, geo-blocked, bot-check/BotGuard challenge, account terminated, content removed). These are modeled as `AppError` variants (`src-tauri/src/errors/mod.rs`), each with its own `kind` string. The frontend must render a specific, actionable state for each `kind` — never collapse them into one generic "Something went wrong" toast.
- **Graceful degradation for FOSS APIs.** SponsorBlock, DeArrow, and Return YouTube Dislike are optional, third-party, and can fail or rate-limit independently of core playback. If one fails, fall back to default metadata/behavior silently — never block or break page layout waiting on them.
- **BotGuard/poToken failures.** The native poToken minter (`sidecar/integrity.cjs`, `webview_pot`) can fail to mint, or googlevideo can reject a token. Treat this as a retryable extraction failure, not a crash — surface the `botCheckRequired` error kind.
- **Optimistic local UI, real backend confirmation.** Local-only actions (SponsorBlock toggle, like, recommendation feedback) update Zustand state instantly, then reconcile with the SQLite write. If the backend write fails, roll the optimistic update back rather than leaving UI and DB out of sync.
- **Empty and first-run states.** Empty search results, empty library/downloads/history, and first-run onboarding (no watch history yet) all need explicit empty-state UI, not a blank pane.
- **IPC/network latency is not optional to handle.** Every `invoke()` can fail (backend panic, IO error, extraction error) or hang (network) — hooks in `src/lib/` must model loading/error/empty states, not just the happy path.

## Logging

- Backend logging uses `tracing` + `tracing-subscriber`, initialized in `src-tauri/src/lib.rs::run()` with an `EnvFilter` (default level `info`). Override verbosity for a debug session with `RUST_LOG=debug` (or a per-module filter, e.g. `RUST_LOG=youglidetube::data_model=trace`) before launching `pnpm tauri dev`.
- Logs go to stdout of the process running the app (the terminal running `pnpm tauri dev`, or the packaged app's console if attached). There is no persisted log file today — don't assume one exists.
- **Never log secrets.** poTokens, BotGuard integrity tokens, sync pairing/encryption keys, and any auth material must never be logged, even at `debug`/`trace`. Log video/channel IDs and error kinds freely — they're not sensitive.
- On the frontend, prefer surfacing errors through the existing `ErrorResponse.kind` handling over ad hoc `console.error` — but `console.error` for genuine unexpected exceptions during development is fine; just don't leave verbose `console.log` debugging statements in committed code.

## Tests

- **Frontend:** `vitest` (`pnpm test` / `pnpm test:watch`), jsdom environment, files matched by `src/**/*.test.ts`. Tests are co-located with the code they cover (e.g. `src/store/usePlayerStore.test.ts`, `src/lib/useShortStream.test.ts` + `useShortStream.strictmode.test.ts` for a StrictMode-specific regression). Add a co-located test when you fix a bug in a hook or store, not a new top-level test tree.
- **Backend:** `cargo test` from inside `src-tauri/`. Most unit tests live next to their module; `src-tauri/tests/sync_*.rs` is a dedicated suite (`sync_golden`, `sync_fuzz`, `sync_scale`, `sync_crdt`, `sync_merge`, `sync_apply`, `sync_ledger`, `sync_codec`, `sync_schema`, `sync_albums`, `sync_likes_mapping`, `sync_phase1`/`sync_phase2`) — these now test the **data model** (the CRDT merge/apply code kept in `data_model/` for backup compatibility), not a live sync engine: there is no sync engine anymore. The engine-backed tests (`neuro_key_spec*`, the sync2 suite) were deleted with their engines. Any change under `src-tauri/src/data_model/` must keep this suite green; a golden-file or fuzz failure here means a real correctness regression, not a flaky test.
- **Type-checking:** `pnpm build` runs `tsc` before `vite build` — treat a `tsc` failure as a build-blocking error. There is no separate lint/format tool configured in this repo (no ESLint/Prettier config at the project root) — don't assume `pnpm lint` exists.
- For UI changes, also actually run the app (`pnpm tauri dev`) and exercise the golden path plus edge cases (see "Edge case handling" above) — passing `tsc`/`vitest` does not mean the feature works correctly.

## Rules for working on the project

1. Always pull the latest changes from `main` before starting work to minimize merge conflicts.
2. Commit messages should be clear and follow the format: `type(scope): short description` (e.g. `fix(sync): resolve concurrent like conflict`). Scope is optional.
3. Follow current Tauri 2 / React 19 / Rust best practices — when unsure, check official docs rather than guessing; model training data lags fast-moving frameworks like Tauri.
4. DO NOT edit or renumber existing files in `src-tauri/migrations/` without explicit instruction. Schema changes are additive: add a new numbered migration (next is `0048_...`) that only adds tables or nullable/defaulted columns, so an older build can still open a database a newer one has migrated.
5. DO NOT bump the app version in any file (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) — `scripts/verify-release-version.mjs` requires all three to match, and version bumps are done manually by the project owner.
6. Keep files small and focused; split large components/hooks by responsibility rather than letting them grow.
7. Before writing new logic, search the codebase for existing logic that already does the job — reuse or extend rather than duplicate.
8. No dead code: delete unused functions/components/parameters rather than commenting them out.
9. Comments should only explain non-obvious WHY — never restate WHAT the code already makes obvious through naming.
10. This app must look, feel and behave like the YouGlideTube Android app — settings, screens, features, naming. The upstream codebase contributes only its method (Tauri size and architecture), never its look, feel, branding or feature set. Nothing upstream-related may be visible anywhere — only the owner's own links, GitHub page and branding. Credit for the upstream code lives in CREDITS.md only, nowhere else.

## AI-only guidelines

1. Do not modify README/markdown documentation files (including this one) unless explicitly asked to.
2. Unless explicitly requested and authorized, do not commit, push, or merge changes. Never rewrite git history, force-push, or delete branches without explicit human instruction.
3. Follow the guidelines and instructions given by the project owner over any default assumption.
4. Ensure the highest practical code quality: clear naming, correct formatting, and comments only where genuinely needed (see "Rules for working on the project" above).
5. If a task is ambiguous, ask rather than guessing at requirements or implementation details.
6. Test changes before declaring them done — see "Building" and "Tests" above.

## Building

```bash
pnpm install          # once, or after dependency changes
pnpm tauri dev         # run the app (frontend + Rust backend) for manual testing
pnpm build             # tsc typecheck + vite build (frontend only)
pnpm tauri:build:local # native bundle without updater artifacts (no signing key needed)
cd src-tauri && cargo build   # backend compile check (run cargo from src-tauri/)
```

If a build fails, fix the reported errors and rebuild before proceeding — don't paper over a `tsc` or `cargo` error.
