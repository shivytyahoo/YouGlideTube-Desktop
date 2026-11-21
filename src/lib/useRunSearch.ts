import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchFilterState } from './searchFilterState';
import { useSearchHistoryStore, type SearchHistoryScope } from '../store/useSearchHistoryStore';
import { useUiStore } from '../store/useUiStore';

/** Runs a search: saves it to history and opens its results, with the filters it last used. */
export function useRunSearch() {
  const navigate = useNavigate();
  const record = useSearchHistoryStore((s) => s.record);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  return useCallback(
    (query: string, searchFilters?: SearchFilterState, scope?: SearchHistoryScope) => {
      record(query, scope);
      setSearchQuery(query);
      // A search run from a music page opens the dedicated music search,
      // as Android's music tab does; everywhere else opens the main search.
      const destination =
        scope === "music"
          ? `/music/search?q=${encodeURIComponent(query)}`
          : `/search?q=${encodeURIComponent(query)}`;
      navigate(destination, searchFilters ? { state: { searchFilters } } : undefined);
    },
    [navigate, record, setSearchQuery],
  );
}
