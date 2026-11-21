import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMusicSearchSuggestions,
  getMusicSearchSummary,
  searchMusicContinuation,
  searchMusicTyped,
} from "./api/music";
import { getBackendErrorMessage } from "./api/errors";
import { useSearchHistoryStore } from "../store/useSearchHistoryStore";
import type { StringKey } from "./i18n/index";
import type { MusicSearchSection, YTItem } from "../types/music";

/**
 * The four music search filters, in Android's order and with Android's
 * labels: Albums, Videos, Songs, Community Playlists. Tapping a selected
 * chip clears it back to the unfiltered summary.
 */
export type MusicSearchFilter = "albums" | "videos" | "songs" | "community_playlists";

export const MUSIC_SEARCH_FILTERS: ReadonlyArray<{
  id: MusicSearchFilter;
  labelKey: StringKey;
}> = [
  { id: "albums", labelKey: "music_filter_albums" },
  { id: "videos", labelKey: "music_filter_videos" },
  { id: "songs", labelKey: "music_filter_songs" },
  { id: "community_playlists", labelKey: "music_filter_community_playlists" },
];

const SUGGESTION_DEBOUNCE_MS = 300;

/**
 * The dedicated music search, as Android's `MusicSearchViewModel` runs it:
 * idle shows music history, suggestions and moods; a submitted query shows
 * the four filter chips over summary sections (top result, songs, videos,
 * albums, artists, playlists); a chip re-runs the search filtered, with a
 * flat list and continuation paging. A song from search plays alone, as
 * YouTube Music does — the service seeds its radio from it.
 */
export function useMusicSearch(initialQuery?: string) {
  const [draft, setDraft] = useState(initialQuery ?? "");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<MusicSearchFilter | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [summaries, setSummaries] = useState<MusicSearchSection[]>([]);
  const [filtered, setFiltered] = useState<YTItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recommendedItems, setRecommendedItems] = useState<YTItem[]>([]);
  const requestRef = useRef(0);
  const record = useSearchHistoryStore((s) => s.record);
  const historyEntries = useSearchHistoryStore((s) => s.entries);

  const matchingHistory = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return historyEntries
      .filter((entry) => (entry.scope ?? "video") === "music")
      .filter((entry) => !needle || entry.query.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [draft, historyEntries]);

  const runSearch = useCallback(
    async (nextQuery: string, filter: MusicSearchFilter | null) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) return;
      const request = ++requestRef.current;
      setQuery(trimmed);
      setDraft(trimmed);
      setActiveFilter(filter);
      setIsSearching(true);
      setLoading(true);
      setError(null);
      record(trimmed, "music");
      try {
        if (filter) {
          const page = await searchMusicTyped(trimmed, filter);
          if (request !== requestRef.current) return;
          setFiltered(page.sections.flatMap((section) => section.items));
          setContinuation(page.continuation);
          setSummaries([]);
        } else {
          const page = await getMusicSearchSummary(trimmed);
          if (request !== requestRef.current) return;
          setSummaries(page.summaries);
          setFiltered([]);
          setContinuation(null);
        }
      } catch (caught) {
        if (request !== requestRef.current) return;
        setError(getBackendErrorMessage(caught));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [record],
  );

  // A new search starts unfiltered, as Android's performSearch resets the
  // active filter; only tapping a chip filters it.
  const performSearch = useCallback(
    (nextQuery: string) => void runSearch(nextQuery, null),
    [runSearch],
  );

  const applyFilter = useCallback(
    (filter: MusicSearchFilter | null) => {
      if (!isSearching || !query) return;
      void runSearch(query, filter === activeFilter ? null : filter);
    },
    [activeFilter, isSearching, query, runSearch],
  );

  const loadMore = useCallback(async () => {
    if (!continuation || loadingMore || !activeFilter) return;
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await searchMusicContinuation(continuation);
      if (request !== requestRef.current) return;
      const fresh = page.sections.flatMap((section) => section.items);
      setFiltered((current) => {
        const seen = new Set(current.map((item) => itemKey(item)));
        return [...current, ...fresh.filter((item) => !seen.has(itemKey(item)))];
      });
      setContinuation(page.continuation);
    } catch (caught) {
      setError(getBackendErrorMessage(caught));
    } finally {
      if (request === requestRef.current) setLoadingMore(false);
    }
  }, [activeFilter, continuation, loadingMore]);

  const clearSearch = useCallback(() => {
    requestRef.current += 1;
    setDraft("");
    setQuery("");
    setActiveFilter(null);
    setIsSearching(false);
    setSummaries([]);
    setFiltered([]);
    setContinuation(null);
    setError(null);
    setSuggestions([]);
    setRecommendedItems([]);
  }, []);

  // Suggestions while typing, as Android shows them under the bar.
  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === "" || isSearching) {
      setSuggestions([]);
      setRecommendedItems([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void getMusicSearchSuggestions(trimmed)
        .then((page) => {
          setSuggestions(page.queries);
          setRecommendedItems(page.recommendedItems);
        })
        .catch(() => {
          setSuggestions([]);
          setRecommendedItems([]);
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, isSearching]);

  // Opened with a preset query (e.g. from music recognition), run the search
  // instead of auto-focusing, as Android's MusicSearchScreen does.
  const initialQueryRef = useRef(initialQuery);
  useEffect(() => {
    const preset = initialQueryRef.current?.trim();
    if (preset) void runSearch(preset, null);
    // Only the opening query runs; later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasResults = activeFilter
    ? filtered.length > 0
    : summaries.some((section) => section.items.length > 0);

  return {
    draft,
    setDraft,
    query,
    activeFilter,
    isSearching,
    summaries,
    filtered,
    continuation,
    loading,
    loadingMore,
    error,
    suggestions,
    recommendedItems,
    matchingHistory,
    hasResults,
    performSearch,
    applyFilter,
    loadMore,
    clearSearch,
  };
}

function itemKey(item: YTItem): string {
  switch (item.type) {
    case "album":
      return `album:${item.browseId}`;
    case "song":
      return `song:${item.videoId ?? item.id}`;
    case "episode":
      return `episode:${item.id}`;
    default:
      return `${item.type}:${item.id}`;
  }
}
