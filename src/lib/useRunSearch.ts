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
      navigate(`/search?q=${encodeURIComponent(query)}`, searchFilters ? { state: { searchFilters } } : undefined);
    },
    [navigate, record, setSearchQuery],
  );
}
