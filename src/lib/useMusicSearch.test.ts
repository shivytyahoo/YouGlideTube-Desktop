import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_SEARCH_FILTERS, useMusicSearch } from "./useMusicSearch";
import type { MusicSearchResponse, SearchSummaryPage, YTItem } from "../types/music";

const searchMusicTyped = vi.fn();
const getMusicSearchSummary = vi.fn();
const searchMusicContinuation = vi.fn();
const getMusicSearchSuggestions = vi.fn();

vi.mock("./api/music", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/music")>()),
  searchMusicTyped: (...args: unknown[]) => searchMusicTyped(...args),
  getMusicSearchSummary: (...args: unknown[]) => getMusicSearchSummary(...args),
  searchMusicContinuation: (...args: unknown[]) =>
    searchMusicContinuation(...args),
  getMusicSearchSuggestions: (...args: unknown[]) =>
    getMusicSearchSuggestions(...args),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (id: string): YTItem => ({
  type: "song",
  id,
  videoId: id,
  title: id,
  artists: [],
  album: null,
  duration: null,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  playlistId: null,
  params: null,
  viewsText: null,
});

function summary(): SearchSummaryPage {
  return {
    summaries: [
      { title: "Songs", items: [song("vid00000001")], isTopResult: false },
      { title: "Albums", items: [], isTopResult: false },
    ],
  };
}

function typed(items: ReturnType<typeof song>[], continuation: string | null = null): MusicSearchResponse {
  return {
    sections: [{ title: "", items, isTopResult: false }],
    continuation,
    filters: [],
  };
}

let latest: ReturnType<typeof useMusicSearch>;
let root: ReturnType<typeof createRoot>;

function Harness({ initialQuery }: { initialQuery?: string }) {
  latest = useMusicSearch(initialQuery);
  return null;
}

async function renderHarness(initialQuery?: string) {
  await act(async () => {
    root.render(createElement(Harness, { initialQuery }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getMusicSearchSummary.mockResolvedValue(summary());
  searchMusicTyped.mockResolvedValue(typed([song("vid00000002")], "tok-1"));
  searchMusicContinuation.mockResolvedValue(typed([song("vid00000003")], null));
  getMusicSearchSuggestions.mockResolvedValue({ queries: [], recommendedItems: [] });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

describe("MUSIC_SEARCH_FILTERS", () => {
  it("is exactly Android's four chips, in Android's order", () => {
    expect(MUSIC_SEARCH_FILTERS.map((f) => f.id)).toEqual([
      "albums",
      "videos",
      "songs",
      "community_playlists",
    ]);
  });
});

describe("useMusicSearch", () => {
  it("searches the summary with no filter", async () => {
    await renderHarness();
    await act(async () => {
      await latest.performSearch("test");
    });
    expect(latest.isSearching).toBe(true);
    expect(latest.activeFilter).toBeNull();
    expect(getMusicSearchSummary).toHaveBeenCalledWith("test");
    expect(latest.summaries).toHaveLength(2);
    expect(latest.hasResults).toBe(true);
  });

  it("applies a chip as a filtered search and toggles it off", async () => {
    await renderHarness();
    await act(async () => {
      await latest.performSearch("test");
    });
    await act(async () => {
      await latest.applyFilter("songs");
    });
    expect(searchMusicTyped).toHaveBeenCalledWith("test", "songs");
    expect(latest.activeFilter).toBe("songs");
    expect(latest.filtered).toHaveLength(1);
    await act(async () => {
      await latest.applyFilter("songs");
    });
    expect(latest.activeFilter).toBeNull();
    expect(getMusicSearchSummary).toHaveBeenCalledTimes(2);
  });

  it("starts a new search unfiltered, as Android resets the chip", async () => {
    await renderHarness();
    await act(async () => {
      await latest.performSearch("test");
    });
    await act(async () => {
      await latest.applyFilter("songs");
    });
    expect(latest.activeFilter).toBe("songs");
    await act(async () => {
      await latest.performSearch("other");
    });
    expect(latest.activeFilter).toBeNull();
    expect(getMusicSearchSummary).toHaveBeenCalledWith("other");
  });

  it("pages filtered results and dedupes", async () => {
    await renderHarness();
    await act(async () => {
      await latest.performSearch("test");
    });
    await act(async () => {
      await latest.applyFilter("songs");
    });
    await act(async () => {
      await latest.loadMore();
    });
    expect(searchMusicContinuation).toHaveBeenCalledWith("tok-1");
    expect(latest.filtered.map((item) => (item.type === "song" ? item.id : ""))).toEqual([
      "vid00000002",
      "vid00000003",
    ]);
  });

  it("runs a preset query on open, as recognition hands one over", async () => {
    await renderHarness("preset song");
    await vi.waitFor(() => expect(getMusicSearchSummary).toHaveBeenCalledWith("preset song"));
    expect(latest.isSearching).toBe(true);
  });

  it("clears back to idle", async () => {
    await renderHarness();
    await act(async () => {
      await latest.performSearch("test");
    });
    act(() => {
      latest.clearSearch();
    });
    expect(latest.isSearching).toBe(false);
    expect(latest.query).toBe("");
    expect(latest.summaries).toEqual([]);
  });
});
