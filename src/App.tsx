import { useCallback, useState, useEffect } from "react";
import { registerAutoBackup } from "./lib/api/backup";
import { getString } from "./lib/i18n/index";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { usePlayerStore } from "./store/usePlayerStore";
import { useFeedActionsStore } from "./store/useFeedActionsStore";
import { useMusicActionsStore } from "./store/useMusicActionsStore";
import { useAppSettingsStore } from "./store/useAppSettingsStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useAlbumLibraryStore } from "./store/useAlbumLibraryStore";
import { useLikesStore } from "./store/useLikesStore";
import { useNotesStore } from "./store/useNotesStore";
import { useDownloadsLibraryStore } from "./store/useDownloadsLibraryStore";
import { useDownloadCollectionsLibraryStore } from "./store/useDownloadCollectionsLibraryStore";
import { useWatchLaterStore } from "./store/useWatchLaterStore";
import { startWatchProgress } from "./store/useWatchProgressStore";
import { useSubscriptionStore } from "./store/useSubscriptionStore";
import { useNotificationStore } from "./store/useNotificationStore";
import { getSetting } from "./lib/api/db";
import { useStartupHealth } from "./lib/useStartupHealth";
import { useStartupSubscriptionRefresh } from "./lib/useStartupSubscriptionRefresh";
import { useImageProxyBootstrap } from "./lib/useImageProxy";
import { WATCH_LATER_PLAYLIST_ID } from "./lib/playlistLibrary";
import type { VideoSummary } from "./types/video";

import { PageWrapper } from "./components/layout/PageWrapper";
import { TitleBar } from "./components/layout/TitleBar";
import { LaunchIntro } from "./components/LaunchIntro";

import Home from "./pages/Home";
import MusicHome from "./pages/music/MusicHome";
import MusicBrowsePage from "./pages/music/MusicBrowsePage";
import MusicSearchPage from "./pages/music/MusicSearchPage";
import MusicRecognitionPage from "./pages/music/MusicRecognitionPage";
import MusicMoodsPage from "./pages/music/MusicMoodsPage";
import ArtistPage from "./pages/music/ArtistPage";
import ArtistItemsPage from "./pages/music/ArtistItemsPage";
import MusicCollectionPage from "./pages/music/MusicCollectionPage";
import Search from "./pages/Search";
import ExploreCategories from "./pages/ExploreCategories";
import Subscriptions from "./pages/Subscriptions";
import History from "./pages/History";
import RecapPage from "./pages/RecapPage";
import Downloads from "./pages/Downloads";
import LocalMedia from "./pages/LocalMedia";
import Likes from "./pages/Likes";
import LibraryPage from "./pages/LibraryPage";
import AlbumsLibrary from "./pages/AlbumsLibrary";
import SavedShorts from "./pages/SavedShorts";
import Notes from "./pages/Notes";
import Playlists from "./pages/Playlists";
import PlaylistDetailsPage from "./pages/PlaylistDetailsPage";
import Settings from "./pages/Settings";
import ImportData from "./pages/ImportData";
import ExtensionsPage from "./pages/ExtensionsPage";
import Channel from "./pages/Channel";
import Diagnostics from "./pages/Diagnostics";
import { Watch } from "./pages/Watch";
import { ShortsFeed } from "./components/shorts/ShortsFeed";
import Onboarding from "./pages/Onboarding";
import { LayoutGroup } from "framer-motion";
import { ToastHost } from "./components/layout/ToastHost";
import { GlobalMusicAudio } from "./components/music/GlobalMusicAudio";
import { MusicPlayerSheet } from "./components/music/sheet/MusicPlayerSheet";
import { MusicOnly } from "./components/music/MusicOnly";
import { EqualizerDialog } from "./components/music/eq/EqualizerDialog";
import { ContinueWatchingMini } from "./components/player/ContinueWatchingMini";
import { GlobalVideoPlayer } from "./components/watch/GlobalVideoPlayer";
import { PipWindowController } from "./components/pip/PipWindowController";
import { AddToAlbumModal } from "./components/music/AddToAlbumModal";
import { SongDetailsDialog } from "./components/music/SongDetailsDialog";
import { AddTracksToAlbumModal } from "./components/music/AddTracksToAlbumModal";
import { AddToPlaylistModal } from "./components/playlist/AddToPlaylistModal";
import { DeepGlideController } from "./components/deep-glide/DeepGlideController";
import { DeepLinkController } from "./components/handoff/DeepLinkController";
import { DiscordPresenceController } from "./components/discord/DiscordPresenceController";
import { MusicTrayController } from "./components/tray/MusicTrayController";
import { ShellPagesController } from "./components/tray/ShellPagesController";
import { GlobalMediaKeysController } from "./components/shortcuts/GlobalMediaKeysController";
import { KeyboardHelpHost } from "./components/shortcuts/KeyboardHelpHost";
import { CrashReportHost } from "./components/diagnostics/CrashReportHost";
import { ScrobbleController } from "./components/scrobbling/ScrobbleController";
import { WellbeingController } from "./components/settings/WellbeingController";
import { DownloadDialog } from "./components/downloads/DownloadDialog";
import { DownloadActivity } from "./components/downloads/DownloadActivity";
import { UpdateManager } from "./components/updater/UpdateManager";
import { ConfirmHost } from "./components/common/ConfirmHost";
import { NoteEditorHost } from "./components/note/NoteEditorHost";
import { ThemeController } from "./lib/useTheme";
import { useTabHistoryShortcuts } from "./lib/tabs/useTabHistoryShortcuts";
import { installTabPlaybackSync } from "./lib/tabs/tabPlayback";
import { useTabShortcuts } from "./lib/tabs/useTabShortcuts";
import { useActiveTabTitle } from "./lib/tabs/useActiveTabTitle";
import { useTabSession } from "./lib/tabs/useTabSession";
import { useSingleTabWhenOff } from "./lib/tabs/useSingleTabWhenOff";
import { useMediaCommands } from "./lib/useMediaCommands";
import { applyBatterySaverClass } from "./lib/batterySaver";
import { useBatterySaver } from "./lib/useBatterySaver";
import { setStreamPrefetchEnabled } from "./lib/streamResolution";
import { setMusicPrefetchEnabled } from "./lib/musicStreamResolution";
import { useCrossWindowSync } from "./lib/useCrossWindowSync";
import { IS_MAIN_WINDOW } from "./lib/appWindow";
import { SelectionMenu } from "./components/common/SelectionMenu";

