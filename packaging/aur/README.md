# AUR packages

Three Arch User Repository packages:

- `youglidetube-desktop-bin` repackages the release `.deb` (x86_64 and aarch64).
- `youglidetube-desktop` builds the tagged source with `pnpm tauri build --bundles deb`
  and installs that `.deb` the same way.
- `youglidetube-desktop-git` builds the latest `main` the same way. Its `pkgver()`
  turns `git describe` into e.g. `0.1.0beta3.r42.gabc1234`, which sorts after
  the `0.1.0beta3` release and before `0.1.0`.

`youglidetube-desktop` and `youglidetube-desktop-bin` follow every tagged release, betas
included, and the three conflict with each other. A release tag maps to a
pkgver without the dash: `v0.1.0-beta3` is `0.1.0beta3`, `v0.1.0` is `0.1.0`.
The PKGBUILDs here stay pinned to the last release; the release workflow sets
the new pkgver and checksums when it publishes. `youglidetube-desktop-git` is never
published from CI, and a change to its pkgver alone is not worth a commit.

All three install the binary as `/usr/bin/youglidetube` and point the desktop
file's `Exec` and `StartupWMClass` at it. The `.deb` names the binary
`youglidetube` (`youglidetube-beta` for prereleases). Each package adds an empty
`/usr/lib/<product>/distro-managed` marker so the in-app updater stays off.
`<product>` is `YouGlideTube Beta` for prerelease versions and `YouGlideTube` otherwise;
`youglidetube-desktop-git` reads the version from `package.json`.

The block between the `Shared youglidetube-desktop install steps` markers must stay
identical in every PKGBUILD, since AUR packages can't share files. The AUR
workflow checks this, and that each `.SRCINFO` matches its PKGBUILD.

The PKGBUILDs point at the fork's GitHub repo through `_github_repo`
(`shivytyahoo/YouGlideTube-Desktop` until the repo exists — see TAURI_PLAN.md step 4).
The `-bin` checksums are the last Flow release's until the first YouGlideTube
release is published; the release workflow recomputes them with `updpkgsums`.
