import { getString } from "../lib/i18n/index";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AddAllToPlaylistDialog } from "../components/playlist/AddAllToPlaylistDialog";
import { PlaylistAmbientHeader } from "../components/playlist/PlaylistAmbientHeader";
import { PlaylistFormDialog } from "../components/playlist/PlaylistFormDialog";
import { addVideosToQueueWithToast, PlaylistSelectionActions } from "../components/playlist/PlaylistSelectionActions";
import { PlaylistLoadMore } from "../components/playlist/PlaylistLoadMore";
import { PlaylistSortableList } from "../components/playlist/PlaylistSortableList";
import {
  availablePlaylistSortOrders,
  loadPlaylistSortOrder,
  resolvePlaylistSortOrder,
  savePlaylistSortOrder,
  sortPlaylistVideos,
  type PlaylistSortOrder,
} from "../lib/playlistSort";
import {
  formatVideoCountText,
  isProtectedPlaylistId,
  removePlaylistFromLibrary,
  savePlaylistToLibrary,
  updateStoredPlaylistDetails,
  updateStoredPlaylistName,
  updateStoredPlaylistTracks,
  WATCH_LATER_PLAYLIST_ID,
} from "../lib/playlistLibrary";
import { isSystemServerPlaylistId, useServerPlaylistsStore } from "../store/useServerPlaylistsStore";
import { sweepWatchedFromWatchLater } from "../lib/watchLaterCleanup";
import { videoToFileEntry } from "../lib/playlistFile";
import { filterVideosBySearch } from "../lib/playlistSearch";
import { savePlaylistWhenLoaded } from "../lib/playlistTransfer";
import { useDebounce } from "../lib/useDebounce";
import { useMultiSelect } from "../lib/useMultiSelect";
import { usePlaylistDetails, type PlaylistDetailsMeta } from "../lib/usePlaylistDetails";
import { useServerWatchLater } from "../lib/useServerWatchLater";
import { usePublishTitle } from "../lib/usePublishTitle";
import { useCollectionDownloadState } from "../lib/useCollectionDownloads";
import { youtubePlaylistUrl } from "../lib/youtubeUrl";
import { copyText } from "../lib/clipboard";
import { confirmPlaylistRemoval } from "../lib/confirmPlaylistRemoval";
import { fisherYates } from "../lib/musicShuffle";
import { usePlayerStore } from "../store/usePlayerStore";
import { useDownloadStore } from "../store/useDownloadStore";
import { useUiStore } from "../store/useUiStore";
import type { PlaylistSummary, VideoSummary } from "../types/video";

interface PlaylistDetailsPageProps {
  playlistIdOverride?: string;
  onAddToQueue?: (video: VideoSummary) => void;
}

