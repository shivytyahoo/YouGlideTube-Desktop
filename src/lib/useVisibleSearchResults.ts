import { useMemo } from 'react';
import { pairCreator, withWatchState, withoutHidden, withoutShorts } from './searchResults';
import { VIDEO_FILTER_CATEGORIES } from './searchFilterState';
import { useShortsEnabled } from './useShortsContent';
import { useWatchedVideoIds } from './useWatchedFilter';
import { useFeedActionsStore } from '../store/useFeedActionsStore';
import { useMusicHiddenFilter } from '../store/useMusicActionsStore';
import type { UseCombinedSearchReturn } from './useCombinedSearch';

/**
 * The results this profile may see: without dismissed videos, blocked channels, AI music, hidden
 * songs, and Shorts when they're off, narrowed by the watched filter, with the matched creator paired up.
 */
export function useVisibleSearchResults(search: UseCombinedSearchReturn) {
  const dismissedVideoIds = useFeedActionsStore((s) => s.dismissedVideoIds);
  const blockedChannelIds = useFeedActionsStore((s) => s.blockedChannelIds);
  const shortsEnabled = useShortsEnabled();
  const watchFilterApplies = VIDEO_FILTER_CATEGORIES.has(search.filterType);
  const watchState = watchFilterApplies ? search.filters.watchState : 'any';
  const watchedIds = useWatchedVideoIds(watchState !== 'any');
  const isHiddenSong = useMusicHiddenFilter();

  return useMemo(() => {
    const visible = withoutHidden(search.results, { videoIds: dismissedVideoIds, channelIds: blockedChannelIds });
    const allowed = shortsEnabled ? visible : withoutShorts(visible);
    const { creator, results } = pairCreator(withWatchState(allowed, watchState, watchedIds));
    return { creator, results: { ...results, songs: results.songs.filter((song) => !isHiddenSong(song)) } };
  }, [search.results, dismissedVideoIds, blockedChannelIds, shortsEnabled, watchState, watchedIds, isHiddenSong]);
}

export type VisibleSearchResults = ReturnType<typeof useVisibleSearchResults>;
