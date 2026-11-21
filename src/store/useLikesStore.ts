import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isLocalMediaId } from "../lib/localMediaId";
import { getSetting, setSetting } from "../lib/api/db";
import { getAccountSignedIn, getLikedVideos, setVideoLiked } from "../lib/api/account";
import { getLikedMusic, getMusicQueue, setMusicLiked } from "../lib/api/music";
import {
  GOOGLE_ACCOUNT_SWITCHED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
} from "../lib/useGoogleAccount";
import { autoDownloadLikedSong } from "../lib/autoDownload";
import { getString } from "../lib/i18n/index";
import { recapLikedSong } from "../lib/recap/musicSession";
import { useUiStore } from "./useUiStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

export const LIKES_LIBRARY_UPDATED_EVENT = "youglidetube:likes-library-updated";
const LIKES_SETTING_KEY = "liked_items";

export type LikedItemKind = "video" | "music";

export interface LikedVideoItem {
  kind: "video";
  id: string;
  likedAt: string;
  video: VideoSummary;
}

export interface LikedMusicItem {
  kind: "music";
  id: string;
  likedAt: string;
  song: SongItem;
}

export type LikedItem = LikedVideoItem | LikedMusicItem;

const songId = (song: SongItem) => song.videoId ?? song.id;
const itemKey = (kind: LikedItemKind, id: string) => `${kind}:${id}`;

/** One list without the same video or song twice, keeping the first copy. */
function dedupeItems(items: LikedItem[]): LikedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = itemKey(item.kind, item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The account's Liked-videos playlist answers at most this many pages here. */
const SERVER_LIKES_MAX_PAGES = 5;

function isStubMusicLike(item: LikedItem): item is LikedMusicItem {
  if (item.kind !== "music") return false;
  const song = item.song;
  if (!song) return true;
  const hasTitle = Boolean(song.title && song.title.trim());
  const hasArtist = Boolean(song.artists?.some((a) => a?.name));
  return !hasTitle || !hasArtist;
}

function normalizeItems(items: LikedItem[]) {
  return [...items].sort((a, b) => Date.parse(b.likedAt) - Date.parse(a.likedAt));
}

async function persist(items: LikedItem[]) {
  await setSetting(LIKES_SETTING_KEY, JSON.stringify(normalizeItems(items)));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
  }
}

