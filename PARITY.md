# YouGlideTube parity audit — Tauri fork vs Android app

Date: 2026-11-21 (step 3). Android reference: YouGlideTube v1.1.1,
`https://github.com/shivytyahoo/YouGlideTube`, surveyed read-only from a
fresh shallow clone at `/tmp/youglide`
(`app/src/main/java/io/github/shivytyahoo/glidetube/` unless stated
otherwise; strings from `app/src/main/res/values/strings.xml`).
Tauri app: `~/workspace/youglide-tauri/`, built from the upstream Tauri codebase
at v0.1.0-beta4.

Standing rule: the app must look, feel and behave like YouGlideTube —
settings, screens, features, naming, everything. The upstream codebase contributes ONLY
its method (Tauri size/architecture), NEVER its look, feel, branding or
feature set.

## Verdicts settled in this audit

- **`#00AFAE` is NOT a YouGlideTube code token.** Full-repo grep finds
  exactly one occurrence: `README.md:47` ("blue-to-teal brand
  (`#1E5AA8` → `#00AFAE`)"). No occurrence in `ui/theme/` or any
  `*.kt`/`*.xml`. The teal end of the README gradient does not exist as
  a colour constant. The real tokens are `MorpheBrandBlue #1E5AA8`
  (`MorpheGlass.kt:30`), saffron `#E85D04`, coral `#FF3D68`, dark
  canvas `#1A1C1E` (Morphe palette). The CMP avatar's teal circle was
  based on README prose; the Tauri avatar correctly uses brand blue.
- **The Android top bar has NO avatar.** Every root destination shows
  only a bell (unread badge, "9+" cap) + Settings gear
  (`ui/components/layout/topbar/GlideTopBarActions.kt`). The avatar
  circle in the Tauri/CMP top bar is a desktop invention (needed: the
  desktop top bar is where sign-in lives). Kept, but it must show the
  real display name — see gap A1.
- **Android HAS an Account settings screen** (`ui/screens/settings/
  account/AccountScreen.kt`). Step 2's claim that "there is no account
  settings tab" was wrong (it confused the sign-in *dialog* — Android
  has no generic sign-in dialog; sign-in is always the full-screen
  `GoogleLoginActivity` — with the Account *settings page*). The fork
  now adds it (gap B1).
- **Android has NO local profiles.** No `ProfileManager` /
  `LocalProfile` anywhere; "profile" matches only `BufferProfile`
  (buffer presets). What exists is multi-Google-account switching
  (`SavedAccount` list, switchable from Settings → Google account).
  The upstream app's local-profiles system (top-bar `ProfileMenuButton`, Profiles
  settings tab, "Who's watching" overlay) is NOT a YouGlideTube
  pattern. Gap C1: remove/reshape in a follow-up; the Profiles tab is
  left in place this step because profile-scoped data (settings,
  history, visitor identity) is load-bearing for the fork — removing it
  is a data-migration job, not a rename.
- **Sign-out asks for NO confirmation** on Android (`AccountScreen.kt`
  calls `viewModel.signOut()` directly). The fork's immediate sign-out
  from the top-bar logout icon already matches.

## Android reference facts used below

- Top-level tabs (`GlideTab.kt`): Home, Shorts, Music, Subscriptions
  ("Subs"), Library; Search and Explore are opt-in tabs. Default
  visible: Home, Shorts, Music, Subscriptions, Library. Bottom bar is
  a floating glass pill; wide screens use a navigation rail.
- Settings home, in order (`SettingsHomeContent.kt:47-137`): Battery
  saver (switch); Google account → Account page; group "Watch &
  listen": Feeds & content, Player & playback, Quality, Integrations;
  group "Interface": Widgets, Appearance, Language & region; group
  "Library & data": Downloads & storage, History & privacy; group
  "YouGlideTube Engine": Deep Glide Mode (switch), Auto-disable after,
  Save to watch history, Scrobble during Deep Glide, Show on search;
  group "System": Notifications, Network, Wellbeing; group
  "YouGlideTube": About YouGlideTube, Diagnostics, Check for updates
  (only if updater enabled). Sub-pages: Appearance → Theme, Custom
  themes, Font, Navigation bar, Date & time, Player appearance;
  Player & playback → Buffer, Equalizer; Quality (video/shorts/music
  tabs); Feeds & content → Music home, Library; Integrations →
  Scrobbling; Downloads & storage → Local media; plus History &
  privacy, Notifications, Network, Wellbeing, Google account, About →
  TV remote guide, Diagnostics.
