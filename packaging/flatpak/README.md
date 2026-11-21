# Flatpak

`io.github.shivytyahoo.glidetube.desktop.yml` builds YouGlideTube from
source on the GNOME 51 runtime. The same manifest is used for manual builds
and, later, for Flathub. Everything is built offline from
pre-generated sources, as Flathub requires.

## What is different in the Flatpak

- **App ID.** The Flatpak uses the same app ID as every other build,
  `io.github.shivytyahoo.glidetube.desktop`, so Flatpak lets the app own
  the D-Bus names under its own ID and the single-instance name is
  `<identifier>.SingleInstance`. The separate
  `src-tauri/tauri.flatpak.conf.json` only turns off updater artifacts,
  because Flathub ships the updates.
- **Own data folder.** The library, settings, logs and startup state live in
  `~/.var/app/io.github.shivytyahoo.glidetube.desktop/data/io.github.shivytyahoo.glidetube.desktop/`.
  A Flatpak install does not see the data of a `.deb`, `.rpm` or AppImage
  install, and the other way around.
- **Bundled Node.** The poToken and n-signature helpers need Node, which the
  sandbox does not have. The `node` module copies Node 24 from the SDK
  extension into `/app/node`, and `YOUGLIDETUBE_NODE`,
  `YOUGLIDETUBE_INTEGRITY_SCRIPT` and `YOUGLIDETUBE_NSIG_SCRIPT` point the
  app at it and at the helper scripts in `/app/lib/YouGlideTube/sidecar/`.
- **No Tauri CLI.** The manifest runs `cargo build` with the
  `tauri/custom-protocol` feature and the Flatpak config passed through
  `TAURI_CONFIG`, which is what the CLI does.
- **No updater artifacts.** Flathub ships the updates.
- **Runtime libraries.** WebKitGTK and GStreamer come from the GNOME runtime,
  so none of the AppImage library workarounds apply.

## Regenerate the offline sources

```sh
scripts/flatpak-sources.sh
```

It writes `packaging/flatpak/generated-sources/` (ignored by git):

- `cargo-sources.json` from `src-tauri/Cargo.lock` (flatpak-cargo-generator)
- `node-sources.json` from `pnpm-lock.yaml` (flatpak-node-generator, pnpm
  store v11 for pnpm 11)
- `pnpm-release.json`, the pnpm release named in `package.json`'s
  `packageManager`, which is not part of its own lockfile

Run it again after any change to `Cargo.lock`, `pnpm-lock.yaml` or
`packageManager`. It needs `python3` (3.10 or newer, with `venv`), `git` and
`curl`. CI runs it before every Flatpak build.

## Build and install locally

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
scripts/flatpak-sources.sh
flatpak-builder --user --install --install-deps-from=flathub --force-clean \
  flatpak_app packaging/flatpak/io.github.shivytyahoo.glidetube.desktop.yml
flatpak run io.github.shivytyahoo.glidetube.desktop
```

Run these from the repository root. To make a single-file bundle instead:

```sh
flatpak-builder --user --repo=repo --install-deps-from=flathub --force-clean \
  flatpak_app packaging/flatpak/io.github.shivytyahoo.glidetube.desktop.yml
flatpak build-bundle repo YouGlideTube.flatpak io.github.shivytyahoo.glidetube.desktop
```

Startup logging can be raised with
`flatpak run --env=RUST_LOG=debug io.github.shivytyahoo.glidetube.desktop`.

## Permissions

| Permission | Why |
| --- | --- |
| `--share=network`, `--share=ipc` | YouTube, the local streaming proxy and the browser extension bridge |
| `--socket=wayland`, `--socket=fallback-x11` | The window. X11 is only exposed when there is no Wayland |
| `--socket=pulseaudio` | Audio |
| `--device=dri` | GPU rendering and video decoding |
| `--talk-name=org.freedesktop.Notifications` | New-upload notifications |
| `--filesystem=xdg-videos/YouGlideTube:create`, `--filesystem=xdg-music/YouGlideTube:create` | Default download folders |
| `--filesystem=xdg-download` | Fallback download folder when Videos or Music is not set |
| `--talk-name=org.freedesktop.secrets` | Scrobbling sign-ins in the Secret Service keyring |
| `--talk-name=org.freedesktop.FileManager1` | Show in folder for downloads |
| `--talk-name=org.kde.StatusNotifierWatcher`, `--filesystem=xdg-run/tray-icon:create` | Playback controls in the system tray; the tray host reads the icon image from `$XDG_RUNTIME_DIR/tray-icon` |
| `--filesystem=xdg-run/discord-ipc-0`, `--filesystem=xdg-run/app/com.discordapp.Discord:create` | Discord Rich Presence with a native or a Flatpak Discord |

The tray also needs `libayatana-appindicator`, which the GNOME runtime does
not ship. `modules/` holds a copy of
[flathub/shared-modules](https://github.com/flathub/shared-modules)'
`libayatana-appindicator-gtk3.json` and `intltool-0.51.json` with their
patches, taken at commit `785a5394`, so the manifest builds without a git
submodule. Without the library YouGlideTube starts normally and leaves the tray off.

## Check in the bundle

These only show up in a real install:

- Picking a custom download folder (the dialog goes through the file chooser
  portal) and downloading into it.
- Playback, including H.264, and the poToken and n-signature log lines.
- `youglidetube://` links from the browser extension opening the app.
- Notifications, the tray controls, Discord Rich Presence, Show in folder,
  and a scrobbling sign-in that survives a restart (the keyring).

## Runtime support

GNOME 51 is supported until about September 2027. GNOME 52 drops
`webkit2gtk-4.1`, which Tauri 2 uses. If Tauri has not moved to WebKitGTK 6.0
by then, the fallback is building WebKitGTK as a module in this manifest, the
way `com.pot_app.pot` does on Flathub.

## Flathub

`io.github.shivytyahoo.glidetube.desktop.metainfo.xml` is the AppStream
listing the Flatpak installs.
