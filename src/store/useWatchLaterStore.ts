import { create } from "zustand";

import { getAccountSignedIn, setVideoWatchLater } from "../lib/api/account";
import {
  PLAYLIST_LIBRARY_UPDATED_EVENT,
  WATCH_LATER_PLAYLIST_ID,
  addVideoToWatchLater,
  loadStoredPlaylists,
  removeVideoFromWatchLater,
} from "../lib/playlistLibrary";
import type { VideoSummary } from "../types/video";
import { recapVideoAction } from "../lib/recap/recapQueue";

/**
 * Removing a video the server's Watch Later list carries but whose
 * playlist-entry id was never read (a lockup row the extractor couldn't
 * match) needs the entry id first. Callers show a "reopen Watch Later"
 * hint for this instead of a retry.
 */
export class WatchLaterRemoveNeedsRefreshError extends Error {
  constructor() {
    super("Removing this video needs its Watch Later entry id — reopen Watch Later first.");
    this.name = "WatchLaterRemoveNeedsRefreshError";
  }
}

/**
 * Watch Later membership as a set of video ids.
 *
 * Every video card needs this to label one context-menu entry. Resolving it per
 * card meant `getSetting` — an IPC round trip — plus a `JSON.parse` of the
 * *entire* playlist library, once for each of the several hundred cards a feed
 * mounts. One read into a shared set replaces all of it, and membership becomes
 * a synchronous lookup.
 */
interface WatchLaterState {
  ids: Set<string>;
  loaded: boolean;
  /**
   * The server Watch Later list the page last read: videoId -> the
   * playlist-entry id a server remove needs (null when the row carried
   * none). Presence in the map means the server carries the video.
   */
  serverSetVideoIds: Record<string, string | null>;
  /** Bumped after a server add/remove, so the Watch Later page reloads its list. */
  serverVersion: number;
  /** Replaces the server map with what the Watch Later page just read. */
  setServerSetVideoIds: (map: Record<string, string | null>) => void;
  /** Reads the library and replaces the set. Concurrent calls share one read. */
  load: () => Promise<void>;
  add: (video: VideoSummary) => Promise<void>;
  remove: (videoId: string) => Promise<void>;
}

/** Shared by concurrent `load()` calls so a burst cannot stack up reads. */
let inFlight: Promise<void> | null = null;

async function readWatchLaterIds(): Promise<Set<string>> {
  const playlists = await loadStoredPlaylists();
  const watchLater = playlists.find((playlist) => playlist.id === WATCH_LATER_PLAYLIST_ID);
  return new Set(watchLater?.tracks.map((track) => track.id) ?? []);
}

export const useWatchLaterStore = create<WatchLaterState>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,
  serverSetVideoIds: {},
  serverVersion: 0,

  setServerSetVideoIds: (map) => set({ serverSetVideoIds: map }),

  load: async () => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        set({ ids: await readWatchLaterIds(), loaded: true });
      } catch (error) {
        console.warn("Failed to load Watch Later", error);
        // Leave the previous set in place: a stale label beats dropping every
        // card's saved state because one read failed.
        set({ loaded: true });
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  },

  /*
    Optimistic, then reconciled: `persistStoredPlaylists` dispatches the library
    event on success, which reloads from disk. Only a throw needs the rollback,
    since in that case the event never fires. Signed in, the server is the
    source of truth: the save goes there first, and a failed server save rolls
    the local save back too.
  */
  add: async (video) => {
    const previous = get().ids;
    if (previous.has(video.id)) return;
    set({ ids: new Set(previous).add(video.id) });
    try {
      if (await getAccountSignedIn()) {
        await setVideoWatchLater(video.id, true);
        set((state) => ({ serverVersion: state.serverVersion + 1 }));
      }
      await addVideoToWatchLater(video);
      recapVideoAction(video, "SAVE");
    } catch (error) {
      set({ ids: previous });
      throw error;
    }
  },

  remove: async (videoId) => {
    const previous = get().ids;
    if (!previous.has(videoId)) return;
    const next = new Set(previous);
    next.delete(videoId);
    set({ ids: next });
    try {
      if (await getAccountSignedIn()) {
        const serverEntries = get().serverSetVideoIds;
        if (videoId in serverEntries) {
          const setVideoId = serverEntries[videoId];
          if (!setVideoId) throw new WatchLaterRemoveNeedsRefreshError();
          await setVideoWatchLater(videoId, false, setVideoId);
          set((state) => ({ serverVersion: state.serverVersion + 1 }));
        }
        // Not on the server list: a local-only save, removed locally.
      }
      await removeVideoFromWatchLater(videoId);
    } catch (error) {
      set({ ids: previous });
      throw error;
    }
  },
}));

/*
  Every write path — the cards, the library pages, a data import, a sync merge
  from the Android app — funnels through `persistStoredPlaylists`, which fires
  this event. Listening here is what keeps the set correct without any caller
  having to remember to invalidate it.
*/
if (typeof window !== "undefined") {
  window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, () => {
    if (useWatchLaterStore.getState().loaded) {
      void useWatchLaterStore.getState().load();
    }
  });
}