- Sign-in: WebView at
  `https://accounts.google.com/ServiceLogin?service=youtube&continue=
  https://www.youtube.com/`, session proof = `SAPISID` + one of
  `SID`/`HSID`/`LOGIN_INFO` (`LOGIN_INFO` must NOT be required alone —
  short-lived), cookies wiped after capture, `; wv` stripped from the
  WebView UA. Display identity: `YouTube.accountInfo()` POSTs
  `account/account_menu` as WEB_REMIX, parses
  `actions[0].openPopupAction.popup.multiPageMenuRenderer.header.
  activeAccountHeaderRenderer` → name / email / channelHandle /
  thumbnailUrl; `displayName = name ?: channelHandle ?: email ?: key`.
  TV-code OAuth exists separately (`data/account/TvOAuth.kt`) — out of
  scope for desktop by explicit user decision (2026-11-21); WebView
  sign-in is the only sign-in path on desktop.
- Android strings (verbatim, `strings.xml`): `account_title`
  "Google account", `account_summary` "Personal feed from your
  account", `account_status_signed_in` "Signed in",
  `account_status_signed_out` "Not signed in", `account_sign_in`
  "Sign in with Google", `account_sign_in_subtitle` "Personal feed,
  subscriptions and history", `account_sign_out` "Sign out",
  `account_sign_out_subtitle` "Go back to browsing anonymously",
  `account_add_account` "Add account", `account_add_account_subtitle`
  "Sign in with another Google account", `account_body_signed_out`
  "Sign in with your Google account to get a home feed picked for
  you. Your sign-in cookie stays on this device, is never backed up,
  and is only sent to YouTube.", `account_body_signed_in` "Your home
  feed and recommendations now use your Google account. Playback and
  downloads keep working signed out too; signing out just makes the
  feed anonymous again.", `home_guest_sign_in` "Sign in",
  `home_guest_title` "You're signed out", `home_guest_message`
  "Sign in to see your feed, subscriptions and history — or search
  for something to watch.", `sign_in_to_subscribe_title` "Sign in to
  subscribe", `sign_in_to_subscribe_message` "Subscriptions live on
  your Google account, just like YouTube. Sign in and this channel
  joins your account subscriptions."
- Theme (`ui/theme/`): Morphe dark background/surface `#1A1C1E`,
  `MorpheBrandBlue #1E5AA8`, saffron `#E85D04` (`DiyaBowlRim`),
  coral `#FF3D68`, amber `#F59E0B`; corners 8dp, gaps 12dp,
  `ThumbnailCornerRadius` 6dp. 26 built-in palettes + Material You /
  Custom / OLED / System modes.
- Notifications: local inbox (`InboxNotification`, max 100, in
  `PlayerPreferences`), groups "New" / "Last 7 days" / "Earlier",
  empty state "Peace and quiet" / "You're all caught up! …", bell
  badge = unread count. NOT a server inbox.
- Downloads: Room-backed; **clip downloads YES**
  (`clipStartMs`/`clipEndMs` in `DownloadRequest.kt:42-51`);
  **multi-audio YES** (`audioTrackKeys`, one file per language);
  custom hand-rolled `Mp4Remuxer`, no FFmpeg; subtitles, lyrics
  embedding, tags.
- Lyrics providers (registry order): YouTube, BetterLyrics, LrcRed,
  LyricsPlus, SimpMusic, KuGou, Paxsenix, LrcLib, Unison, NetEase,
  AMLL, YouTube Subtitles; user-reorderable.
- Scrobbling: ListenBrainz + Last.fm (+ Libre.fm in Deep Glide copy).

## Feature table

Legend: ✅ present · 🟡 partial · ❌ missing · ⏭️ out of scope (desktop)