import { APP_TITLEBAR_HEIGHT } from "./lib/platform";
import type { CSSProperties } from "react";
import "./App.css";

const windowLayoutStyle = { "--app-titlebar-height": `${APP_TITLEBAR_HEIGHT}px` } as CSSProperties;

function App() {
  /*
    Selected one action at a time, never destructured off a bare `usePlayerStore()`:
    a selectorless subscription re-renders this component — and with it every route,
    feed and card below it — on every `currentTime` write, which the player emits
    about four times a second for the whole of playback.
  */
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const navigate = useNavigate();
  const location = useLocation();

  // Clear the Linux startup-crash sentinel as soon as the app mounts
  useStartupHealth();
  useStartupSubscriptionRefresh();
  useImageProxyBootstrap();
  useTabHistoryShortcuts();
  useEffect(installTabPlaybackSync, []);
  useTabShortcuts();
  useActiveTabTitle();
  const tabsRestored = useTabSession();
  useSingleTabWhenOff();
  useCrossWindowSync();
  useMediaCommands();

  // Onboarding belongs to the main window; an extra window only exists once it is done.
  const [loadingOnboarding, setLoadingOnboarding] = useState(IS_MAIN_WINDOW);

  // The cold-start brand moment (as on Android): a pure overlay above the
  // shell, main window only, skipped when the user prefers reduced motion
  // or has battery saver on. The app underneath keeps loading; the intro
  // never gates content.
  const batterySaver = useBatterySaver();
  const [showIntro, setShowIntro] = useState(
    () => IS_MAIN_WINDOW && !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Battery saver (Android's first settings row): glass goes solid, the
  // speculative stream prefetches stop, and the launch intro is skipped.
  // The setting defaults to off and loads from SQLite with the rest of the
  // settings, so a stored "on" lands a beat after first paint — the intro
  // hides itself the moment it arrives.
  useEffect(() => {
    applyBatterySaverClass(batterySaver);
    setStreamPrefetchEnabled(!batterySaver);
    setMusicPrefetchEnabled(!batterySaver);
  }, [batterySaver]);

  useEffect(() => {
    void useFeedActionsStore.getState().load();
    void useMusicActionsStore.getState().load();
    void useAppSettingsStore.getState().loadSettings();
    void useSettingsStore.getState().loadSettings();
    void useAlbumLibraryStore.getState().load();
    void useLikesStore.getState().load();
    void useNotesStore.getState().load();
    void useDownloadsLibraryStore.getState().load();
    void useDownloadCollectionsLibraryStore.getState().load();
    void useWatchLaterStore.getState().load();
    // Every subscribe button reads these, so they load once here rather than once per button.
    void useSubscriptionStore.getState().loadSubscriptions();
    void useNotificationStore.getState().loadChannelPreferences();
    if (IS_MAIN_WINDOW) void registerAutoBackup(getString("settings_backup_failed_notice")).catch(() => {});
  }, []);

  useEffect(() => startWatchProgress(), []);

  // Check onboarding state from sqlite db setting
  useEffect(() => {
    if (!IS_MAIN_WINDOW) return;
    const checkOnboarding = async () => {
      try {
        const completed = (await getSetting("onboarding_completed")) === "true";
        if (!completed && location.pathname !== "/onboarding") {
          navigate("/onboarding");
        }
      } catch (e) {
        console.warn("Failed to read onboarding telemetry status", e);
      } finally {
        setLoadingOnboarding(false);
      }
    };
    checkOnboarding();
  }, [navigate, location.pathname]);

  /*
    Stable identities matter here beyond the usual hygiene: these are handed down
    to every page and end up as the `onPlay`/`onAddToQueue` prop of every card, so
    a fresh closure per render defeats `React.memo(VideoCard)` for the whole feed.
  */
  const handlePlayVideo = useCallback((video: VideoSummary) => {
    setQueue([video], 0);
    navigate(`/watch/${video.id}`);
  }, [setQueue, navigate]);

  const handleAddToQueue = useCallback((video: VideoSummary) => {
    addToQueue(video);
  }, [addToQueue]);

  if (loadingOnboarding || !tabsRestored) {
    return (
      <div style={windowLayoutStyle} className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
        <ThemeController />
        <TitleBar />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div style={windowLayoutStyle} className="relative flex h-screen flex-col overflow-hidden bg-background text-chrome-zinc-100 font-sans">
      <ThemeController />
      <SelectionMenu />
      <TitleBar />
      <div data-app-content className="relative min-h-0 flex-1">
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        
        <Route path="/" element={<PageWrapper />}>
          <Route index element={
            <Home onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route element={<MusicOnly />}>
            <Route path="music" element={
              <MusicHome />
            } />
            <Route path="music/moods" element={<MusicMoodsPage />} />
            <Route path="music/browse" element={<MusicBrowsePage />} />
            <Route path="music/search" element={<MusicSearchPage />} />
            <Route path="music/recognition" element={<MusicRecognitionPage />} />
            <Route path="music/artist/:artistId" element={
              <ArtistPage />
            } />
            <Route path="music/artist/:artistId/items" element={
              <ArtistItemsPage />
            } />
            <Route path="music/album/:id" element={
              <MusicCollectionPage kind="album" />
            } />
            <Route path="music/playlist/:id" element={
              <MusicCollectionPage kind="playlist" />
            } />
            <Route path="albums" element={<AlbumsLibrary />} />
          </Route>
          <Route path="search" element={
            <Search onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="explore" element={
            <ExploreCategories onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="shorts" element={
            <ShortsFeed />
          } />
          <Route path="shorts/:videoId" element={
            <ShortsFeed />
          } />
          <Route path="subscriptions" element={
            <Subscriptions onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="channel/:channelId" element={
            <Channel onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="playlists" element={
            <Playlists onPlay={handlePlayVideo} />
          } />
          <Route path="playlist/:playlistId" element={
            <PlaylistDetailsPage
              onAddToQueue={handleAddToQueue}
            />
          } />
          <Route path="watch-later" element={
            <PlaylistDetailsPage
              playlistIdOverride={WATCH_LATER_PLAYLIST_ID}
              onAddToQueue={handleAddToQueue}
            />
          } />
          <Route path="library" element={
            <LibraryPage onPlay={handlePlayVideo} onAddToQueue={handleAddToQueue} />
          } />
          <Route path="notes" element={
            <Notes onPlay={handlePlayVideo} />
          } />
          <Route path="recap" element={
            <RecapPage onPlay={handlePlayVideo} />
          } />
          <Route path="saved-shorts" element={
            <SavedShorts />
          } />
          <Route path="history" element={
            <History onPlay={handlePlayVideo} />
          } />
          <Route path="downloads" element={
            <Downloads onPlay={handlePlayVideo} />
          } />
          <Route path="local-media" element={
            <LocalMedia />
          } />
          <Route path="liked" element={
            <Likes onPlay={handlePlayVideo} />
          } />
          <Route path="settings" element={
            <Settings />
          } />
          <Route path="settings/import" element={
            <ImportData />
          } />
          <Route path="settings/diagnostics" element={
            <Diagnostics />
          } />
          <Route path="sponsorblock" element={
            <ExtensionsPage />
          } />
          <Route path="watch/:videoId" element={
            <Watch />
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </div>
      <GlobalVideoPlayer />
      <PipWindowController />
      <MusicTrayController />
      {/* Music, deep links, the updater and other once-per-app jobs run in the main window only. */}
      {IS_MAIN_WINDOW && (
        <>
          <GlobalMusicAudio />
          <ContinueWatchingMini />
          <LayoutGroup>
            <MusicPlayerSheet />
          </LayoutGroup>
          <DeepGlideController />
          <DeepLinkController />
          <GlobalMediaKeysController />
          <ShellPagesController />
          <ScrobbleController />
          <WellbeingController />
        </>
      )}
      <EqualizerDialog />
      <AddToAlbumModal />
      <SongDetailsDialog />
      <AddTracksToAlbumModal />
      <AddToPlaylistModal />
      <DiscordPresenceController />
      <LayoutGroup id="downloads">
        <DownloadDialog />
        <DownloadActivity />
      </LayoutGroup>
      <UpdateManager enabled={IS_MAIN_WINDOW && location.pathname !== "/onboarding"} />
      {IS_MAIN_WINDOW && location.pathname !== "/onboarding" && <CrashReportHost />}
      <NoteEditorHost />
      <KeyboardHelpHost />
      <ConfirmHost />
      <ToastHost />
      {showIntro && <LaunchIntro batterySaver={batterySaver} onDone={() => setShowIntro(false)} />}
    </div>
  );
}

export default App;
