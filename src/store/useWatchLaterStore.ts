import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

import { getAccountSignedIn, getWatchLater, setVideoWatchLater } from "../lib/api/account";
import {
  GOOGLE_ACCOUNT_SWITCHED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
} from "../lib/useGoogleAccount";
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

/** Whether the server list has been read once this session (see `load`). */
let serverSynced = false;

async function readWatchLaterIds(): Promise<Set<string>> {
  const playlists = await loadStoredPlaylists();
  const watchLater = playlists.find((playlist) => playlist.id === WATCH_LATER_PLAYLIST_ID);
  return new Set(watchLater?.tracks.map((track) => track.id) ?? []);
}

/**
 * The playlist-entry id of a video on the server's Watch Later list, read
 * from the list itself (at most 5 pages). `found` false means the server
 * no longer carries the video; a found row without an entry id cannot be
 * removed until the list is re-read.
 */
async function resolveServerSetVideoId(
  videoId: string,
): Promise<{ found: boolean; setVideoId: string | null }> {
  let continuation: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const list = await getWatchLater(continuation ?? undefined);
    const row = list.videos.find((item) => item.video.id === videoId);
    if (row) return { found: true, setVideoId: row.setVideoId ?? null };
    continuation = list.continuation ?? null;
    if (!continuation) break;
  }
  return { found: false, setVideoId: null };
}

export const useWatchLaterStore = create<WatchLaterState>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,
  serverSetVideoIds: {},
  serverVersion: 0,

  // The server map is the source of truth for membership: a video saved
  // on the phone shows on /watch-later but its card said "Save to Watch
  // Later" and tapping it issued a duplicate server add. The map's keys
  // join the local set, so the label and the toggle follow the account.
  setServerSetVideoIds: (map) =>
    set((state) => ({
      serverSetVideoIds: map,
      ids: new Set([...state.ids, ...Object.keys(map)]),
    })),

  load: async () => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const localIds = await readWatchLaterIds();
        let ids = localIds;
        // Signed in, the server list joins the local mirror once a
        // session: the first page carries the newest saves, which is
        // what the card labels need. The Watch Later page still reads
        // the whole list when it opens. A failed read retries on the
        // next load instead of leaving every card mislabelled.
        if (!serverSynced && (await getAccountSignedIn().catch(() => false))) {
          serverSynced = true;
          try {
            const page = await getWatchLater();
            const map: Record<string, string | null> = {};
            for (const item of page.videos) map[item.video.id] = item.setVideoId ?? null;
            set({ serverSetVideoIds: map });
            ids = new Set([...localIds, ...Object.keys(map)]);
          } catch (error) {
            serverSynced = false;
            console.warn("Failed to sync Watch Later with the server", error);
          }
        }
        set({ ids, loaded: true });
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
        // On the server now, with no entry id yet: the next remove
        // resolves it from the list instead of treating the save as local.
        set((state) => ({
          serverVersion: state.serverVersion + 1,
          serverSetVideoIds: { ...state.serverSetVideoIds, [video.id]: null },
        }));
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
          let setVideoId = serverEntries[videoId];
          if (!setVideoId) {
            // Saved this session (or read without an entry id): resolve
            // it from the list. A video the server no longer carries is
            // a stale entry and is removed locally only.
            const resolved = await resolveServerSetVideoId(videoId);
            if (resolved.found && resolved.setVideoId) {
              setVideoId = resolved.setVideoId;
            } else if (resolved.found) {
              throw new WatchLaterRemoveNeedsRefreshError();
            }
          }
          if (setVideoId) {
            await setVideoWatchLater(videoId, false, setVideoId);
            set((state) => {
              const entries = { ...state.serverSetVideoIds };
              delete entries[videoId];
              return { serverVersion: state.serverVersion + 1, serverSetVideoIds: entries };
            });
          }
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
  // The active account changed: the server list belongs to the new account
  // now, so the mirror is re-read instead of showing the old account's.
  const resync = () => {
    serverSynced = false;
    useWatchLaterStore.setState({ serverSetVideoIds: {} });
    void useWatchLaterStore.getState().load().catch(() => undefined);
  };
  listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, resync).catch(() => undefined);
  listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, resync).catch(() => undefined);
}
