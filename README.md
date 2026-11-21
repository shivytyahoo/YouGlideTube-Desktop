# YouGlideTube Desktop

**A YouTube and YouTube Music desktop client with Google sign-in, native playback and local recommendations.**

> **Fork notice:** YouGlideTube Desktop is a fork of [Flow Desktop](https://github.com/Flow-Tube/Flow-Desktop) (v0.1.0-beta4, by A-EDev, GPL-3.0-only), rebranded and rethemed for [YouGlideTube](https://github.com/shivytyahoo/YouGlideTube) (GPL-3.0). Upstream Flow code remains under its original authors; see [FORK.md](FORK.md). This fork adds Google sign-in (SAPISID cookie session, like the YouGlideTube Android app) on top of Flow's local-first client.

> YouGlideTube Desktop is under active development. Features and storage formats may change before the first stable release.

---

## Features

- Native video playback with quality and codec selection, SABR/DASH/HLS support, chapters, subtitles, playback speed, queues, mini-player, and Picture-in-Picture.
- YouTube Music home, search, artists, albums, playlists, queue management, synchronized lyrics, repeat, shuffle, and equalizer controls.
- A dedicated Shorts feed with comments, descriptions, saved Shorts, looping, auto-next, and timed scrolling modes.
- Local subscriptions, playlists, Watch Later, likes, albums, video and music history, Continue Watching, and regional Explore feeds. (Server subscriptions, history and Watch Later from your Google account are still local-only — the follow-up is tracked in [PARITY.md](PARITY.md).)
- Channel pages with videos, Shorts, playlists, community posts, comments, and live chat support.
- SponsorBlock, DeArrow, Return YouTube Dislike, and Discord Rich Presence integrations.
- Imports from Flow backups, Google Takeout, NewPipe, LibreTube, FreeTube, and OPML.

### FlowNeuro

FlowNeuro is Flow's native local recommendation engine. It learns from watches, skips, likes, dislikes, searches, topic preferences, and creator affinity, and ranks content on your device without sending a recommendation profile to a Flow server.

The Control Center lets you inspect topic weights, time-based patterns, channel memory, learning activity, and blocked content. You can export, import, reset, or temporarily pause learning with Deep Flow mode.

## Google sign-in

Sign-in works like the YouGlideTube mobile app: click **Sign in** in the top bar and sign in on Google's own page, which opens in a window inside the app. Once you sign in, the session connects automatically — the window closes by itself and the home feed reloads signed-in. When signed in, the top bar shows your account photo (or the first letter of your display name, fetched from YouTube) and a logout button instead, and **Settings → Google account** shows the account page from the mobile app: status, account name and handle, Add account and Sign out. Your session stays on your device (stored as a cookie file in the app-data directory) and is only sent to YouTube.

If Google refuses sign-in in that window, the dialog's second option signs in with a cookie instead: sign in on youtube.com in your browser, copy the Cookie header (it must contain `SAPISID` + `LOGIN_INFO`), and paste it in.

> Not yet verified on a real machine: no Google login has run in this project so far — the sandbox has no display and cannot reach google.com. The first login on a real machine decides, including whether Google accepts sign-in from the embedded browser window. See `TAURI_PLAN.md` step 2 for the exact test steps.

## YouGlideTube parity

This fork aims to look, feel and behave like the [YouGlideTube Android app](https://github.com/shivytyahoo/YouGlideTube) — same settings, screens, features and naming. Flow contributes only the Tauri size/architecture, never its look, feel or feature set. [`PARITY.md`](PARITY.md) is the feature-by-feature audit against the Android app (19 features match, 10 partial, 7 missing): what matches today is the watch/search/Shorts/music/downloads surface plus Google sign-in with the real account name and a Settings → Google account page; the remaining gap is the server-account surface (subscriptions feed, server history, server Watch Later, multi-account, clip downloads).

---

## Privacy and security

- No Google account is required, and YouGlideTube Desktop contains no advertising or analytics SDK.
- History, settings, library data, and recommendation state are stored locally in SQLite.
- Tauri permissions are restricted to the main window and the OS, dialog, and external-link capabilities the app uses.
- A strict Content Security Policy blocks arbitrary scripts, frames, objects, and remote application code.
- Rust validates search terms, video IDs, channel IDs, browse IDs, and continuation tokens before network requests.
- Media is relayed through a tokenized loopback-only proxy instead of exposing a public local server.
- BotGuard and PO-token handling run through a native hidden WebView, with a packaged Node script retained only as a compatibility fallback.

YouGlideTube Desktop still contacts YouTube and optional services such as SponsorBlock, DeArrow, Return YouTube Dislike, and configured lyrics providers when their features are used.

---

## Downloads and supported systems

No YouGlideTube Desktop release is published yet — there is no GitHub
repo for the fork (see [TAURI_PLAN.md](TAURI_PLAN.md) step 4 for what
creating one entails). Until then, build the installer yourself
([Building installers](#building-installers)) or from CI on a fork.

- **Stable:** reviewed releases intended for normal use.
- **Beta / RC:** public GitHub prereleases for wider testing. These install as **YouGlideTube Beta** with isolated application data.
- **Nightly:** automatic snapshots from `main`. These install as **YouGlideTube Nightly**, use isolated data, and may be unstable.

| Platform | Supported versions | Architectures | Packages |
| --- | --- | --- | --- |
| Windows | Windows 10 22H2, Windows 11 | x64, ARM64 | NSIS installer |
| macOS | macOS 13 Ventura or later | Intel x64, Apple Silicon | DMG |
| Linux | Ubuntu 22.04+, Debian 12+, and comparable modern distributions | x64, ARM64 | AppImage, `.deb`, `.rpm` |

Linux builds require a compatible glibc, GTK 3, and WebKitGTK 4.1 environment. Legacy 32-bit systems are not supported. See [docs/LINUX.md](docs/LINUX.md) for which package to pick, graphics problems, codecs, sync and moving from Beta to Stable.

### In-app updates

In-app updates are **not set up yet**: the app has no update server
configured, so Settings → About says so instead of offering a check.
See [TAURI_PLAN.md](TAURI_PLAN.md) step 4 for what a real release needs
(a fork repo, a fresh update-signing keypair, and updater endpoints).

## Building installers

Requirements: Node.js 22.12+, pnpm 11.9+, stable Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev          # run the app from source
```

Build packages for the current operating system (no update signing needed):

```sh
pnpm tauri:build:local  # tauri build with updater artifacts off
```

Artifacts land in `src-tauri/target/release/bundle/`:

| Platform | Artifacts |
| --- | --- |
| Windows | `nsis/YouGlideTube_<version>_x64-setup.exe` (and `arm64`) |
| macOS | `dmg/YouGlideTube_<version>_x64.dmg` (and `aarch64`) |
| Linux | `deb/YouGlideTube_<version>_linux_<arch>.deb`, `rpm/…rpm`, `appimage/YouGlideTube_<version>_linux_<arch>.AppImage` |

A full release build (with updater artifacts and signing) is what the
GitHub Actions release workflow (`.github/workflows/release.yml`) does:
it builds Windows, macOS and Linux packages per architecture, signs the
updater artifacts, and publishes them to GitHub Releases. It needs a
configured updater (endpoints + public key) and a signing key — neither
exists yet for this fork (see [TAURI_PLAN.md](TAURI_PLAN.md) step 4).
Nightly builds come from `.github/workflows/build.yml`; AUR packages
live in `packaging/aur/` and are published by `.github/workflows/aur.yml`.

Expected sizes (measured on Linux in the sandbox: optimized
**`.deb` 21.73 MiB, installed ~56 MB** — the nightly-profile build,
essentially Flow's release `.deb` at 21.5 MB. The debug `.deb` is
193 MB / ~819 MB installed, because the binary is unoptimized with
debuginfo; a full release-profile build OOMs in this sandbox, see
[TAURI_PLAN.md](TAURI_PLAN.md) step 4. Windows/macOS sizes are
unverified here — they come from CI.)

## Real-machine checklist

Nothing below has ever run on a real machine — the sandbox this was
built in is headless and cannot reach youtube.com or google.com. Run
these steps in order on a real machine with the installer from
[Building installers](#building-installers), and report back anything
that fails, with what you saw instead.

1. **Install** — Install the package for your OS (Windows: run the
   `.exe`; macOS: drag the app to Applications, then clear the quarantine
   flag, see below; Linux: `sudo apt install ./YouGlideTube_*.deb` or run
   the AppImage). Expect: the app installs without errors. If Windows has
   no WebView2, the installer downloads ~120 MB of runtime first.
2. **Launch** — Open the app. Expect: the home feed loads anonymously
   (generic recommendations, no sign-in needed). If the window is blank
   or white on Linux, see "Linux startup crashes and blank windows"
   below — that is a known WebKitGTK graphics issue, not a sign-in
   problem.
3. **Sign in with Google** — Click **Sign in** in the top bar and sign
   in on Google's own page, which opens in a window inside the app.
   Expect: the window closes by itself and the home feed reloads
   signed-in. **Watch for Google refusing the sign-in inside the app
   window** — Google sometimes blocks logins from embedded browsers. If
   it refuses, use Option 2 in the dialog: sign in on youtube.com in
   your browser, copy the Cookie header (`SAPISID` + `LOGIN_INFO`), and
   paste it in. Report back either way — whether Google accepted the
   in-app window matters for the next steps.
4. **Home feed (signed-in)** — Expect: the feed shows recommendations
   picked for your account, not the anonymous feed. If it looks identical
   to the anonymous feed, say so — the signed-in session may not be
   reaching YouTube.
5. **Avatar** — Expect: the top bar shows your account photo, or the
   first letter of your display name (not a generic "Y"). If it shows
   "Y", the account-name fetch failed — report it.
6. **Settings → Google account** — Expect: the page shows your name,
   your channel handle (or email), "Signed in", and Add account / Sign
   out rows. If the name or handle is missing or wrong, report it.
7. **Search** — Search for a video from the top bar. Expect: server
   results in YouTube's order (videos, channels, playlists). If search
   returns nothing or only local matches, report it.
8. **Play a video** — Click a video. Expect: it plays (dash.js player)
   with quality selection, and Up Next preloads. If playback spins
   forever or errors, report the video and the error shown.
9. **Shorts** — Open Shorts from the sidebar. Expect: a vertical feed
   you can move through with Up/Down (or the chevrons). Report if reels
   don't load or don't play.
10. **Sign out** — Sign out from Settings → Google account (or the
    top-bar logout button). Expect: **no confirmation** — it signs out
    immediately and the feed goes anonymous again.
11. **Close and reopen** — Quit the app completely and open it again.
    Expect: if you were signed in, you are still signed in (the session
    is stored on your device). If you signed out, you stay signed out.

### Opening YouGlideTube on macOS

YouGlideTube isn't signed with an Apple Developer ID or notarized yet, so the first launch is blocked with a message such as "Apple could not verify YouGlideTube is free of malware" or "YouGlideTube is damaged and can't be opened". To open it:

1. Open the DMG and drag YouGlideTube into your Applications folder. YouGlideTube can only update itself from there.
2. In Terminal, remove the download mark macOS puts on the app:

   ```sh
   xattr -dr com.apple.quarantine /Applications/YouGlideTube.app
   ```

   For a Beta or Nightly build, use `"/Applications/YouGlideTube Beta.app"` or `"/Applications/YouGlideTube Nightly.app"`, with the quotes.
3. Open YouGlideTube as usual.

Without Terminal: try to open YouGlideTube once, then go to **System Settings > Privacy & Security**, scroll down to the message about YouGlideTube and click **Open Anyway**. Updates YouGlideTube installs itself don't need this again.

### Flatpak

Flatpak packaging is not set up for this fork yet (upstream Flow's
Flatpak id and registry still point at Flow). That is a follow-up —
see [TAURI_PLAN.md](TAURI_PLAN.md).

### Linux media codecs

On Linux, video decoding goes through WebKitGTK and the system GStreamer plugins (Windows and macOS ship their own decoders). If audio plays but video stays frozen on a spinner, a video decoder is missing.

- **AppImage** — bundles the required GStreamer codec plugins (including `gst-libav` for H.264); no system codec packages are needed.
- **`.deb`** — declares the codec plugins as dependencies. Install with `sudo apt install ./YouGlideTube_*.deb` so they are pulled in automatically.
- **`.rpm`** — the freely licensed plugins are hard dependencies. On Fedora, a full H.264 decoder is only available through [RPM Fusion](https://rpmfusion.org/Configuration) for patent reasons (Fedora's own OpenH264 can't decode most YouTube video): enable RPM Fusion and run `sudo dnf swap ffmpeg-free ffmpeg --allowerasing` and `sudo dnf install gstreamer1-plugin-libav`, or use the AppImage instead. Without it, YouGlideTube plays VP9, which Fedora always has.

### Linux startup crashes and blank windows

If the app opens to a blank or white window, that is usually the WebKitGTK DMABUF renderer failing on your graphics stack (common with NVIDIA proprietary drivers and some Wayland sessions). YouGlideTube disables it automatically and, if a launch still fails to render, **escalates GPU workarounds on the next launch on its own**: first forcing software compositing (`WEBKIT_DISABLE_COMPOSITING_MODE=1`), then falling back to X11/XWayland (`GDK_BACKEND=x11`). A clean launch resets this. You can still override any of these yourself — for example `WEBKIT_DISABLE_DMABUF_RENDERER=0` to re-enable the DMABUF renderer.

If the app aborts on startup with `Could not create default EGL display: EGL_BAD_PARAMETER` (seen on some Arch-family / Mesa systems with the **AppImage**), that is a known Tauri AppImage packaging issue: a bundled `libwayland` client library conflicts with your system's newer Mesa/EGL stack. As an interim workaround, delete the bundled Wayland libraries and run the extracted app:

```sh
./YouGlideTube_*_linux_amd64.AppImage --appimage-extract
rm squashfs-root/usr/lib/*wayland*so*
./squashfs-root/AppRun
```

The `.deb`, `.rpm` and the Flatpak use the system's or the runtime's own libraries and avoid this class of issue; prefer those when the AppImage fails.

---

## Development

Requirements: Node.js 22.12+, pnpm 11.9+, stable Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

Build packages for the current operating system:

```sh
pnpm test
pnpm build
pnpm tauri:build:local
```

`pnpm tauri:build:local` builds the installer without updater artifacts
(no signing key needed). The full release build (`pnpm tauri build`,
used by CI) also needs the updater signing key — see
[Building installers](#building-installers).

Windows, Linux, and macOS packages are built natively by the GitHub Actions release workflow. Production macOS and Windows releases should be signed and, on macOS, notarized before publication.

---

## License

YouGlideTube Desktop is free software licensed under the [GNU General Public License v3.0](LICENSE). It is a fork of Flow Desktop (GPL-3.0-only, copyright © 2025–2026 A-EDev); see [FORK.md](FORK.md).

This license requires that any project using this source code, including the FlowNeuro engine, must also be released as open source under GPLv3. It may not be used in a proprietary or closed-source application.