/** No rows are ever picked in the server Watch Later list (no selection bar). */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export function PlaylistDetailsPage({
  playlistIdOverride,
  onAddToQueue,
}: PlaylistDetailsPageProps) {
  const params = useParams<{ playlistId: string }>();
  const playlistId = playlistIdOverride ?? params.playlistId;
  const navigate = useNavigate();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const showToast = useUiStore((state) => state.showToast);

  const {
    loading,
    error,
    storedPlaylist,
    meta,
    videos,
    hasMore,
    loadingMore,
    loadMoreFailed,
    loadMore,
    loadAllVideos,
    setVideos,
    applyDetails,
    reload,
    hidesUnavailable,
  } = usePlaylistDetails(playlistId);
  usePublishTitle(meta?.title);

  // Signed in, Watch Later is the account's server list (`VLWL`); signed
  // out, the local saved copy is the fallback.
  const isWatchLater = playlistId === WATCH_LATER_PLAYLIST_ID;
  const serverWatchLater = useServerWatchLater(isWatchLater);
  const showServerWatchLater = isWatchLater && serverWatchLater.status === "signed-in";
  const serverPlaylists = useServerPlaylistsStore((s) => s.playlists);
  const loadServerPlaylists = useServerPlaylistsStore((s) => s.load);
  useEffect(() => {
    void loadServerPlaylists();
  }, [loadServerPlaylists]);
  // An own playlist on the account — not Watch Later, Liked videos or
  // Liked Music, which have their own surfaces — is edited on the server,
  // as Android does; the local copy, when one exists, is only a cache.
  const isServerPlaylist = Boolean(
    playlistId
    && !isProtectedPlaylistId(playlistId)
    && !isSystemServerPlaylistId(playlistId)
    && serverPlaylists.some((playlist) => playlist.id === playlistId),
  );

  const [storedSortOrder, setStoredSortOrder] = useState<string | null>(() =>
    playlistId ? loadPlaylistSortOrder(playlistId) : null,
  );
  const [savedInLibrary, setSavedInLibrary] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const appliedSearch = useDebounce(searchQuery, 150);
  const [editing, setEditing] = useState(false);
  const [addingAll, setAddingAll] = useState(false);

  useEffect(() => {
    setStoredSortOrder(playlistId ? loadPlaylistSortOrder(playlistId) : null);
    setSearchQuery("");
  }, [playlistId]);

  useEffect(() => {
    setSavedInLibrary(Boolean(storedPlaylist));
  }, [storedPlaylist]);

  const handleSortChange = (next: PlaylistSortOrder) => {
    setStoredSortOrder(next);
    if (playlistId) savePlaylistSortOrder(playlistId, next);
  };

  const isProtected =
    Boolean(storedPlaylist?.isProtected) ||
    (playlistId ? isProtectedPlaylistId(playlistId) : false);
  const isOwned = storedPlaylist?.source === "Owned" && !isProtected;
  const isLocalPlaylist = savedInLibrary || isProtected;
  const sortOrder = resolvePlaylistSortOrder(storedSortOrder, isLocalPlaylist);

  // Sorting by date or popularity and searching are only right over the whole playlist.
  const needsWholePlaylist = sortOrder !== "manual" || appliedSearch.trim() !== "";
  // A server search runs once per search; a failed walk must not retry in a loop.
  const serverLoadAllAttemptedRef = useRef(false);
  useEffect(() => {
    if (!needsWholePlaylist) {
      serverLoadAllAttemptedRef.current = false;
      return;
    }
    if (showServerWatchLater) {
      if (!serverWatchLater.hasMore || serverLoadAllAttemptedRef.current) return;
      serverLoadAllAttemptedRef.current = true;
      void serverWatchLater.loadAll().catch(() => undefined);
      return;
    }
    if (hasMore) void loadAllVideos().catch(() => undefined);
  }, [needsWholePlaylist, hasMore, loadAllVideos, showServerWatchLater, serverWatchLater]);

  const displayVideos = useMemo(
    () => sortPlaylistVideos(videos, sortOrder, isProtected),
    [videos, sortOrder, isProtected],
  );
  const shownVideos = useMemo(
    () => filterVideosBySearch(displayVideos, appliedSearch),
    [displayVideos, appliedSearch],
  );

  const shownIds = useMemo(() => shownVideos.map((video) => video.id), [shownVideos]);
  const selection = useMultiSelect(shownIds);
  const selectedVideos = useMemo(
    () => shownVideos.filter((video) => selection.selectedIds.has(video.id)),
    [shownVideos, selection.selectedIds],
  );

  const leadVideo = videos[0];
  const heroThumbnailUrl = leadVideo?.thumbnailUrl ?? meta?.thumbnailUrl ?? null;

  const openCollectionDownload = useDownloadStore((state) => state.openCollection);
  const downloadState = useCollectionDownloadState(meta?.id, "playlist");

  const handleDownloadPlaylist = async () => {
    if (!meta || videos.length === 0) return;
    openCollectionDownload({
      kind: "playlist",
      meta: {
        collectionId: meta.id,
        title: meta.title,
        author: meta.channelName || undefined,
        thumbnailUrl: heroThumbnailUrl ?? meta.thumbnailUrl ?? undefined,
      },
      load: () => (hasMore ? loadAllVideos().catch(() => videos) : Promise.resolve(videos)),
    });
  };

  // Watched elsewhere since this list was last open. The server list has no
  // local sweep: the account's list is the truth, watched or not.
  const swept = useRef(false);
  useEffect(() => {
    if (showServerWatchLater || playlistId !== WATCH_LATER_PLAYLIST_ID || loading || swept.current) return;
    swept.current = true;
    void sweepWatchedFromWatchLater(videos, handleTracksChanged);
    // Once per visit, over what the page first loaded.
  }, [playlistId, loading, showServerWatchLater]);

  const handleExport = async () => {
    if (!meta) return;
    await savePlaylistWhenLoaded(async () => ({
      name: meta.title,
      description: isOwned ? meta.description ?? "" : "",
      isMusic: false,
      videos: (hasMore ? await loadAllVideos() : videos).map(videoToFileEntry),
    }));
  };

  const handleSaveDetails = async (name: string, description: string) => {
    if (!meta) return;
    // The account API renames only; the description stays as the account
    // has it, as Android does. A local copy keeps the new name in step.
    if (isServerPlaylist) {
      try {
        await useServerPlaylistsStore.getState().rename(meta.id, name);
        await updateStoredPlaylistName(meta.id, name);
        await reload();
        setEditing(false);
      } catch (saveError) {
        console.error("Failed to rename playlist", saveError);
        showToast({ variant: "error", message: getString("playlist_edit_failed") });
      }
      return;
    }
    try {
      const updated = await updateStoredPlaylistDetails(meta.id, name, description);
      if (!updated) throw new Error("Playlist not found");
      applyDetails(updated);
      setEditing(false);
    } catch (saveError) {
      console.error("Failed to edit playlist", saveError);
      showToast({ variant: "error", message: getString("playlist_edit_failed") });
    }
  };

  const handleTracksChanged = (tracks: VideoSummary[]) => {
    setVideos(tracks);
    if (storedPlaylist) {
      applyDetails({
        ...storedPlaylist,
        videoCount: tracks.length,
        videoCountText: formatVideoCountText(tracks.length),
      });
    }
  };

  const handleReorder = async (nextVideos: VideoSummary[]) => {
    // Account playlists keep the account's order; there is no reorder
    // API here, as Android does.
    if (isServerPlaylist) return;
    setVideos(nextVideos);
    if (storedPlaylist) {
      await updateStoredPlaylistTracks(storedPlaylist.id, nextVideos);
    }
  };

  const handleServerRemoveVideos = async (videos: VideoSummary[]): Promise<VideoSummary[]> => {
    if (!playlistId) throw new Error("No playlist");
    const removedIds = await useServerPlaylistsStore.getState().removeVideos(
      playlistId,
      videos.map((video) => video.id),
    );
    const removedSet = new Set(removedIds);
    const removed = videos.filter((video) => removedSet.has(video.id));
    if (removed.length === 0) throw new Error("The server refused the remove");
    // A local copy of this playlist stays in step, so it cannot resurrect
    // rows the account no longer holds.
    await updateStoredPlaylistTracks(playlistId, (tracks) => tracks.filter((track) => !removedSet.has(track.id)));
    setVideos((current) => current.filter((video) => !removedSet.has(video.id)));
    return removed;
  };

  const handleServerRestoreVideos = async (videos: VideoSummary[]): Promise<void> => {
    if (!playlistId) return;
    await useServerPlaylistsStore.getState().addVideos(playlistId, videos.map((video) => video.id));
    await updateStoredPlaylistTracks(playlistId, (tracks) => {
      const known = new Set(tracks.map((track) => track.id));
      return [...tracks, ...videos.filter((video) => !known.has(video.id))];
    });
    setVideos((current) => {
      const known = new Set(current.map((video) => video.id));
      return [...current, ...videos.filter((video) => !known.has(video.id))];
    });
  };

  const handleCopyLink = async () => {
    if (!meta) return;
    if (await copyText(youtubePlaylistUrl(meta.id))) {
      showToast({ variant: "success", message: getString('playlist_playlist_link_copied') });
    } else {
      showToast({ variant: "error", message: getString('playlist_could_not_copy_link') });
    }
  };

  const librarySummary = (): PlaylistSummary | null => meta && {
    type: "playlist",
    id: meta.id,
    title: meta.title,
    thumbnailUrl: heroThumbnailUrl ?? meta.thumbnailUrl ?? null,
    videoCountText: meta.videoCountText,
  };

  const handleSaveToLibrary = async () => {
    const summary = librarySummary();
    if (!meta || !summary) return;
    try {
      const playlists = await savePlaylistToLibrary(summary);
      const saved = playlists.find((playlist) => playlist.id === meta.id);
      if (saved) setVideos(saved.tracks);
      setSavedInLibrary(true);
      showToast({
        variant: "success",
        message: `Saved "${meta.title}" to library`,
      });
    } catch (saveError) {
      console.error("Failed to save playlist to library", saveError);
      showToast({ variant: "error", message: getString('playlist_could_not_save_playlist') });
    }
  };

  const handleRemoveFromLibrary = async () => {
    const summary = librarySummary();
    if (!meta || !summary || isProtected) return;
    if (!await confirmPlaylistRemoval(summary, isOwned || isServerPlaylist)) return;

    if (isServerPlaylist) {
      try {
        await useServerPlaylistsStore.getState().deletePlaylist(meta.id);
        showToast({
          variant: "success",
          message: `Deleted "${meta.title}"`,
        });
        navigate("/playlists");
      } catch (removeError) {
        console.error("Failed to delete playlist", removeError);
        showToast({ variant: "error", message: getString("playlist_delete_failed") });
      }
      return;
    }
    try {
      await removePlaylistFromLibrary(meta.id);
      setSavedInLibrary(false);
      showToast({
        variant: "success",
        message: isOwned
          ? `Deleted "${meta.title}"`
          : `Removed "${meta.title}" from library`,
      });
      navigate("/playlists");
    } catch (removeError) {
      console.error("Failed to remove playlist from library", removeError);
      showToast({ variant: "error", message: getString('playlist_could_not_update_library') });
    }
  };

  const editable = isProtected || isOwned || isServerPlaylist;
  const playlistContext = meta
    ? { id: meta.id, title: meta.title, editable, reorderable: editable && sortOrder === "manual" && !isServerPlaylist }
    : null;

  const playQueue = (shuffle: boolean) => {
    if (displayVideos.length === 0) return;
    const queue = shuffle
      ? fisherYates(displayVideos)
      : displayVideos;
    const first = queue[0];
    if (!first) return;
    setQueue(queue, 0, playlistContext, shuffle ? displayVideos : null);
    navigate(`/watch/${first.id}`);
  };

  const playFromPlaylist = (video: VideoSummary) => {
    const startIndex = displayVideos.findIndex((item) => item.id === video.id);
    const safeIndex = startIndex >= 0 ? startIndex : 0;
    setQueue(displayVideos, safeIndex, playlistContext);
    navigate(`/watch/${video.id}`);
  };

  // --- The server Watch Later list, while signed in. Its order is the
  // account's own, so there is no reordering, no selection bar and no
  // save-to-library: the list itself lives on the account. ---
  const serverMeta: PlaylistDetailsMeta = {
    id: WATCH_LATER_PLAYLIST_ID,
    title: serverWatchLater.title,
    description: null,
    channelName: "YouTube",
    viewCountText: null,
    videoCount: serverWatchLater.videos.length,
    videoCountText: formatVideoCountText(serverWatchLater.videos.length),
    thumbnailUrl: serverWatchLater.videos[0]?.thumbnailUrl ?? null,
    updatedLabel: "Built-in playlist",
  };
  const serverShownVideos = useMemo(
    () => filterVideosBySearch(serverWatchLater.videos, appliedSearch),
    [serverWatchLater.videos, appliedSearch],
  );
  const serverPlaylistContext = {
    id: WATCH_LATER_PLAYLIST_ID,
    title: serverWatchLater.title,
    editable: false,
    reorderable: false,
  };
  const serverPlayQueue = (shuffle: boolean) => {
    const list = serverWatchLater.videos;
    if (list.length === 0) return;
    const queue = shuffle ? fisherYates(list) : list;
    const first = queue[0];
    if (!first) return;
    setQueue(queue, 0, serverPlaylistContext, shuffle ? list : null);
    navigate(`/watch/${first.id}`);
  };
  const serverPlayFromPlaylist = (video: VideoSummary) => {
    const list = serverWatchLater.videos;
    const startIndex = list.findIndex((item) => item.id === video.id);
    const safeIndex = startIndex >= 0 ? startIndex : 0;
    setQueue(list, safeIndex, serverPlaylistContext);
    navigate(`/watch/${video.id}`);
  };
  const handleServerDownload = () => {
    if (serverWatchLater.videos.length === 0) return;
    openCollectionDownload({
      kind: "playlist",
      meta: {
        collectionId: WATCH_LATER_PLAYLIST_ID,
        title: serverWatchLater.title,
        author: "YouTube",
        thumbnailUrl: serverWatchLater.videos[0]?.thumbnailUrl ?? undefined,
      },
      load: () =>
        serverWatchLater.hasMore
          ? serverWatchLater.loadAll().catch(() => serverWatchLater.videos)
          : Promise.resolve(serverWatchLater.videos),
    });
  };
  const handleServerCopyLink = async () => {
    // The account's Watch Later, addressed as the WL playlist.
    if (await copyText(youtubePlaylistUrl("WL"))) {
      showToast({ variant: "success", message: getString("playlist_playlist_link_copied") });
    } else {
      showToast({ variant: "error", message: getString("playlist_could_not_copy_link") });
    }
  };

  if (showServerWatchLater) {
    if (serverWatchLater.loading) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
          <p className="text-sm font-medium text-chrome-neutral-500">{getString('playlist_loading_playlist')}</p>
        </div>
      );
    }

    if (serverWatchLater.error) {
      return (
        <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-chrome-neutral-400">{serverWatchLater.error}</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-4 text-sm font-medium text-[var(--color-primary)] transition-colors hover:opacity-90"
          >
            Go back
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="mx-auto grid h-full min-h-0 w-full max-w-[1600px] grid-cols-1 gap-8 p-6 lg:grid-cols-[360px_1fr]">
          <PlaylistAmbientHeader
            meta={serverMeta}
            heroVideoId={serverWatchLater.videos[0]?.id}
            heroThumbnailUrl={serverWatchLater.videos[0]?.thumbnailUrl ?? null}
            canPlay={serverWatchLater.videos.length > 0}
            onPlayAll={() => serverPlayQueue(false)}
            onShuffle={() => serverPlayQueue(true)}
            onDownload={() => void handleServerDownload()}
            downloadActive={downloadState.active}
            downloadComplete={downloadState.isComplete}
            onAddToQueue={() => addVideosToQueueWithToast(serverWatchLater.videos)}
            onCopyLink={() => void handleServerCopyLink()}
            isSaved
            isProtected
          />

          <PlaylistSortableList
            videos={serverWatchLater.videos}
            displayVideos={serverShownVideos}
            sortOrder="manual"
            sortOptions={["manual"]}
            onSortChange={() => undefined}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            reorderable={false}
            onReorder={() => undefined}
            onPlay={serverPlayFromPlaylist}
            onAddToQueue={onAddToQueue}
            selecting={false}
            selectedIds={EMPTY_SELECTION}
            onToggleSelected={() => undefined}
            onStartSelecting={() => undefined}
            footer={
              <PlaylistLoadMore
                hasMore={serverWatchLater.hasMore}
                loading={serverWatchLater.loadingMore}
                failed={serverWatchLater.loadMoreFailed}
                onLoadMore={() => void serverWatchLater.loadMore()}
              />
            }
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={36} />
        <p className="text-sm font-medium text-chrome-neutral-500">{getString('playlist_loading_playlist')}</p>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-chrome-neutral-400">{error ?? "Playlist not found."}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-sm font-medium text-[var(--color-primary)] transition-colors hover:opacity-90"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1600px] grid-cols-1 gap-8 p-6 lg:grid-cols-[360px_1fr]">
          <PlaylistAmbientHeader
            meta={meta}
            heroVideoId={leadVideo?.id}
            heroThumbnailUrl={heroThumbnailUrl}
          canPlay={displayVideos.length > 0}
          onPlayAll={() => playQueue(false)}
          onShuffle={() => playQueue(true)}
          onDownload={() => void handleDownloadPlaylist()}
          downloadActive={downloadState.active}
          downloadComplete={downloadState.isComplete}
          onAddToQueue={() => addVideosToQueueWithToast(displayVideos)}
          onCopyLink={handleCopyLink}
          onSaveToLibrary={handleSaveToLibrary}
          onRemoveFromLibrary={handleRemoveFromLibrary}
          onEdit={() => setEditing(true)}
          onAddAll={() => setAddingAll(true)}
          onExport={() => void handleExport()}
          hidesUnavailable={hidesUnavailable}
          isSaved={savedInLibrary || isServerPlaylist}
          isProtected={isProtected}
          isOwned={isOwned || isServerPlaylist}
        />

        <PlaylistSortableList
          videos={videos}
          displayVideos={shownVideos}
          sortOrder={sortOrder}
          sortOptions={availablePlaylistSortOrders(isLocalPlaylist)}
          onSortChange={handleSortChange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          reorderable={!isServerPlaylist}
          onReorder={handleReorder}
          onPlay={playFromPlaylist}
          onAddToQueue={onAddToQueue}
          selecting={selection.selecting}
          selectedIds={selection.selectedIds}
          onToggleSelected={selection.toggle}
          onStartSelecting={selection.start}
          selectionBar={
            <PlaylistSelectionActions
              playlistId={meta.id}
              editable={editable}
              selected={selectedVideos}
              allSelected={selection.allSelected}
              onToggleAll={() => selection.toggleAll(shownIds)}
              onDone={selection.stop}
              onTracksChanged={handleTracksChanged}
              onRemoveFromServer={isServerPlaylist ? handleServerRemoveVideos : undefined}
              onRestoreToServer={isServerPlaylist ? handleServerRestoreVideos : undefined}
            />
          }
          footer={
            <PlaylistLoadMore
              hasMore={hasMore}
              loading={loadingMore}
              failed={loadMoreFailed}
              onLoadMore={() => void loadMore()}
            />
          }
        />
      </div>

      {editing && (
        <PlaylistFormDialog
          title={getString("playlist_edit")}
          confirmLabel={getString("save")}
          initialName={meta.title}
          initialDescription={meta.description ?? ""}
          onSubmit={handleSaveDetails}
          onCancel={() => setEditing(false)}
        />
      )}
      {addingAll && (
        <AddAllToPlaylistDialog
          excludePlaylistId={meta.id}
          loadVideos={() => (hasMore ? loadAllVideos() : Promise.resolve(videos))}
          onClose={() => setAddingAll(false)}
        />
      )}
    </div>
  );
}

export default PlaylistDetailsPage;
