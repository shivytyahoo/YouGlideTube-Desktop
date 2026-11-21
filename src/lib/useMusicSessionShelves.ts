import { useCallback, useEffect, useRef, useState } from 'react';

import type { PersonalSection } from './musicFeedComposer';
import { trendingSongs } from './musicRecall';
import {
  dailyDiscoverSection,
  dailyMixSections,
  listenAgainSection,
  loadSessionHistory,
  maturityOf,
  onRepeatSection,
  quickPickSongs,
  similarSections,
  speedDialSection,
  type SessionHistory,
} from './musicSessionShelves';
import { WATCH_HISTORY_WRITTEN_EVENT } from './windowEvents';
import { useFavouriteArtistsStore } from '../store/useFavouriteArtistsStore';
import { useMusicPlayerStore } from '../store/useMusicPlayerStore';
import type { SongItem } from '../types/music';

export interface MusicSessionShelves {
  sections: PersonalSection[];
  quickPicks: SongItem[];
  maturity: string;
  loaded: boolean;
}

/**
 * The session shelves for the music home: Listen Again, On Repeat and Speed Dial from the
 * plays so far, then Quick Picks, Daily Discover, Daily Mixes and Similar To from the same
 * session. The sync shelves publish as soon as the history loads; the discovery ones
 * publish as their server calls land. A listen written while the home is open rebuilds
 * them, so On Repeat follows the session live; Quick Picks follow the song playing now.
 */
export function useMusicSessionShelves(): MusicSessionShelves {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const favourites = useFavouriteArtistsStore((s) => s.picked);
  const favouritesLoaded = useFavouriteArtistsStore((s) => s.loaded);
  const loadFavourites = useFavouriteArtistsStore((s) => s.load);
  const [sections, setSections] = useState<PersonalSection[]>([]);
  const [quickPicks, setQuickPicks] = useState<SongItem[]>([]);
  const [maturity, setMaturity] = useState('cold_start');
  const [loaded, setLoaded] = useState(false);
  const requestRef = useRef(0);
  const historyRef = useRef<SessionHistory | null>(null);
  const favouritesRef = useRef(favourites);
  favouritesRef.current = favourites;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;

  useEffect(() => {
    if (!favouritesLoaded) void loadFavourites();
  }, [favouritesLoaded, loadFavourites]);

  const refreshQuickPicks = useCallback(async (history: SessionHistory) => {
    const picks = await quickPickSongs(history, currentTrackRef.current);
    setQuickPicks(picks);
  }, []);

  const build = useCallback(async () => {
    const request = ++requestRef.current;
    const live = () => requestRef.current === request;
    const publish = (section: PersonalSection | null) => {
      if (!section || !live() || section.items.length === 0) return;
      setSections((previous) =>
        previous.some((item) => item.id === section.id)
          ? previous.map((item) => (item.id === section.id ? section : item))
          : [...previous, section],
      );
    };

    const history: SessionHistory = await loadSessionHistory();
    if (!live()) return;
    historyRef.current = history;
    setMaturity(maturityOf(history));
    setLoaded(true);
    if (live()) void refreshQuickPicks(history);
    for (const section of [listenAgainSection(history), onRepeatSection(history)]) publish(section);
    const forYou = await trendingSongs().catch(() => []);
    if (!live()) return;
    publish(speedDialSection(history, forYou));

    const [discover, mixes, similar] = await Promise.all([
      dailyDiscoverSection(history),
      dailyMixSections(history, favouritesRef.current),
      similarSections(history),
    ]);
    if (!live()) return;
    publish(discover);
    for (const section of mixes) publish(section);
    for (const section of similar) publish(section);
  }, [refreshQuickPicks]);

  useEffect(() => {
    void build();
    return () => {
      requestRef.current += 1;
    };
  }, [build]);

  useEffect(() => {
    const onWrite = () => void build();
    window.addEventListener(WATCH_HISTORY_WRITTEN_EVENT, onWrite);
    return () => window.removeEventListener(WATCH_HISTORY_WRITTEN_EVENT, onWrite);
  }, [build]);

  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    void refreshQuickPicks(history);
  }, [currentTrack, refreshQuickPicks]);

  return { sections, quickPicks, maturity, loaded };
}
