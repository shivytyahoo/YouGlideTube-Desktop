import { useCallback } from "react";
import { create } from "zustand";
import { recapArtistSaidNo } from "../lib/recap/recapQueue";
import { useMusicPlayerStore } from "./useMusicPlayerStore";
import type { SongItem } from "../types/music";

// Music feedback, as the Android app builds it: "Not interested" and "Don't recommend
// {artist}" are artist-level and session-only. They live in memory, reset on relaunch,
// never escalate and never persist — the server feed stays the source of truth, the
// exclusion only keeps an artist out of this session's shelves, radio and queue.
const EXCLUDED_CAP = 1000;

/** Resolves a stable artist key — id when present, else a normalized name. */
export function musicArtistKey(artist?: { id?: string | null; name?: string | null } | null): string {
  if (!artist) return "";
  const id = (artist.id ?? "").trim();
  if (id) return id;
  return (artist.name ?? "").trim().toLowerCase();
}

function addCapped(set: Set<string>, value: string, cap: number): Set<string> {
  if (!value || set.has(value)) return set;
  const next = new Set(set);
  next.add(value);
  return next.size > cap ? new Set([...next].slice(next.size - cap)) : next;
}

interface MusicActionsState {
  /** Artists excluded for this session only; gone on relaunch. */
  excludedArtistKeys: Set<string>;
  loaded: boolean;
  /** Nothing to read back: the exclusions live only in memory. Kept so app start and
   *  profile switches can await the store the same way other stores are awaited. */
  load: () => Promise<void>;
  /** Hides the song's primary artist for this session. */
  notInterested: (song: SongItem) => void;
  /** Hides an artist for this session. */
  blockArtist: (artist: { id?: string | null; name: string }) => void;
  /** Lifts a session exclusion again. */
  unblockArtist: (key: string) => void;
}

/** Builds the hide predicate from a snapshot of the set (shared by the hook and the
 *  player-store sync, which can't use React hooks). */
function buildHiddenPredicate(excluded: Set<string>): (song: SongItem) => boolean {
  return (song: SongItem) => isSongHidden(excluded, song);
}

/** True when any of a song's artists is excluded. */
export function isSongHidden(excluded: Set<string>, song: SongItem): boolean {
  return (song.artists ?? []).some((artist) => {
    const key = musicArtistKey(artist);
    return key.length > 0 && excluded.has(key);
  });
}

/** True when an artist entity is excluded. */
export function isArtistHidden(
  excluded: Set<string>,
  artist: { id?: string | null; name?: string | null },
): boolean {
  const key = musicArtistKey(artist);
  return key.length > 0 && excluded.has(key);
}

export const useMusicActionsStore = create<MusicActionsState>((set, get) => {
  // Push the current hide predicate into the player store so radio autoplay skips hidden
  // tracks, and prune any already-queued tracks that just became hidden.
  const syncPlayer = () => {
    const predicate = buildHiddenPredicate(get().excludedArtistKeys);
    const player = useMusicPlayerStore.getState();
    player.setHiddenPredicate?.(predicate);
    player.pruneQueue?.(predicate);
  };

  return {
    excludedArtistKeys: new Set(),
    loaded: false,

    load: async () => {
      if (get().loaded) return;
      set({ loaded: true });
      syncPlayer();
    },

    notInterested: (song) => {
      const primary = song.artists?.[0] ?? null;
      const key = musicArtistKey(primary);
      if (!key) return;
      set((s) => ({ excludedArtistKeys: addCapped(s.excludedArtistKeys, key, EXCLUDED_CAP) }));
      syncPlayer();
      recapArtistSaidNo(primary?.id ?? null, primary?.name ?? "", false);
    },

    blockArtist: ({ id, name }) => {
      const key = musicArtistKey({ id, name });
      if (!key) return;
      set((s) => ({ excludedArtistKeys: addCapped(s.excludedArtistKeys, key, EXCLUDED_CAP) }));
      syncPlayer();
      recapArtistSaidNo(id ?? null, name, true);
    },

    unblockArtist: (key) => {
      if (!key) return;
      set((s) => {
        if (!s.excludedArtistKeys.has(key)) return s;
        const excludedArtistKeys = new Set(s.excludedArtistKeys);
        excludedArtistKeys.delete(key);
        return { excludedArtistKeys };
      });
      syncPlayer();
    },
  };
});

/** Reactive predicate for music feeds: true when any of a song's artists is excluded. */
export function useMusicHiddenFilter(): (song: SongItem) => boolean {
  const excluded = useMusicActionsStore((s) => s.excludedArtistKeys);
  return useCallback((song: SongItem) => isSongHidden(excluded, song), [excluded]);
}

/** Reactive predicate for artist entities (artist cards / shelves). */
export function useMusicArtistHidden(): (artist: { id?: string | null; name?: string | null }) => boolean {
  const excluded = useMusicActionsStore((s) => s.excludedArtistKeys);
  return useCallback((artist) => isArtistHidden(excluded, artist), [excluded]);
}
