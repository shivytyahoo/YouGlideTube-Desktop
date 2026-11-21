import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  addVideoToServerPlaylist,
  addVideosToServerPlaylist,
  createServerPlaylist,
  deleteServerPlaylist,
  getAccountSignedIn,
  getServerPlaylists,
  isSignedOutError,
  removeVideoFromServerPlaylist,
  removeVideosFromServerPlaylist,
  renameServerPlaylist,
} from "../lib/api/account";
import {
  GOOGLE_ACCOUNT_SWITCHED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
} from "../lib/useGoogleAccount";
import {
  formatVideoCountText,
  parseVideoCountFromText,
} from "../lib/playlistLibrary";
import type { PlaylistSummary } from "../types/video";

/** The account's system playlists, addressed directly by the server. */
export const SERVER_PLAYLIST_IDS = {
  WATCH_LATER: "WL",
  LIKED_VIDEOS: "LL",
  LIKED_MUSIC: "LM",
} as const;

export const isSystemServerPlaylistId = (playlistId: string) =>
  playlistId === SERVER_PLAYLIST_IDS.WATCH_LATER ||
  playlistId === SERVER_PLAYLIST_IDS.LIKED_VIDEOS ||
  playlistId === SERVER_PLAYLIST_IDS.LIKED_MUSIC;

/** The aggregation answers at most this many pages; Android caps the same walk. */
const MAX_PAGES = 5;

interface ServerPlaylistsState {
  playlists: PlaylistSummary[];
  loaded: boolean;
  loading: boolean;
  /** Reads the account's list once (signed out it stays empty) and merges it in. */
  load: () => Promise<void>;
  /** Re-reads the account's list from the server. */
  refresh: () => Promise<void>;
  /** Creates a playlist on the account and returns it. */
  create: (name: string) => Promise<PlaylistSummary>;
  /** Deletes a playlist from the account; a refused delete puts it back. */
  deletePlaylist: (playlistId: string) => Promise<void>;
  /** Renames a playlist on the account. */
  rename: (playlistId: string, name: string) => Promise<void>;
  addVideo: (playlistId: string, videoId: string) => Promise<void>;
  removeVideo: (playlistId: string, videoId: string) => Promise<void>;
  addVideos: (playlistId: string, videoIds: string[]) => Promise<string[]>;
  removeVideos: (playlistId: string, videoIds: string[]) => Promise<string[]>;
  /** Whether the id is one of the account's playlists (system lists included). */
  isServerPlaylist: (playlistId: string) => boolean;
}

// Ids deleted in this process: a merge must never resurrect them, and the
// server cannot be asked whether a missing playlist was deleted or merely
// left out of a truncated aggregation response. Ids the user unsaved in
// this process: the merge must not carry them forward once the server
// stops listing them — but a fresh response still wins, so an own
// playlist the server keeps listing stays listed. Android's
// `AccountPlaylists` keeps the same two sets.
const removedIds = new Set<string>();
const unsavedIds = new Set<string>();

/** Shared by concurrent `load()` calls so a burst cannot stack up reads. */
let inFlight: Promise<void> | null = null;

function bumpCount(
  playlists: PlaylistSummary[],
  playlistId: string,
  delta: number,
): PlaylistSummary[] {
  if (delta === 0) return playlists;
  return playlists.map((playlist) => {
    if (playlist.id !== playlistId) return playlist;
    const count = Math.max(
      0,
      (parseVideoCountFromText(playlist.videoCountText) ?? 0) + delta,
    );
    return { ...playlist, videoCountText: formatVideoCountText(count) };
  });
}

