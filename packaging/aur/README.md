# AUR packages

Three Arch User Repository packages:

- `youglidetube-desktop-bin` repackages the release `.deb` (x86_64 and aarch64).
- `youglidetube-desktop` builds the tagged source with `pnpm tauri build --bundles deb`
  and installs that `.deb` the same way.
- `youglidetube-desktop-git` builds the latest `main` the same way. Its `pkgver()`
  turns `git describe` into e.g. `1.0.0.r42.gabc1234`, which sorts after
  the `1.0.0` release.

`youglidetube-desktop` and `youglidetube-desktop-bin` follow every tagged release, betas
included, and the three conflict with each other. A release tag maps to a
pkgver without the dash: `v1.0.0-beta1` is `1.0.0beta1`, `v1.0.0` is `1.0.0`.
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

The PKGBUILDs point at the project's GitHub repo through `_github_repo`
(`shivytyahoo/YouGlideTube-Desktop`).
The `-bin` checksums are from the last release; the release workflow recomputes them with `updpkgsums`.
