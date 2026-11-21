# Windows installer — how to get one

There is **no Windows installer built yet**, and this Linux server cannot build one
(Tauri NSIS bundling needs a Windows runner). Two ways to get it:

## Path A — GitHub Actions CI (recommended, no Windows machine needed)

1. Create the fork repo on GitHub (name is your choice; the workflow currently
   uses placeholder `shivytyahoo/YouGlideTube-Desktop` — update it in
   `.github/workflows/release.yml`, `package.json`, and `TAURI_PLAN.md` step 4
   once the repo exists).
2. Push this working tree to the repo (all changes are currently uncommitted;
   the repo has full Flow history at v0.1.0-beta4).
3. Push a tag, e.g. `v0.1.0-beta4` — `release.yml` builds on tags.
4. Download from the release: `YouGlideTube_0.1.0-beta4_windows_x64-setup.exe`
   (NSIS installer, built on `windows-2025`, target `x86_64-pc-windows-msvc`).
   ARM64 (`windows_arm64-setup.exe`) builds on `windows-11-arm`.
5. The updater is disabled until a repo + fresh `tauri signer generate` keypair
   exist (see `TAURI_PLAN.md` step 4) — the installer itself works without it.

## Path B — build on your own Windows machine

Prerequisites: Rust stable (rustup), Node 24, pnpm 11, Visual Studio 2022
C++ build tools (Desktop development with C++), WebView2 runtime
(Windows 10/11 usually has it; without it the installer downloads ~120 MB
at install time).

```powershell
git clone <your-fork-repo>
cd youglide-tauri
pnpm install
pnpm tauri build --bundles nsis
```

The installer lands at:
`src-tauri\target\release\bundle\nsis\YouGlideTube_0.1.0-beta4_x64-setup.exe`

Then run the real-machine checklist in `README.md`
(install → sign in → feed → avatar → search → play → Shorts → sign out → reopen)
and report back what works and what breaks.

## Known limits

- `.rpm` / AppImage cannot build on version `0.1.0-beta4` (Tauri CLI 2.12.4
  rejects `-` in the version); a stable `x.y.z` version fixes it.
- First real Google login / feed / playback has never run anywhere yet —
  this sandbox is headless and youtube.com hangs through its proxy.
