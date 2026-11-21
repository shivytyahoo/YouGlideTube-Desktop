# Fork notes — YouGlideTube Desktop

YouGlideTube Desktop is a **fork of Flow Desktop**, rebranded and rethemed for
[YouGlideTube](https://github.com/shivytyahoo/YouGlideTube) (Android, GPL-3.0).

## Upstream

- **Project:** Flow Desktop — https://github.com/Flow-Tube/Flow-Desktop
- **Authors:** A-EDev and contributors
- **Fork point:** tag `v0.1.0-beta4`, commit `106a0a2b`
  (`chore(release): bump version to 0.1.0-beta4 (#657)`), cloned 2026-11-21
  with full git history.
- **License:** GPL-3.0-only. Flow's `LICENSE` file is kept unchanged; this fork
  is also GPL-3.0, matching YouGlideTube. No relicensing — see `LICENSE`.

## Fork identity (step 1)

| Item | Upstream (Flow) | This fork |
|---|---|---|
| Product name | Flow | YouGlideTube |
| App identifier | `io.github.aedev.flow.desktop` | `io.github.shivytyahoo.glidetube.desktop` |
| Window title | Flow | YouGlideTube |
| npm package name | `Flow` | `youglidetube` |
| Default theme | Flow Default (YouTube red `#ff0000`) | YouGlideTube (`#1A1C1E` / `#1E5AA8` / `#E85D04` / `#FF3D68`) |
| Copyright line | Copyright © 2025-2026 A-EDev | Copyright © 2026 shivyt |

## What step 1 changed

- `src-tauri/tauri.conf.json` — productName, identifier, window title,
  short/long description, copyright. Version untouched (`0.1.0-beta4`).
- `package.json` — name, description, author. Version untouched.
- `README.md` — header replaced with YouGlideTube title + fork notice.
  The rest of the README (features, privacy, etc.) is still Flow's text and
  will be revised as the fork diverges.
- `src/lib/themes.ts` — new `youglidetube` theme seed (first in the list, so
  `DEFAULT_THEME` is YouGlideTube), exact Android tokens from
  `GlideTheme.kt`: dark canvas `#1A1C1E`, brand blue `#1E5AA8`, saffron
  `#E85D04`. Coral `#FF3D68` has no slot in `ThemeSeed`; it lives as
  `--color-youglide-coral` in `src/App.css`. Note: `#00AFAE` appears only in
  the Android README and is NOT a theme token.
- `src/lib/settings/schema.ts` + `src/lib/useTheme.ts` — theme defaults
  (`theme_id`, `theme_light_id`, `theme_dark_id` and the `?? "default"`
  fallbacks) now point at `youglidetube`.
- `src/lib/i18n/strings.json` — added `theme_description_youglidetube`.
  Only the English base string exists; other locales fall back to it
  (`getString` falls back to `strings.json`), which is how the locale test
  is designed (locale keys must be a subset of the base keys).
- `src/App.css` — `@theme` fallbacks: `--color-primary` `#FF0000` → `#1E5AA8`,
  `--color-error` `#F44336` → `#FFB4AB`; added `--color-youglide-saffron`,
  `--color-youglide-coral`, `--color-youglide-amber` and
  `--radius-youglide: 8px` (Android Dimensions.kt: 12px gaps = Tailwind
  `gap-3`, 8px corners). No layouts were redesigned in step 1.

## Deliberately NOT changed in step 1

- **Version numbers** (`package.json`, `tauri.conf.json`, `Cargo.toml`) —
  Flow's AGENTS.md forbids bumping them; `scripts/verify-release-version.mjs`
  requires all three to match. Version bumps are a step-4/manual decision.
- **Updater endpoints + pubkey** (`tauri.conf.json` → `plugins.updater`) —
  still point at Flow's GitHub releases with Flow's minisign key. Must be
  re-pointed (or the updater disabled) before any release — see
  `TAURI_PLAN.md` step 4.
- **Deep-link scheme `flow`** (`tauri.conf.json` + `flowHandoff.ts` +
  `legacy_link_handler.rs`) — renaming touches handoff code and the Rust
  bridge; deferred to step 3.
- **`repository` / `homepage` URLs in `package.json`** — still point at Flow
  upstream; there is no published fork repo yet. Update when the fork repo
  is published (step 4).
- **Flow's `AGENTS.md` house rules** — kept as-is. Note: the `Design.md` it
  references does **not** exist in the `v0.1.0-beta4` tag (it was added on
  upstream `main` later, or lives elsewhere); theme work in step 1 followed
  the existing `themes.ts`/`App.css` patterns instead.

## Sandbox build notes (2026-11-21)

- Toolchains installed in this sandbox: Rust stable 1.100.0 via rustup,
  pnpm 11.9.0 via `npm install -g`, Node 24.22.1 (preinstalled).
- `libzstd1` was downgraded from the sandbox's `1.5.5+dfsg2-2build1.1+hatch1`
  build to stock Ubuntu `1.5.5+dfsg2-2build1.1` — the `+hatch1` version
  broke `-dev` package installs (`libzstd-dev` requires the exact stock
  version), which blocked `libwebkit2gtk-4.1-dev`. Same SONAME/ABI;
  `apt-get check` is clean afterwards.
- `pnpm build` / `pnpm test` wrappers fail in this sandbox with
  `[EPERM] chown .../node_modules/.pnpm/lock.yaml.*` (the sandbox blocks
  `chown`). Workaround: run the binaries directly —
  `./node_modules/.bin/tsc`, `./node_modules/.bin/vite build`,
  `./node_modules/.bin/vitest run`. The wrapper failure is environmental,
  not a code problem.
- Run all `cargo` commands from inside `src-tauri/` — it needs
  `.cargo/config.toml`'s `reqwest_unstable` rustflag.
- `cargo test` at default parallelism OOM-kills in this 6 GB sandbox
  (one `flow_desktop_lib` rustc peaks ~3.2 GB RSS); use `-j 1`.
  After a VM restart the apt `-dev` packages are gone and the test
  link fails (`-lgtk-3`, `-lwebkit2gtk-4.1`, … not found) — reinstall
  them first; `cargo check` does not link and passes regardless.