export const useServerPlaylistsStore = create<ServerPlaylistsState>((set, get) => ({
  playlists: [],
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loaded || inFlight) return inFlight ?? Promise.resolve();
    inFlight = (async () => {
      set({ loading: true });
      try {
        if (!(await getAccountSignedIn().catch(() => false))) {
          set({ playlists: [], loaded: true });
          return;
        }
        await get().refresh();
        set({ loaded: true });
      } finally {
        set({ loading: false });
        inFlight = null;
      }
    })();
    return inFlight;
  },

  refresh: async () => {
    if (!(await getAccountSignedIn().catch(() => false))) {
      set({ playlists: [] });
      return;
    }
    const fresh: PlaylistSummary[] = [];
    let continuation: string | null = null;
    let pages = 0;
    try {
      do {
        const page = await getServerPlaylists(continuation ?? undefined);
        // The backend's playlist rows carry no `type`; the cards read it.
        fresh.push(
          ...page.playlists.map((playlist) => ({ ...playlist, type: "playlist" as const })),
        );
        continuation = page.continuation ?? null;
        pages += 1;
      } while (continuation && pages < MAX_PAGES);
    } catch (error) {
      // A failed re-read leaves the last good list in place: blanking the
      // page on a transient failure looks exactly like playlists vanishing.
      if (isSignedOutError(error)) set({ playlists: [] });
      return;
    }
    // The server's aggregation is not stable: the same request returns a
    // different count each session, with no continuation, and it omits a
    // playlist just emptied. Replacing the list would drop playlists the
    // account still has, so the fresh response only updates what it
    // carries and the rest is kept — except ids the user unsaved, which
    // the fresh response may still carry for an own playlist.
    const current = get().playlists;
    const merged = [
      ...fresh,
      ...current.filter(
        (playlist) =>
          !fresh.some((known) => known.id === playlist.id) &&
          !unsavedIds.has(playlist.id),
      ),
    ]
      .filter((playlist) => !removedIds.has(playlist.id))
      .filter(
        (playlist, index, all) =>
          all.findIndex((known) => known.id === playlist.id) === index,
      );
    set({ playlists: merged });
  },

  create: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A playlist needs a title");
    const playlistId = await createServerPlaylist(trimmed);
    const entry: PlaylistSummary = {
      type: "playlist",
      id: playlistId,
      title: trimmed,
      thumbnailUrl: null,
      videoCountText: formatVideoCountText(0),
    };
    // The new playlist shows at once instead of after the next list
    // re-read, which may not even carry it.
    removedIds.delete(playlistId);
    unsavedIds.delete(playlistId);
    set({ playlists: [entry, ...get().playlists] });
    void get().refresh().catch(() => undefined);
    return entry;
  },

  deletePlaylist: async (playlistId) => {
    // The tombstone goes first and the server call follows, so the
    // playlist leaves the list the moment Delete is tapped; a refused
    // delete puts it back instead of vanishing one that still exists.
    removedIds.add(playlistId);
    set({ playlists: get().playlists.filter((playlist) => playlist.id !== playlistId) });
    try {
      await deleteServerPlaylist(playlistId);
      void get().refresh().catch(() => undefined);
    } catch (error) {
      removedIds.delete(playlistId);
      await get().refresh().catch(() => undefined);
      throw error;
    }
  },

  rename: async (playlistId, name) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A playlist needs a title");
    await renameServerPlaylist(playlistId, trimmed);
    set({
      playlists: get().playlists.map((playlist) =>
        playlist.id === playlistId ? { ...playlist, title: trimmed } : playlist,
      ),
    });
    void get().refresh().catch(() => undefined);
  },

  addVideo: async (playlistId, videoId) => {
    await addVideoToServerPlaylist(playlistId, videoId);
    set({ playlists: bumpCount(get().playlists, playlistId, 1) });
  },

  removeVideo: async (playlistId, videoId) => {
    await removeVideoFromServerPlaylist(playlistId, videoId);
    set({ playlists: bumpCount(get().playlists, playlistId, -1) });
  },

  addVideos: async (playlistId, videoIds) => {
    const taken = await addVideosToServerPlaylist(playlistId, videoIds);
    set({ playlists: bumpCount(get().playlists, playlistId, taken.length) });
    return taken;
  },

  removeVideos: async (playlistId, videoIds) => {
    const removed = await removeVideosFromServerPlaylist(playlistId, videoIds);
    set({ playlists: bumpCount(get().playlists, playlistId, -removed.length) });
    return removed;
  },

  isServerPlaylist: (playlistId) =>
    isSystemServerPlaylistId(playlistId) ||
    get().playlists.some((playlist) => playlist.id === playlistId),
}));

// The active account changed: the list belongs to the new account now, so
// the next reader fetches it again instead of showing the old account's.
if (typeof window !== "undefined") {
  const invalidate = () => {
    removedIds.clear();
    unsavedIds.clear();
    useServerPlaylistsStore.setState({ playlists: [], loaded: false });
    void useServerPlaylistsStore.getState().load().catch(() => undefined);
  };
  listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, invalidate).catch(() => undefined);
  listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, invalidate).catch(() => undefined);
}
