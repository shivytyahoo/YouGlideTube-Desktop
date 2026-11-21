import { getPlural, getString } from "./i18n/index";
import {
  addVideosToServerPlaylist,
  getAccountSignedIn,
} from "./api/account";
import {
  WATCH_LATER_PLAYLIST_ID,
  addVideosToStoredPlaylist,
  createStoredPlaylist,
  isProtectedPlaylistId,
  type StoredPlaylist,
} from "./playlistLibrary";
import { destinationPath } from "./saveToast";
import { useUiStore } from "../store/useUiStore";
import {
  SERVER_PLAYLIST_IDS,
  useServerPlaylistsStore,
} from "../store/useServerPlaylistsStore";
import { useWatchLaterStore } from "../store/useWatchLaterStore";
import type { VideoSummary } from "../types/video";

/** Copies `videos` into a playlist and says how that went; false when it could not be saved. */
export async function addVideosToPlaylistWithToast(
  target: Pick<StoredPlaylist, "id" | "name">,
  videos: VideoSummary[],
): Promise<boolean> {
  if (isProtectedPlaylistId(target.id)) {
    return addVideosToWatchLaterWithToast(videos);
  }
  if (useServerPlaylistsStore.getState().isServerPlaylist(target.id)) {
    return addVideosToServerPlaylistWithToast(target, videos);
  }
  const { showToast } = useUiStore.getState();
  try {
    const result = await addVideosToStoredPlaylist(target.id, videos);
    if (!result) throw new Error("Playlist not found");
    const path = destinationPath({ kind: "playlist", id: target.id, name: target.name });
    showToast({
      variant: result.added > 0 ? "success" : "info",
      message: result.added > 0
        ? getPlural("merge_playlist_success", result.added, target.name)
        : getString("merge_playlist_already_there", target.name),
      actions: result.added > 0 && path ? [{ label: getString("toast_view"), to: path }] : [],
    });
    return true;
  } catch (error) {
    console.error("Failed to add videos to a playlist", error);
    showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}

/**
 * Copies `videos` onto a playlist on the account in one server call, as
 * Android's `addVideosToPlaylist` does — so the videos show on the
 * playlist page and on the phone, not just on this device.
 */
export async function addVideosToServerPlaylistWithToast(
  target: { id: string; name: string },
  videos: VideoSummary[],
): Promise<boolean> {
  const { showToast } = useUiStore.getState();
  try {
    const taken = await addVideosToServerPlaylist(
      target.id,
      videos.map((video) => video.id),
    );
    const path = destinationPath({ kind: "playlist", id: target.id, name: target.name });
    showToast({
      variant: taken.length > 0 ? "success" : "info",
      message: taken.length > 0
        ? getPlural("merge_playlist_success", taken.length, target.name)
        : getString("merge_playlist_already_there", target.name),
      actions: taken.length > 0 && path ? [{ label: getString("toast_view"), to: path }] : [],
    });
    return true;
  } catch (error) {
    console.error("Failed to add videos to a playlist", error);
    showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}

/**
 * Copies `videos` into Watch Later on the account in one server call.
 * Rows already saved are skipped first: a second server add of the same
 * video is a duplicate row, not a no-op. The local copy follows, so the
 * card labels and the shelf stay right.
 */
export async function addVideosToWatchLaterWithToast(
  videos: VideoSummary[],
): Promise<boolean> {
  const { showToast } = useUiStore.getState();
  try {
    const signedIn = await getAccountSignedIn().catch(() => false);
    if (!signedIn) {
      const result = await addVideosToStoredPlaylist(WATCH_LATER_PLAYLIST_ID, videos);
      if (!result) throw new Error("Playlist not found");
      const path = destinationPath({ kind: "watchLater" });
      showToast({
        variant: result.added > 0 ? "success" : "info",
        message: result.added > 0
          ? getPlural("merge_playlist_success", result.added, "Watch Later")
          : getString("merge_playlist_already_there", "Watch Later"),
        actions: result.added > 0 && path ? [{ label: getString("toast_view"), to: path }] : [],
      });
      return true;
    }
    const fresh = videos.filter(
      (video) => !useWatchLaterStore.getState().ids.has(video.id),
    );
    if (fresh.length === 0) {
      showToast({
        variant: "info",
        message: getString("merge_playlist_already_there", "Watch Later"),
      });
      return true;
    }
    const taken = await addVideosToServerPlaylist(
      SERVER_PLAYLIST_IDS.WATCH_LATER,
      fresh.map((video) => video.id),
    );
    await addVideosToStoredPlaylist(WATCH_LATER_PLAYLIST_ID, fresh);
    const path = destinationPath({ kind: "watchLater" });
    showToast({
      variant: taken.length > 0 ? "success" : "info",
      message: taken.length > 0
        ? getPlural("merge_playlist_success", taken.length, "Watch Later")
        : getString("merge_playlist_already_there", "Watch Later"),
      actions: taken.length > 0 && path ? [{ label: getString("toast_view"), to: path }] : [],
    });
    return true;
  } catch (error) {
    console.error("Failed to add videos to Watch Later", error);
    showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}

/** Makes a playlist and copies `videos` onto it. */
export async function createPlaylistWithVideos(
  name: string,
  description: string,
  videos: VideoSummary[],
): Promise<boolean> {
  try {
    if (await getAccountSignedIn().catch(() => false)) {
      // Signed in, the playlist is created on the account, as Android
      // does — the description stays local-only, the account API takes a
      // title only.
      const playlist = await useServerPlaylistsStore.getState().create(name);
      return addVideosToServerPlaylistWithToast(
        { id: playlist.id, name: playlist.title },
        videos,
      );
    }
    return await addVideosToPlaylistWithToast(await createStoredPlaylist(name, description), videos);
  } catch (error) {
    console.error("Failed to create a playlist", error);
    useUiStore.getState().showToast({ variant: "error", message: getString("merge_playlist_failed") });
    return false;
  }
}