interface LikesState {
  items: LikedItem[];
  loaded: boolean;
  /** The account's liked videos and songs, never persisted locally. */
  serverItems: LikedItem[];
  serverLoaded: boolean;
  load: () => Promise<void>;
  /**
   * Reads the account's Liked-videos playlist and Liked Music list once
   * (signed out it stays empty). A failed read leaves the last good list
   * in place: blanking the page on a transient failure looks exactly
   * like videos vanishing.
   */
  loadServer: () => Promise<void>;
  enrichStubs: () => Promise<void>;
  isLikedVideo: (videoId: string) => boolean;
  isLikedSong: (song: SongItem) => boolean;
  toggleVideo: (video: VideoSummary) => Promise<boolean>;
  toggleSong: (song: SongItem) => Promise<boolean>;
  remove: (kind: LikedItemKind, id: string) => Promise<void>;
  /** Unlikes several in one write and returns them for Undo; nothing changes if the write fails. */
  removeMany: (items: LikedItem[]) => Promise<LikedItem[]>;
  /** Puts unliked items back as they were, keeping when each was liked. */
  restore: (items: LikedItem[]) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * The Liked page's list: the account's likes first in server order, then
 * this device's own likes the server does not carry — the same merge the
 * History page does with server + local rows.
 */
export function mergeLikedItems(
  serverItems: LikedItem[],
  localItems: LikedItem[],
): LikedItem[] {
  if (serverItems.length === 0) return localItems;
  const seen = new Set(serverItems.map((item) => itemKey(item.kind, item.id)));
  return [...serverItems, ...localItems.filter((item) => !seen.has(itemKey(item.kind, item.id)))];
}

/** [`mergeLikedItems`] over a whole store state. */
export function selectMergedLikes(state: LikesState): LikedItem[] {
  return mergeLikedItems(state.serverItems, state.items);
}

/** Unlikes one item on the account; false when the server refused. */
async function unlikeOnServer(item: LikedItem): Promise<boolean> {
  try {
    if (item.kind === "music") {
      await setMusicLiked(item.id, false);
    } else {
      await setVideoLiked(item.id, false);
    }
    return true;
  } catch (error) {
    console.warn("Failed to remove the like on the account", error);
    return false;
  }
}

/** Re-likes one item on the account; false when the server refused. */
async function likeOnServer(item: LikedItem): Promise<boolean> {
  try {
    if (item.kind === "music") {
      await setMusicLiked(item.id, true);
    } else {
      await setVideoLiked(item.id, true);
    }
    return true;
  } catch (error) {
    console.warn("Failed to save the like on the account", error);
    return false;
  }
}

/** Shared by concurrent `loadServer()` calls so a burst cannot stack up reads. */
let serverLoadInFlight: Promise<void> | null = null;

export const useLikesStore = create<LikesState>((set, get) => ({
  items: [],
  loaded: false,
  serverItems: [],
  serverLoaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await getSetting(LIKES_SETTING_KEY);
      const parsed = raw ? (JSON.parse(raw) as LikedItem[]) : [];
      set({ items: normalizeItems(Array.isArray(parsed) ? parsed : []), loaded: true });
    } catch (error) {
      console.warn("Failed to load likes", error);
      set({ loaded: true });
    }
    void get().enrichStubs();
  },

  loadServer: async () => {
    if (get().serverLoaded || serverLoadInFlight) {
      return serverLoadInFlight ?? Promise.resolve();
    }
    serverLoadInFlight = (async () => {
      try {
        if (!(await getAccountSignedIn().catch(() => false))) return;
        // The server sends no liked date, so rows keep the fetch order
        // with descending stamps, as the History merge does.
        const now = Date.now();
        const [videos, songs] = await Promise.all([
          (async (): Promise<LikedVideoItem[]> => {
            const collected: LikedVideoItem[] = [];
            let continuation: string | null = null;
            for (let page = 0; page < SERVER_LIKES_MAX_PAGES; page += 1) {
              const list = await getLikedVideos(continuation ?? undefined);
              for (const video of list.videos) {
                collected.push({
                  kind: "video",
                  id: video.id,
                  likedAt: new Date(now - collected.length * 1000).toISOString(),
                  video,
                });
              }
              continuation = list.continuation ?? null;
              if (!continuation) break;
            }
            return collected;
          })(),
          getLikedMusic()
            .then((page): LikedMusicItem[] =>
              page.songs.map((song, index) => ({
                kind: "music",
                id: songId(song),
                likedAt: new Date(now - index * 1000).toISOString(),
                song,
              })),
            )
            .catch((error) => {
              console.warn("Failed to load the account's liked songs", error);
              return [] as LikedMusicItem[];
            }),
        ]);
        set({ serverItems: dedupeItems([...videos, ...songs]), serverLoaded: true });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(LIKES_LIBRARY_UPDATED_EVENT));
        }
      } catch (error) {
        console.warn("Failed to load the account's liked videos", error);
      } finally {
        serverLoadInFlight = null;
      }
    })();
    return serverLoadInFlight;
  },

  enrichStubs: async () => {
    const stubs = get().items.filter(isStubMusicLike);
    if (stubs.length === 0) return;
    const ids = Array.from(
      new Set(
        stubs
          .map((item) => item.song?.videoId ?? item.song?.id ?? item.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (ids.length === 0) return;

    const fetched = new Map<string, SongItem>();
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const page = await getMusicQueue(ids.slice(i, i + 50));
        for (const song of page.items) {
          if (song.videoId) fetched.set(song.videoId, song);
          if (song.id) fetched.set(song.id, song);
        }
      }
    } catch (error) {
      console.warn("Failed to enrich liked songs", error);
      return;
    }
    if (fetched.size === 0) return;

    let changed = false;
    const next = get().items.map((item) => {
      if (!isStubMusicLike(item)) return item;
      const key = item.song?.videoId ?? item.song?.id ?? item.id;
      const song = key ? fetched.get(key) : undefined;
      if (!song) return item;
      changed = true;
      return { ...item, song };
    });
    if (!changed) return;
    set({ items: normalizeItems(next) });
    await persist(next);
  },

  isLikedVideo: (videoId) => get().items.some((item) => (
    item.kind === "video" && item.id === videoId
  )),

  isLikedSong: (song) => {
    const id = songId(song);
    return get().items.some((item) => item.kind === "music" && item.id === id);
  },

  toggleVideo: async (video) => {
    if (isLocalMediaId(video.id)) return false;
    await get().load();
    const key = itemKey("video", video.id);
    // A video liked elsewhere is liked here too: toggling it off must
    // remove it, not add a second local record for it.
    const exists = get().items.some((item) => itemKey(item.kind, item.id) === key)
      || get().serverItems.some((item) => itemKey(item.kind, item.id) === key);
    const next = exists
      ? get().items.filter((item) => itemKey(item.kind, item.id) !== key)
      : [
          {
            kind: "video" as const,
            id: video.id,
            likedAt: new Date().toISOString(),
            video,
          },
          ...get().items,
        ];
    set({
      items: normalizeItems(next),
      serverItems: exists
        ? get().serverItems.filter((item) => itemKey(item.kind, item.id) !== key)
        : get().serverItems,
    });
    await persist(next);
    return !exists;
  },

  toggleSong: async (song) => {
    if (isLocalMediaId(song.videoId ?? song.id)) return false;
    await get().load();
    const id = songId(song);
    const key = itemKey("music", id);
    const exists = get().items.some((item) => itemKey(item.kind, item.id) === key)
      || get().serverItems.some((item) => itemKey(item.kind, item.id) === key);
    const next = exists
      ? get().items.filter((item) => itemKey(item.kind, item.id) !== key)
      : [
          {
            kind: "music" as const,
            id,
            likedAt: new Date().toISOString(),
            song,
          },
          ...get().items,
        ];
    set({
      items: normalizeItems(next),
      serverItems: exists
        ? get().serverItems.filter((item) => itemKey(item.kind, item.id) !== key)
        : get().serverItems,
    });
    await persist(next);
    if (!exists) {
      void autoDownloadLikedSong(song);
      recapLikedSong(song);
    }
    // The account like is a best-effort write behind the local toggle, as
    // Android's addToFavorites/removeFromFavorites does: a refused like
    // leaves the local state as it is — but the failure is no longer
    // silent, so the user knows the song is not liked on the account.
    if (await getAccountSignedIn().catch(() => false)) {
      void setMusicLiked(id, !exists).catch((error) => {
        console.warn("Failed to save the like on the account", error);
        useUiStore.getState().showToast({
          variant: "error",
          message: getString("account_music_like_failed"),
        });
      });
    }
    return !exists;
  },

  remove: async (kind, id) => {
    await get().load();
    const key = itemKey(kind, id);
    const removed = get().items.find((item) => itemKey(item.kind, item.id) === key)
      ?? get().serverItems.find((item) => itemKey(item.kind, item.id) === key);
    const next = get().items.filter((item) => itemKey(item.kind, item.id) !== key);
    set({
      items: normalizeItems(next),
      serverItems: get().serverItems.filter((item) => itemKey(item.kind, item.id) !== key),
    });
    await persist(next);
    // Removing from the Liked page unlikes on the account too: a row the
    // server still holds comes back on the next refresh otherwise.
    if (removed && (await getAccountSignedIn().catch(() => false))) {
      if (!(await unlikeOnServer(removed))) {
        set({ items: normalizeItems([...get().items, removed]) });
        await persist(get().items);
        useUiStore.getState().showToast({
          variant: "error",
          message: getString(kind === "music" ? "account_music_like_failed" : "account_like_failed"),
        });
      }
    }
  },

  removeMany: async (items) => {
    await get().load();
    const keys = new Set(items.map((item) => itemKey(item.kind, item.id)));
    const previous = get().items;
    const previousServer = get().serverItems;
    const removed = dedupeItems(
      [...previous, ...previousServer].filter((item) => keys.has(itemKey(item.kind, item.id))),
    );
    const next = previous.filter((item) => !keys.has(itemKey(item.kind, item.id)));
    const nextServer = previousServer.filter((item) => !keys.has(itemKey(item.kind, item.id)));
    set({ items: next, serverItems: nextServer });
    try {
      await persist(next);
    } catch (error) {
      set({ items: previous, serverItems: previousServer });
      throw error;
    }
    if (removed.length === 0 || !(await getAccountSignedIn().catch(() => false))) {
      return removed;
    }
    const results = await Promise.all(removed.map((item) => unlikeOnServer(item)));
    const failed = removed.filter((_, index) => !results[index]);
    if (failed.length === 0) return removed;
    // The refused ones go back: the server still holds them, so the page
    // must not pretend they are gone.
    const failedKeys = new Set(failed.map((item) => itemKey(item.kind, item.id)));
    set({ items: normalizeItems([...get().items, ...failed]) });
    await persist(get().items).catch(() => undefined);
    useUiStore.getState().showToast({
      variant: "error",
      message: getString("account_like_failed"),
    });
    return removed.filter((item) => !failedKeys.has(itemKey(item.kind, item.id)));
  },

  restore: async (items) => {
    await get().load();
    const previous = get().items;
    const held = new Set(previous.map((item) => itemKey(item.kind, item.id)));
    const next = normalizeItems([...previous, ...items.filter((item) => !held.has(itemKey(item.kind, item.id)))]);
    set({ items: next });
    try {
      await persist(next);
    } catch (error) {
      set({ items: previous });
      throw error;
    }
    // Undoing a remove re-likes on the account, best-effort: a refused
    // re-like leaves the local row, which the like button can retry.
    if (items.length > 0 && (await getAccountSignedIn().catch(() => false))) {
      const results = await Promise.all(items.map((item) => likeOnServer(item)));
      if (results.some((ok) => !ok)) {
        useUiStore.getState().showToast({
          variant: "error",
          message: getString("account_like_failed"),
        });
      }
    }
  },

  clear: async () => {
    await get().load();
    const all = dedupeItems([...get().items, ...get().serverItems]);
    set({ items: [], serverItems: [] });
    await persist([]);
    if (all.length === 0 || !(await getAccountSignedIn().catch(() => false))) return;
    const results = await Promise.all(all.map((item) => unlikeOnServer(item)));
    const failed = all.filter((_, index) => !results[index]);
    if (failed.length === 0) return;
    set({ items: normalizeItems(failed) });
    await persist(get().items).catch(() => undefined);
    useUiStore.getState().showToast({
      variant: "error",
      message: getString("account_like_failed"),
    });
  },
}));

// The active account changed: the account's likes belong to the new
// account now, so the next reader fetches them again instead of showing
// the old account's.
if (typeof window !== "undefined") {
  const invalidate = () => {
    serverLoadInFlight = null;
    useLikesStore.setState({ serverItems: [], serverLoaded: false });
    void useLikesStore.getState().loadServer().catch(() => undefined);
  };
  listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, invalidate).catch(() => undefined);
  listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, invalidate).catch(() => undefined);
}
