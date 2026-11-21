import { describe, expect, it } from 'vitest';

import type { WatchHistoryRecord } from '../types/db';
import { historySongsForArtist } from './useArtistSessionHistory';

const record = (videoId: string, channelName: string): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  channelName,
  watchDate: '2026-01-01',
  watchDurationSeconds: 120,
  isMusic: true,
});

describe('historySongsForArtist', () => {
  it('matches the artist by name, case-insensitively', () => {
    const records = [record('a', 'The Band'), record('b', 'Other'), record('c', 'the band')];
    expect(historySongsForArtist(records, 'the band').map((r) => r.videoId)).toEqual(['a', 'c']);
  });

  it('matches one artist of a collaboration', () => {
    const records = [record('a', 'The Band, Guest Singer'), record('b', 'Guest Singer')];
    expect(historySongsForArtist(records, 'Guest Singer').map((r) => r.videoId)).toEqual(['a', 'b']);
  });

  it('matches nothing without a name', () => {
    expect(historySongsForArtist([record('a', 'The Band')], '')).toEqual([]);
  });
});
