# Changelog

## 1.0.1 — 2026-11-23

A fixes-only release on top of 1.0.0.

- The "7 months ago" Preview box is gone from Settings → Appearance: it only showed sample dates and was not useful; the Date & Time Display settings themselves are unchanged
- Liking a comment now moves the count: the like only highlighted before, because the liked-count text was never shown; the same fix covers replies
- Replying to a comment now shows the reply under it at once: the reply was reaching the server but never appeared until the comments were reloaded; liking a reply works now too
- Video like and dislike no longer send a stale token from another video (fast navigation could attach the previous video's token and the server refused it); signed out, tapping like or dislike now opens Google sign-in instead of pretending the like landed locally
- Volume slider in the narrow player: in the normal watch view the volume button only muted before — tapping it now opens a small slider above the bar, and the wide player keeps the hover slider
- "Resolving stream" is fixed for good: the playback token was never minted because the code read the wrong call on YouTube's homepage and failed the whole page, so streams fell back to a legacy token YouTube refused a few seconds in; videos that need the fallback now play through
- Diagnostics now log every like, dislike, comment like and reply call, so the next log shows exactly whether an action reached the server or stopped in the app

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
- The cookie sign-in option is gone entirely: sign-in is WebView-only, like the Android app; the sign-in dialog now opens centred on the screen from anywhere, including the top-right avatar, instead of getting trapped in the top bar with the Google button cut off
- A posted comment no longer shows a false "Couldn't post the comment" error — the list refreshes and the comment appears, and a genuine failure names its own cause
- "Save logs" in Diagnostics now saves the .log file, which the backend used to reject
- A music track that fails to load now shows an error instead of silently skipping, and music streams get the same fresh-link fallback as video when Google refuses a link
- "Resolving stream" now times out after 60 seconds with an error and a Retry button instead of spinning forever; the player-script fetch is bounded too
- Like and dislike: the count now moves even without Return YouTube Dislike data, dislike always reaches the server, and like sends the button's own params so the server accepts it; failure toasts name the real error
- Videos resolve much faster now: sign-in auth is no longer sent to clients that do not support login (YouTube used to reject the first attempt twice on every video, wasting about 10 seconds), and the playback token is now minted the Android way, so streams no longer die a few seconds in; if a stream still fails mid-playback, the app first tries the already-loaded stream instead of resolving the whole video again
- Comments now have Reply, including replies to replies in nested threads, and Delete on your own comments (Watch, Shorts and community posts)
- Watch: playback speed up to 4x with presets and a slider, a visible Loop control, live-chat send and delete, per-video SponsorBlock off, description like-count and chapter/transcript shortcuts, and clearer errors with a sign-in action
- Home, Search and Music: guest banner, "I want more like this" and inline card feedback, pull-to-refresh on Home and Music home, Purchased search filter, and music tab refresh
- Shorts: saving a Short now saves to server Watch Later when signed in, channel and subscriptions queue sources, a top bar with a back button, load-error retry, the real sound title with a spinning disc, all three UI modes, and a per-Shorts ambient toggle
- Library, Subscriptions and Downloads: multi-audio downloads now put all languages in one file like Android, the notifications inbox is capped at 100, history merges by time like Android, history-pause freezes the server list, the library splits into video/music playlists and liked videos/music, playlist compact toggle, unsubscribe Undo, hide-watched on for the subscriptions feed, and remove-all-incomplete
- Settings: in-app updates now point at the published release, a new Integrations tab, background-play setting, watch-history auto-delete and retention, a Shorts settings cluster, feed/Shorts preview and thumbnail quality, comments preview, notification types, codec fallback, start-paused, and many small rows matching the Android app
- Not in this build: Cast/DLNA and Skip silence — both need whole subsystems the desktop does not have yet

### Fixed in the re-tagged 1.0.0 build (2026-11-23)

- The sidebar now scrolls: Downloads, Local Media, Settings and Extensions below Likes were unreachable because the rail never got a height to scroll in
- Comment delete is fixed: the delete action was sent in the wrong shape and rejected before it ever reached the server; a real failure now names its own cause
- Comment like and dislike are new on desktop: they did not exist at all — like and dislike now work on comments and replies, with the count moving
- "Sign in to comment" now opens the Google sign-in dialog — tapping it used to do nothing; after signing in you land back at the comment box, ready to type
- Video dislike is fixed for real: the old dislike only removed a like and never recorded one; dislike now sends the dislike button's own params to the server, the count moves, and un-disliking reaches the server too
- The watch action row no longer wraps into a ragged staircase: Subscribe, Share, Save, Download and Note now sit in one scrollable row and nothing is cut off
- The top bar has a Refresh button next to back/forward: it reloads the current page without going Home, and the Subscriptions feed refreshes for real instead of showing its cache
- Voice search works on Windows now: the mic uses Windows' own speech recognizer — the browser speech feature the app used to rely on does not exist in the desktop webview
- Player layout: the video time no longer climbs over the autoplay switch at narrow widths, and the player now uses the full width — the watch page no longer reserves 240px on the left for a sidebar that is not shown there
- The "Try YouTube Premium free" card is gone from Up Next and every other feed: it was a fake video item with a non-video id, and tapping it sent the player a bad id; such items are filtered out at the parser, and the player refuses bad ids
- Glass theme: Settings → Appearance now has a Glass theme toggle — it was missing entirely; on Windows 11 the window uses native Mica, so the sidebar, top bar and player bar turn frosted glass with the desktop showing through; battery saver still turns glass solid
