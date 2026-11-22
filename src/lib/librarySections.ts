import { useMemo } from "react";
import type { StringKey } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { usePreference } from "./usePreference";

/** The Library page's shelves, each of which can be hidden. The ids are stored, so they must never be renamed. Video and music have their own playlist and liked shelves, as Android's `LibrarySection` does. */
export const LIBRARY_SECTIONS = [
  { id: "HISTORY", title: "library_history_label" },
  { id: "VIDEO_PLAYLISTS", title: "library_video_playlists_label" },
  { id: "MUSIC_PLAYLISTS", title: "library_music_playlists_label" },
  { id: "ALBUMS", title: "albums_title" },
  { id: "SAVED_SHORTS", title: "library_saved_shorts_label" },
  { id: "WATCH_LATER", title: "library_watch_later_label" },
  { id: "LIKED_VIDEOS", title: "library_liked_videos_label" },
  { id: "LIKED_MUSIC", title: "liked_music" },
  { id: "VIDEO_DOWNLOADS", title: "library_video_downloads_label" },
  { id: "MUSIC_DOWNLOADS", title: "library_music_downloads_label" },
  { id: "LOCAL_MEDIA", title: "library_local_media_label" },
  { id: "NOTES", title: "notes_title" },
  { id: "SETTINGS", title: "settings" },
] as const satisfies readonly { id: string; title: StringKey }[];

export type LibrarySectionId = (typeof LIBRARY_SECTIONS)[number]["id"];

/** Shelves the old merged ids stood for, so a stored choice keeps hiding the same shelves. */
const LEGACY_SECTION_IDS: Record<string, readonly string[]> = {
  PLAYLISTS: ["VIDEO_PLAYLISTS", "MUSIC_PLAYLISTS"],
  LIKES: ["LIKED_VIDEOS", "LIKED_MUSIC"],
};

export function parseHiddenLibrarySections(raw: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids = new Set<string>();
    for (const id of parsed.filter((entry): entry is string => typeof entry === "string")) {
      for (const mapped of LEGACY_SECTION_IDS[id] ?? [id]) ids.add(mapped);
    }
    return ids;
  } catch {
    return new Set();
  }
}

export function toggledHiddenSections(hidden: ReadonlySet<string>, id: LibrarySectionId, hide: boolean): string {
  const next = new Set(hidden);
  if (hide) next.add(id);
  else next.delete(id);
  return JSON.stringify([...next]);
}

/** Saved Shorts goes with the Show Shorts switch as well as its own, and Albums, Music playlists, Liked Music and Music downloads with Show Music. */
export function hiddenOnLibraryPage(
  hidden: ReadonlySet<string>,
  shortsEnabled: boolean,
  musicEnabled = true,
): ReadonlySet<string> {
  if (shortsEnabled && musicEnabled) return hidden;
  return new Set([
    ...hidden,
    ...(shortsEnabled ? [] : ["SAVED_SHORTS"]),
    ...(musicEnabled ? [] : ["ALBUMS", "MUSIC_PLAYLISTS", "LIKED_MUSIC", "MUSIC_DOWNLOADS"]),
  ]);
}

export function useHiddenLibrarySections(): ReadonlySet<string> {
  const [raw] = usePreference(SETTINGS.HIDDEN_LIBRARY_SECTIONS);
  return useMemo(() => parseHiddenLibrarySections(raw), [raw]);
}
