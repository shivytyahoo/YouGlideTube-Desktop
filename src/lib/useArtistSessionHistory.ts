import { useEffect, useState } from 'react';

import { getMusicHistory } from './api/db';
import { resolveHistorySongs } from './musicSessionShelves';
import type { WatchHistoryRecord } from '../types/db';
import type { SongItem } from '../types/music';

const normalized = (name: string): string => name.trim().toLowerCase();

/** Plays of this artist: a listen's channel names can hold several artists, comma-joined. */
export function historySongsForArtist(records: WatchHistoryRecord[], artistName: string): WatchHistoryRecord[] {
  const wanted = normalized(artistName);
  if (!wanted) return [];
  return records.filter((record) =>
    (record.channelName ?? '')
      .split(',')
      .some((part) => normalized(part) === wanted),
  );
}

/** The session plays of this artist, most recent first, resolved to full songs. */
export function useArtistSessionHistory(artistName: string): SongItem[] {
  const [songs, setSongs] = useState<SongItem[]>([]);
  useEffect(() => {
    if (!artistName.trim()) {
      setSongs([]);
      return;
    }
    let live = true;
    void (async () => {
      const records = await getMusicHistory(100, 0).catch(() => []);
      if (!live) return;
      setSongs(await resolveHistorySongs(historySongsForArtist(records, artistName)));
    })();
    return () => {
      live = false;
    };
  }, [artistName]);
  return songs;
}
