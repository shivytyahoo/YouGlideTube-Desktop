# Windows installer — how to get one

There is **no Windows installer built yet**, and this Linux server cannot build one
(Tauri NSIS bundling needs a Windows runner). The repo is
`shivytyahoo/YouGlideTube-Desktop` (already created and pushed; it currently has
no releases — the first release is made from the v1.0.0 build). Two ways to get it:

## Path A — GitHub Actions CI (recommended, no Windows machine needed)

1. Push this working tree to the repo (all changes are currently uncommitted;
   push with the git-database API flow — plain `git push` does not work with
   the stored token).
2. Push a tag, e.g. `v1.0.0` — `release.yml` builds on tags.
3. Download from the release: `YouGlideTube_1.0.0_windows_x64-setup.exe`
   (NSIS installer, built on `windows-2025`, target `x86_64-pc-windows-msvc`).
   ARM64 (`windows_arm64-setup.exe`) builds on `windows-11-arm`.
4. The updater is disabled until a published release exists (the repo and the
   signing keypair already exist — see `TAURI_PLAN.md` step 4) — the installer
   itself works without it.

**CI minutes:** the repo is private, so Actions runs on the free 2,000
minutes/month, which are already used up; the spending limit is $0, so new
jobs will not start until the repo is made public or the billing limit is
raised. Fix that before expecting a release build.

## Path B — build on your own Windows machine

Prerequisites: Rust stable (rustup), Node 24, pnpm 11, Visual Studio 2022
C++ build tools (Desktop development with C++), WebView2 runtime
(Windows 10/11 usually has it; without it the installer downloads ~120 MB
at install time).

```powershell
git clone https://github.com/shivytyahoo/YouGlideTube-Desktop
cd youglide-tauri
pnpm install
pnpm tauri build --bundles nsis
```

The installer lands at:
`src-tauri\target\release\bundle\nsis\YouGlideTube_1.0.0_x64-setup.exe`

Then run the real-machine checklist in `README.md`
(install → sign in → feed → avatar → search → play → Shorts → sign out → reopen)
and report back what works and what breaks.

## Known limits

- First real Google login / feed / playback has never run anywhere yet —
  this sandbox is headless and youtube.com hangs through its proxy.
