import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_FILTER_STATE,
  VIDEO_FILTER_CATEGORIES,
  availableWith,
  isDefaultFilterState,
  sanitizeFilterState,
} from "./searchFilterState";

describe("search filter state", () => {
  it("knows the default apart from any narrowing", () => {
    expect(isDefaultFilterState(DEFAULT_SEARCH_FILTER_STATE)).toBe(true);
    expect(isDefaultFilterState({ ...DEFAULT_SEARCH_FILTER_STATE, category: "videos" })).toBe(false);
    expect(
      isDefaultFilterState({
        ...DEFAULT_SEARCH_FILTER_STATE,
        filters: { ...DEFAULT_SEARCH_FILTER_STATE.filters, watchState: "unwatched" },
      }),
    ).toBe(false);
  });

  it("fills in what an older stored entry lacks", () => {
    const state = sanitizeFilterState({ category: "videos", filters: { duration: "long" } });
    expect(state?.category).toBe("videos");
    expect(state?.filters.duration).toBe("long");
    expect(state?.filters.watchState).toBe("any");
    expect(state?.filters.features).toEqual([]);
    expect(sanitizeFilterState(null)).toBeUndefined();
  });

  it("opens an old Videos search filtered to movies on the Movies tab", () => {
    const state = sanitizeFilterState({ category: "videos", filters: { contentType: "movie", duration: "long" } });
    expect(state?.category).toBe("movies");
    expect(state?.filters).toEqual({ ...DEFAULT_SEARCH_FILTER_STATE.filters, duration: "long" });
    expect(sanitizeFilterState({ category: "videos", filters: { contentType: "video" } })?.category).toBe("videos");
  });

  it("drops a Shorts search only while Shorts are hidden", () => {
    const shorts = { ...DEFAULT_SEARCH_FILTER_STATE, category: "shorts" as const };
    expect(availableWith(shorts, false).category).toBe("all");
    expect(availableWith(shorts, true).category).toBe("shorts");
  });

  it("drops a music-only search while Show Music is off, and keeps Artists and Playlists", () => {
    for (const category of ["songs", "albums", "podcasts", "episodes"] as const) {
      expect(availableWith({ ...DEFAULT_SEARCH_FILTER_STATE, category }, true, false).category).toBe("all");
    }
    const artists = { ...DEFAULT_SEARCH_FILTER_STATE, category: "artists" as const };
    expect(availableWith(artists, true, false)).toBe(artists);
    const songs = { ...DEFAULT_SEARCH_FILTER_STATE, category: "songs" as const };
    expect(availableWith(songs, true, true)).toBe(songs);
  });

  it("offers the video filters only on video tabs, never Channels or Playlists", () => {
    // Android's SearchFilterDialog gates duration, upload date, watched and
    // features to content types other than Channels and Playlists; the panel
    // and the request both key off this set.
    for (const category of ["videos", "shorts", "live", "movies"] as const) {
      expect(VIDEO_FILTER_CATEGORIES.has(category)).toBe(true);
    }
    for (const category of ["all", "artists", "playlists", "songs", "albums", "podcasts", "episodes"] as const) {
      expect(VIDEO_FILTER_CATEGORIES.has(category)).toBe(false);
    }
  });
});
