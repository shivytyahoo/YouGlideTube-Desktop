# Changelog

## 1.0.0 — 2026-11-21

The first desktop release — the YouGlideTube Android app, on the desktop.

- Google sign-in, the Android way: sign in on Google's own page in a window inside the app, and the home feed reloads signed-in; a cookie-paste option is there if Google refuses the in-app window
- Your account, on the server: subscriptions, watch history and Watch Later now come from your Google account, not just the device — subscribe from any card, clear your server history, save to Watch Later and it saves on the server
- Multiple accounts: add more than one Google account and switch between them from Settings → Google account
- Home feed is fully YouTube's now: the feed comes from YouTube's own home browse, signed-in or anonymous, with YouTube's chips — the fixed searches are only a fallback
- Watch history syncs with your YouTube account: videos watched in YouGlideTube Desktop appear in YouTube history on every device, and the other way round — Clear All and Delete remove videos from your server history too, and they stay gone after refresh
- Music, the Android way: Listen Again, On Repeat, Speed Dial, Quick Picks, Daily Discover, Daily Mixes and Similar To shelves, a pitch slider, and endless radio
- The Android look: the Android logo, the Android onboarding, and glass top bar, sidebar, player controls and mini player
- Notifications: a bell with an unread badge and an inbox grouped as New, Today, Yesterday, Last 7 days and Earlier, with a check interval you choose
- Downloads: quality and format choice, multi-audio downloads, subtitles, a lyrics file and tags
- Download a clip: pick a start and end time and download just that part, for video and audio downloads
- Search history is saved separately for video and music searches
- Voice search in video and music search: tap the mic and speak to search, where the device supports it
- Music recognition: hold the mic to a song and the app identifies it, then plays it or searches for it
- The Android launch intro: the logo ring and tagline animate when the app opens, skipped when battery saver is on
- Battery saver in Settings: animations, glass and previews off — the fastest, lightest app
- Settings are grouped the Android way, with a System theme in Appearance that follows your OS, and the sidebar's Library section is now called Library
- The app's local engines are gone: the desktop app works from Google and YouTube servers like the Android app does — no on-device recommendation, music or sync engines, no local profiles
- Imports from YouGlideTube backups, Google Takeout, NewPipe, LibreTube, FreeTube and OPML
- Small on Linux: the optimized `.deb` is 21.73 MiB, about 56 MB installed

### Fixed in the re-tagged 1.0.0 build (2026-11-21)

- Sign-in now captures cookies from youtube.com only — the first build could capture a Google-only session, so the app looked signed in while YouTube did not recognise it and subscriptions, history, like, comment and subscribe all failed. Sign out and sign in once after installing this build to replace the stored session
- Top-bar avatar now opens the account menu (account info, switch/add account, Google account settings, sign out); the account row shows the real account name instead of a generic "Google account"
- Subscriptions and watch history now load from the Google account; the "Import subscriptions" option is removed
- Like/dislike are now confirmed on the account with the counts updating, and a comment composer is added under videos; subscribing works from videos, Shorts and comments
- The Next button now plays the next video
- Clip downloads fetch only the clip's segments instead of the whole video first
- Playlists live on the account now: create, delete and rename playlists, add and remove videos, Liked videos read from the server list, saving to Watch Later from the playlist menu saves on the server, and removing from Liked unlikes on the server
- Chapter Loop really loops; changing quality in Shorts keeps position and Shorts has its own persisted playback speed
- Closing the notifications bell no longer marks everything read; the bell refreshes on open with a manual refresh button; pausing a queued download shows Resume; community posts can be liked; downloads show a storage meter with per-type limits; the Data tab shows the real history count
- Cancelling Add account no longer leaves the sign-in screen stuck, and closing the sign-in dialog cancels the login window
