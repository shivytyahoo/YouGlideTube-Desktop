import { useMemo } from "react";
import { create } from "zustand";
import { deepGlideAllowsHistory } from "../lib/deepGlide";
import { SETTINGS } from "../lib/settings/schema";
import {
  isDefaultFilterState,
  sanitizeFilterState,
  type SearchFilterState,
} from "../lib/searchFilterState";
import { recapQueriesCleared, recapSearch } from "../lib/recap/recapQueue";
import { profileStorage } from "../lib/storage/profileStorage";
import { getSettingValue, useAppSettingsStore } from "./useAppSettingsStore";

const STORAGE_KEY = "youglidetube_search_history";
export const SEARCH_HISTORY_DEFAULT_LIMIT = 50;
/** The largest Max history size on offer. */
const SEARCH_HISTORY_STORED_LIMIT = 500;
const SEARCH_HISTORY_DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** Which search an entry belongs to: video, or music. Entries written before scopes
 *  have none and count as video. */
export type SearchHistoryScope = "video" | "music";

export interface SearchHistoryEntry {
  query: string;
  at: number;
  scope?: SearchHistoryScope;
  /** The filters last used with this search, so running it again finds the same results. */
  filters?: SearchFilterState;
}

function load(): SearchHistoryEntry[] {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is SearchHistoryEntry =>
        typeof entry?.query === "string" && entry.query.trim() !== "" && typeof entry?.at === "number")
      .map((entry) => ({ ...entry, filters: sanitizeFilterState(entry.filters) }))
      .slice(0, SEARCH_HISTORY_STORED_LIMIT);
  } catch {
    return [];
  }
}

function persist(entries: SearchHistoryEntry[]) {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("Failed to save search history", error);
  }
}

const maxSize = (raw: string | undefined): number => {
  const size = Number(raw);
  return Number.isFinite(size) && size > 0 ? size : SEARCH_HISTORY_DEFAULT_LIMIT;
};

/** What the viewer's settings let the list show: nothing when saving is off, and nothing past its age or size. */
export function visibleSearchEntries(
  entries: SearchHistoryEntry[],
  values: Record<string, string | undefined>,
  now: number,
  scope: SearchHistoryScope = "video",
): SearchHistoryEntry[] {
  if (values[SETTINGS.SEARCH_HISTORY_ENABLED] === "false") return [];
  const days = Number(values[SETTINGS.SEARCH_HISTORY_RETENTION_DAYS] ?? SEARCH_HISTORY_DEFAULT_RETENTION_DAYS);
  const oldest = values[SETTINGS.AUTO_DELETE_SEARCH_HISTORY] === "true" && days > 0 ? now - days * DAY_MS : 0;
  return entries
    .filter((entry) => sameScope(entry, scope))
    .filter((entry) => entry.at >= oldest)
    .slice(0, maxSize(values[SETTINGS.SEARCH_HISTORY_MAX_SIZE]));
}

const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameScope = (entry: SearchHistoryEntry, scope: SearchHistoryScope) =>
  (entry.scope ?? "video") === scope;

interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  /** Newest first; a repeated query moves to the top. Skipped when saving searches is off, and in Deep Glide unless history is allowed there. */
  record: (query: string, scope?: SearchHistoryScope) => void;
  /** Keeps these filters on the search's entry; the default set clears them. No entry, no change. */
  rememberFilters: (query: string, filters: SearchFilterState, scope?: SearchHistoryScope) => void;
  filtersOf: (query: string, scope?: SearchHistoryScope) => SearchFilterState | undefined;
  remove: (query: string, scope?: SearchHistoryScope) => void;
  clear: (scope?: SearchHistoryScope) => void;
  /** Forgets what's past a new Max history size, so raising it again doesn't bring them back. */
  trimTo: (size: number) => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>((set, get) => ({
  entries: load(),
  record: (query, scope = "video") => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const saving = getSettingValue(SETTINGS.SEARCH_HISTORY_ENABLED) !== "false";
    // With search history off the search still counts, but its words aren't kept. Android's rule.
    recapSearch(saving ? trimmed : null);
    if (!saving || !deepGlideAllowsHistory()) return;
    set((state) => {
      const earlier = state.entries.find((entry) => sameQuery(entry.query, trimmed) && sameScope(entry, scope));
      const entries = [
        { query: trimmed, at: Date.now(), scope, filters: earlier?.filters },
        ...state.entries.filter((entry) => !(sameQuery(entry.query, trimmed) && sameScope(entry, scope))),
      ].slice(0, maxSize(getSettingValue(SETTINGS.SEARCH_HISTORY_MAX_SIZE)));
      persist(entries);
      return { entries };
    });
  },
  rememberFilters: (query, filters, scope = "video") => set((state) => {
    if (!state.entries.some((entry) => sameQuery(entry.query, query) && sameScope(entry, scope))) return state;
    const kept = isDefaultFilterState(filters) ? undefined : filters;
    const entries = state.entries.map((entry) =>
      sameQuery(entry.query, query) && sameScope(entry, scope) ? { ...entry, filters: kept } : entry,
    );
    persist(entries);
    return { entries };
  }),
  filtersOf: (query, scope = "video") =>
    get().entries.find((entry) => sameQuery(entry.query, query) && sameScope(entry, scope))?.filters,
  remove: (query, scope) => set((state) => {
    const entries = state.entries.filter(
      (entry) => !sameQuery(entry.query, query) || (scope !== undefined && !sameScope(entry, scope)),
    );
    persist(entries);
    return { entries };
  }),
  clear: (scope) => {
    recapQueriesCleared();
    if (scope === undefined) {
      persist([]);
      set({ entries: [] });
      return;
    }
    set((state) => {
      const entries = state.entries.filter((entry) => !sameScope(entry, scope));
      persist(entries);
      return { entries };
    });
  },
  trimTo: (size) => set((state) => {
    if (state.entries.length <= size) return state;
    const entries = state.entries.slice(0, size);
    persist(entries);
    return { entries };
  }),
}));

export function useVisibleSearchHistory(scope: SearchHistoryScope = "video"): SearchHistoryEntry[] {
  const entries = useSearchHistoryStore((state) => state.entries);
  const values = useAppSettingsStore((state) => state.values);
  return useMemo(() => visibleSearchEntries(entries, values, Date.now(), scope), [entries, values, scope]);
}