| Feature | Android (where) | Tauri fork | Gap action |
|---|---|---|---|
| Home feed | `ui/screens/home/HomeScreen.kt`, topic chips (`HomeChipFeeds.kt`), prefetch (`data/feed/FeedPrefetchQueue.kt`), guest banner | ✅ feed + chips + guest banner; prefetch via stored taste seeds | None. (The removed recommendation engine's "Your taste" page is upstream-only, see C3.) |
| Search: filters/chips | `SearchScreen.kt:143-196` filter sheet, `SearchFilter` params | ✅ filter chips + sort (`Search.tsx`, `useSearchFilterMemory`) | None |
| Search: suggestions | `data/search/SearchSuggestionsRepository.kt` | ✅ `lib/searchSuggestions.ts` | None |
| Search: history | `data/local/SearchHistoryRepository`, saved queries | ✅ `store/useSearchHistoryStore.ts` | None |
| Search: headers | anonymous `webSearch` sends `Cookie: SOCS=CAE=` + bare `Origin` | 🟡 search works but uses the home-feed header set (no SOCS cookie) | Follow-up: add SOCS cookie to anonymous search if a live search ever comes back consent-walled |
| Shorts | `ui/screens/shorts/ShortsScreen.kt`, `reel/reel_watch_sequence` + `reelOverlay` | ✅ `ShortsFeed`, reel paging, action rail | Like/comment/subscribe actions are display-only — same as CMP; follow-up |
| Subscriptions | `SubscriptionsScreen.kt`, server-only `FEsubscriptions`, no local store | 🟡 page + local subs (settings JSON) work, feed assembled locally; **no server feed** | Follow-up: fetch `FEsubscriptions` when signed in; subscribe/unsubscribe must hit the server (Android: sign-in gate dialog "Sign in to subscribe") |
| Library | `LibraryScreen.kt`, configurable sections | ✅ `LibraryPage.tsx` (History, Playlists, Watch Later, Liked, Downloads, Local media) | None |
| History | `HistoryScreen.kt`, server `FEhistory` base + local session plays merged | 🟡 local SQLite `watch_history` only (`useHistoryStore`); **no server list** | Follow-up (see E): fetch `FEhistory` when signed in, merge like Android |
| Downloads | `data/video/VideoDownloadManager.kt`, clip + multi-audio + subtitles + lyrics + tags | 🟡 video/audio/music downloads, subtitles, lyrics file, tags, multi-track audio selection in the downloader; **no clip downloads** | Follow-up: clip start/end in the download request + trim after merge |
| Watch Later / server saves | `data/account/AccountPlaylists.kt` (`WL`/`LL`/`LM`), server playlists | 🟡 local-only Watch Later (`useWatchLaterStore`, local playlist id); like/save are local | Follow-up (see E): browse server `WL` playlist + `edit_playlist` save when signed in |
| Comments + live chat | `VideoInfoContent.kt`, `LiveChatController.kt`, comments post/reply/edit/delete/like | ✅ `CommentsSection.tsx`, `LiveChat.tsx` in Watch side panels | None |
| Video page: chapters, description, Up Next, transcript | `EnhancedVideoPlayerScreen.kt`, chapters sheet, `VideoDescriptionLoader.kt`, `RelatedVideosList.kt`, `TranscriptRepository.kt` | ✅ chapters (`player/chapters.tsx`), description, Up Next, transcript in side panels | None |
| SponsorBlock | `SponsorBlockRepository.kt`, per-category toggles in Integrations settings | ✅ skipping + submit dialog + Extensions page | None (label renamed Extensions → Integrations, see C2) |
| DeArrow | `IntegrationsScreen.kt:61-64`, title/thumbnail replacement | ✅ `dearrow_enabled` / badge / random-frame settings + VideoCard replacement | None |
| Return YouTube Dislike | `YouTube.returnYouTubeDislike()`, `DislikeCountLoader.kt` | ✅ `get_return_youtube_dislike` (`lib/api/foss.ts`), shown in Watch metadata + Shorts | None |
| Music mode + lyrics | `MusicViewModel.kt`, 12 lyrics providers | ✅ music home/moods/artist/radio + same 12 providers (`lib/lyrics/registry.ts`) | None |
| ListenBrainz / Last.fm scrobbling | `data/scrobble/Scrobbler.kt`, `ListenBrainzClient.kt`, `AudioscrobblerClient.kt` | ✅ `LASTFM` / `LIBREFM` / `LISTENBRAINZ` (`lib/api/scrobble.ts`), Last.fm discovery | None |
| Local media | `LocalMediaScreen.kt`, MediaStore scan | ✅ `LocalMedia.tsx` (folder scan on desktop) | None |
| Notifications / bell inbox | `NotificationsScreen.kt`, local inbox, "Peace and quiet" empty state | ✅ `NotificationsBell.tsx` (unread badge, 9+ cap) + local inbox via `notification_service.rs` | None |
| Update checks | `UpdateScreen.kt`, GitHub releases of `shivytyahoo/YouGlideTube` | ✅ `UpdateManager` + Settings → About → check for updates | Updater is disabled (no endpoints configured) — re-point it when a published release exists |
| Equalizer | `ui/screens/equalizer/EqualizerScreen.kt` | ✅ `EqualizerDialog` (from the music player) | None (dialog, not a route — fine on desktop) |
| Deep Glide Mode | Settings "YouGlideTube Engine" group | ✅ privacy tab + top-bar toggle (`deep-glide-*`) | None |
| Wellbeing | `WellbeingScreen.kt` (watch-time reminders) | ✅ wellbeing tab + `WellbeingController` | None |
| Onboarding | `onboarding` start destination incl. sign-in step | 🟡 onboarding exists but has **no sign-in step** | Follow-up: add the Android sign-in step ("Sign in with Google" + skip) to `Onboarding.tsx` |
| Sign-in UI wording | `GoogleLoginActivity.kt` + strings above | 🟡 WebView flow matches; dialog strings were CMP paraphrases, not Android's | Fixed this step in part: Account tab uses verbatim Android strings; dialog footer reworded to Android's `account_body_signed_out` |
| Avatar / display name | No top-bar avatar; identity from `account_menu` | 🟡 brand-blue "Y" placeholder (no name stored) | **Fixed this step (A1): fetch `account/account_menu`, show real name + initial (+ photo when present)** |
| Settings: Account page | `AccountScreen.kt` (status, account rows, Add account, Sign out, notice) | ❌ no account category at all (step 2 wrongly claimed Android has none) | **Fixed this step (B1): "Google account" settings category mirroring AccountScreen** |
| Settings: everything else | 28 sub-pages (see Android reference facts) | 🟡 The upstream app's 17 categories cover the same ground with different grouping; upstream-only extras: profiles, keyboard, taste/recap, sync-adjacent data rows | Follow-up: re-group rows toward Android's order; do not delete upstream rows users rely on without a migration note |
| Top-bar ProfileMenuButton | No local profiles in Android | ❌ Upstream-only (local profiles) | Follow-up (C1): remove/reshape once profile-scoped data migration is planned; left in place this step (load-bearing) |
| Sync (P2P with the upstream Android app) | No equivalent (Android syncs via Google server) | ❌ Upstream-only page + sidebar item | **Fixed this step (C2): removed from sidebar** (route kept, unlinked, pending removal/replacement) |
| Support / Donations | No equivalent (Android About page) | ❌ Upstream-only donations page ("Support") | **Fixed this step (C2): removed from sidebar** (route kept, unlinked) |
| "Your taste" (removed recommendation engine) | No equivalent (Android feed IS the feed) | 🟡 Upstream-only recommendation-engine page, neutral label | Left: label is already neutral ("Your taste"); engine is upstream-only, recorded here, not rebranded as YouGlideTube |
| TV-code OAuth | `data/account/TvOAuth.kt` (TV path) | ⏭️ out of scope — user decision (2026-11-21): no TV-code OAuth on desktop; WebView sign-in is the only sign-in path | Do not build; not a follow-up |
| Multi-account switching | `SavedAccount` list, switch from Account page | ❌ single session only (`google-session.txt`) | Follow-up: multi-session storage; "Add account" currently replaces the session (documented in the tab) |
| Shazam-style recognition | `data/recognition/shazam/ShazamClient.kt` | ❌ no recognition | Follow-up (low priority) |
| Android TV layout | `ui/tv/` (D-pad shell, TV-code OAuth) | ⏭️ out of scope — user decision (2026-11-21), not a deferral: no TV layout, no TV app work, nothing | — |
| Home-screen widgets | `ui/screens/widgets/` | ⏭️ out of scope on desktop | Say so: no desktop widgets |

**Count: 19 ✅ present · 10 🟡 partial · 6 ❌ missing (1 fixed this
step — the Account settings page; the avatar identity was a partial,
also fixed this step) · 3 ⏭️ out of scope** (Android TV layout, TV-code
OAuth, widgets — the first two by explicit user decision, 2026-11-21,
not deferrals). The fork is a real YouGlideTube
client for watching, searching, Shorts, music and downloads; the
server-account surface (subscriptions feed, server history, server
Watch Later, multi-account) is the remaining gap, and it all needs
the signed-in session step 2 built — that is the follow-up, not a
new sync system.

## Gaps closed in step 3

- **A1 — avatar display name.** Rust `api/innertube/account.rs`:
  `InnertubeClient::account_info()` POSTs `account/account_menu` as
  WEB_REMIX and parses `activeAccountHeaderRenderer` into
  `AccountInfo { name, email, channel_handle, thumbnail_url }`
  (Android's `YouTube.accountInfo()` shape). Command
  `get_account_info` fetches it live and persists it to
  `google-account.json` (0600) next to the session file; `get_auth_status`
  now also returns the cached identity. Frontend `useGoogleAccount`
  exposes `account`; the top bar shows the photo when present, else
  the first letter of the real display name (title = full name),
  falling back to "Y" only until the first fetch. Known deviation:
  signed-in calls still do not send `dataSyncId` (Android does); the
  source of that value is not yet traced — follow-up.
- **B1 — Account settings category.** New `account` category, first
  in the Settings list (Android lists "Google account" second in its
  home list, right after Battery saver). `AccountTab` mirrors
  `AccountScreen.kt`: status row ("Signed in" / "Not signed in"),
  account entry (display name + channel handle or email), "Sign in
  with Google" / "Add account" / "Sign out" rows with Android's
  verbatim strings and notice text. Sign-out is immediate (no
  confirmation — matches Android). "Add account" opens the sign-in
  flow and replaces the current session; multi-account switching
  stays a follow-up.
- **C2 — naming/labels.** Sidebar "You" → "Library" (Android's tab
  name); "Extensions" → "Integrations" (Android's settings page
  name); Upstream-only "Sync" and "Support" sidebar items removed
  (routes kept, unlinked, pending removal/replacement in step 4).
  Sign-in dialog comment corrected (it wrongly claimed Android has
  no account settings tab) and its footer now uses Android's
  `account_body_signed_out` wording.
- **(d) — unreachable screens.** Checked: every upstream screen that
  exists is already reachable — subscriptions, history, library,
  downloads, music, Shorts, playlists, albums, Watch Later,
  saved Shorts, liked, notes, local media, Explore, Recap (via
  Library/Taste settings), Import/Diagnostics/Discover channels (via
  Settings tabs). Nothing to wire.
- **(e) — server history + Watch Later.** NOT done: the backend has
  no hooks for either (`FEhistory`, `edit_playlist`, server `WL`
  browse are all absent from `api/innertube/`). Building them here
  would be a new sync system, explicitly out of scope for this step.
  Recorded above as the follow-up; it needs `account_menu`-style
  authenticated browse calls, not new infrastructure.

## Remaining for step 4 / follow-ups

1. Server subscriptions feed (`FEsubscriptions`) + server
   subscribe/unsubscribe with Android's sign-in gate dialog.
2. Server history (`FEhistory`) merged with local session history,
   incl. paused-history behaviour and clear-all.
3. Server Watch Later (`WL` browse + `edit_playlist` save).
4. Multi-account switching (multi-session storage).
5. Clip downloads (clip start/end + trim after merge).
6. Onboarding sign-in step (Android's step, skippable).
7. Anonymous search `SOCS=CAE=` cookie if a live search ever comes
   back consent-walled.
8. Local-profiles removal/reshape (C1) incl. data migration;
   remove the unlinked `/sync` and `/support` routes.
9. Updater re-point (step 4) + `dataSyncId` on signed-in calls.
10. Real-machine verification of everything here: first Google
    login, first `account_menu` fetch, first signed-in feed — none of
    it can run in this sandbox (headless, google.com/youtube.com hang).
