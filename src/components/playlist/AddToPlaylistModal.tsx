import React, { useEffect, useMemo, useState } from "react";
import { ListVideo, Plus, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import { PlaylistChoiceCard } from "./PlaylistChoiceCard";
import { getAccountSignedIn } from "../../lib/api/account";
import {
  addVideoToStoredPlaylist,
  createStoredPlaylist,
  isProtectedPlaylistId,
  loadStoredPlaylists,
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  serverPlaylistToStored,
  updateStoredPlaylistTracks,
  type StoredPlaylist,
} from "../../lib/playlistLibrary";
import { usePlaylistModalStore } from "../../store/usePlaylistModalStore";
import { useServerPlaylistsStore, isSystemServerPlaylistId } from "../../store/useServerPlaylistsStore";
import { useWatchLaterStore } from "../../store/useWatchLaterStore";
import { useUiStore } from "../../store/useUiStore";
import { showSaveFailedToast, showSaveToast, type SaveDestination } from "../../lib/saveToast";

export function AddToPlaylistModal() {
  const addTarget = usePlaylistModalStore((s) => s.addTarget);
  const closeAddToPlaylist = usePlaylistModalStore((s) => s.closeAddToPlaylist);
  const showToast = useUiStore((s) => s.showToast);

  const [playlists, setPlaylists] = useState<StoredPlaylist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const serverPlaylists = useServerPlaylistsStore((s) => s.playlists);
  const loadServerPlaylists = useServerPlaylistsStore((s) => s.load);

  // The account's playlists join this device's own: a save here is a
  // server save, so the video shows on the playlist page and on the phone.
  // System lists are not save targets here — Watch Later has its own row
  // and Liked videos is a like, not a playlist.
  const selectablePlaylists = useMemo(() => {
    const local = playlists.filter((playlist) => playlist.source === "Owned");
    const localIds = new Set(local.map((playlist) => playlist.id));
    const server = serverPlaylists
      .filter((playlist) => !isSystemServerPlaylistId(playlist.id) && !localIds.has(playlist.id))
      .map(serverPlaylistToStored);
    return [...local, ...server];
  }, [playlists, serverPlaylists]);

  const load = async () => {
    try {
      setPlaylists(await loadStoredPlaylists());
    } catch (error) {
      console.warn("Failed to load playlists for add modal", error);
      setPlaylists([]);
    }
  };

  useEffect(() => {
    if (!addTarget) return;
    void load();
    void loadServerPlaylists();

    window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, load);
    return () => window.removeEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, load);
  }, [addTarget, loadServerPlaylists]);

  if (!addTarget) return null;

  const close = () => {
    setCreating(false);
    setNewName("");
    closeAddToPlaylist();
  };

  const item = { title: addTarget.title, image: addTarget.thumbnailUrl, shape: "landscape" as const };
  const video = addTarget;

  const destinationFor = (playlistId: string, name: string): SaveDestination => (
    isProtectedPlaylistId(playlistId) ? { kind: "watchLater" } : { kind: "playlist", id: playlistId, name }
  );

  const undoAdd = (playlistId: string) => {
    if (isProtectedPlaylistId(playlistId)) {
      return useWatchLaterStore.getState().remove(video.id);
    }
    if (useServerPlaylistsStore.getState().isServerPlaylist(playlistId)) {
      return useServerPlaylistsStore.getState().removeVideo(playlistId, video.id);
    }
    return updateStoredPlaylistTracks(playlistId, (tracks) => tracks.filter((track) => track.id !== video.id));
  };

  const handleAdd = async (playlistId: string) => {
    const playlist = selectablePlaylists.find((stored) => stored.id === playlistId);
    const destination = destinationFor(playlistId, playlist?.name ?? "");
    const isServer = useServerPlaylistsStore.getState().isServerPlaylist(playlistId);
    // Watch Later membership is known from the store's server-synced set;
    // a server playlist's rows are not read here, so membership is
    // unknown and no undo is offered for it — undoing an add of a video
    // that was already there would remove the row that was there before.
    const alreadyThere = isProtectedPlaylistId(playlistId)
      ? useWatchLaterStore.getState().ids.has(video.id)
      : !!playlist?.tracks.some((track) => track.id === video.id);
    try {
      if (isProtectedPlaylistId(playlistId)) {
        await useWatchLaterStore.getState().add(video);
      } else if (isServer) {
        await useServerPlaylistsStore.getState().addVideo(playlistId, video.id);
      } else {
        const updated = await addVideoToStoredPlaylist(playlistId, video);
        if (!updated) throw new Error("Playlist not found");
      }

      showSaveToast({
        destination,
        item,
        undo: alreadyThere || isServer ? undefined : () => void undoAdd(playlistId),
      });
      close();
    } catch (error) {
      console.error("Failed to add video to playlist", error);
      showSaveFailedToast({ destination, item, retry: () => handleAdd(playlistId) });
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    try {
      if (await getAccountSignedIn().catch(() => false)) {
        // Signed in, the playlist is created on the account, as Android
        // does — not a local list the phone never sees.
        const playlist = await useServerPlaylistsStore.getState().create(name);
        await useServerPlaylistsStore.getState().addVideo(playlist.id, video.id);
        showSaveToast({
          destination: destinationFor(playlist.id, playlist.title),
          item,
        });
      } else {
        const playlist = await createStoredPlaylist(name);
        await addVideoToStoredPlaylist(playlist.id, video);
        showSaveToast({
          destination: destinationFor(playlist.id, playlist.name),
          item,
          undo: () => void undoAdd(playlist.id),
        });
      }
      close();
    } catch (error) {
      console.error("Failed to create playlist", error);
      showToast({
        variant: "error",
        message: getString("video_add_to_playlist_failed"),
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={getString("playlist_add_modal_title")}
        className="w-full max-w-sm rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-chrome-neutral-100">
              {getString("playlist_add_modal_title")}
            </h3>
            <p dir="auto" className="mt-0.5 line-clamp-1 text-sm text-chrome-neutral-400">{addTarget.title}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={getString("cancel")}
            className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
          {selectablePlaylists.map((playlist) => (
            <PlaylistChoiceCard
              key={playlist.id}
              fallbackThumbnailUrl={addTarget.thumbnailUrl}
              playlist={playlist}
              onClick={() => void handleAdd(playlist.id)}
            />
          ))}

          {selectablePlaylists.length === 0 && !creating && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-chrome-neutral-800 px-4 py-8 text-center">
              <ListVideo className="h-6 w-6 text-chrome-neutral-600" />
              <p className="text-sm text-chrome-neutral-500">{getString("playlist_add_modal_empty")}</p>
            </div>
          )}
        </div>

        {creating ? (
          <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={getString("playlist_name_placeholder")}
              className="w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 text-sm text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                onClick={() => setCreating(false)}
                variant="ghost"
                size="sm"
                className="text-sm text-chrome-neutral-300"
              >
                {getString("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!newName.trim()}
                size="sm"
                className="px-4 text-sm"
              >
                {getString("playlist_create")}
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-lg p-2 text-start text-sm font-medium text-[var(--color-primary)] transition-colors hover:bg-surface-container-high"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-container-high">
              <Plus size={18} />
            </span>
            {getString("playlist_add_modal_create")}
          </button>
        )}
      </div>
    </div>
  );
}

export default AddToPlaylistModal;
