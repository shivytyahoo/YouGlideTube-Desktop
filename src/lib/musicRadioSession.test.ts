import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS } from './settings/schema';
import { radioSession } from './musicRadioSession';
import { useAppSettingsStore } from '../store/useAppSettingsStore';
import type { SongItem } from '../types/music';

const mockedApi = vi.hoisted(() => ({
  watchCalls: [] as string[],
  pages: new Map<string, SongItem[]>(),
}));
vi.mock('./api/music', () => ({
  getMusicWatchQueue: async (videoId: string) => {
    mockedApi.watchCalls.push(videoId);
    return {
      items: mockedApi.pages.get(videoId) ?? [],
      currentIndex: null,
      continuation: null,
      lyricsBrowseId: null,
      lyricsParams: null,
      relatedBrowseId: null,
      radioPlaylistId: `RDAMVM${videoId}`,
      radioParams: null,
    };
  },
  getMusicQueueContinuation: async () => ({
    items: [],
    currentIndex: null,
    continuation: null,
    lyricsBrowseId: null,
    lyricsParams: null,
    relatedBrowseId: null,
    radioPlaylistId: null,
    radioParams: null,
  }),
}));

const song = (id: string): SongItem => ({
  id,
  videoId: id,
  title: id,
  artists: [{ id: `artist-${id}`, name: id }],
  album: null,
  duration: 180,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  thumbnail: '',
  explicit: false,
  playlistId: null,
  params: null,
});

const ctx = (seed: SongItem) => ({
  seed,
  queueIds: new Set<string>(),
  stationTracks: [] as SongItem[],
  isHidden: () => false,
});

const drain = () => {
  const queueIds = new Set<string>();
  let taken: SongItem[] = [];
  do {
    taken = radioSession.take(queueIds, 10);
    for (const track of taken) queueIds.add(track.videoId ?? track.id);
  } while (taken.length > 0);
};

describe('endless radio', () => {
  beforeEach(() => {
    radioSession.reset();
    mockedApi.watchCalls = [];
    mockedApi.pages.clear();
    useAppSettingsStore.setState({ values: {} });
  });

  it('starts a new round from its anchors instead of going dry', async () => {
    const seed = song('seed');
    mockedApi.pages.set('seed', [song('s1'), song('s2')]);
    mockedApi.pages.set('s1', [song('fresh-1')]);
    mockedApi.pages.set('s2', [song('fresh-2')]);
    await radioSession.refill(ctx(seed));
    drain();
    await radioSession.refill(ctx(seed));
    drain();
    await radioSession.refill(ctx(seed));
    drain();
    // Anchors spent: the next refill cycles back to the first anchor.
    mockedApi.pages.set('s1', [song('fresh-3')]);
    expect(await radioSession.refill(ctx(seed))).toBe(true);
    expect(mockedApi.watchCalls.filter((id) => id === 's1')).toHaveLength(2);
    expect(radioSession.isExhausted()).toBe(false);
  });

  it('ends dry when endless radio is off', async () => {
    useAppSettingsStore.setState({ values: { [SETTINGS.MUSIC_ENDLESS_RADIO]: 'false' } });
    const seed = song('seed');
    mockedApi.pages.set('seed', [song('s1')]);
    mockedApi.pages.set('s1', [song('fresh-1')]);
    await radioSession.refill(ctx(seed));
    drain();
    await radioSession.refill(ctx(seed));
    drain();
    expect(await radioSession.refill(ctx(seed))).toBe(false);
    expect(radioSession.canRefill()).toBe(false);
    expect(radioSession.isExhausted()).toBe(true);
  });

  it('still ends when every round only replays what it already played', async () => {
    const seed = song('seed');
    mockedApi.pages.set('seed', [song('s1')]);
    mockedApi.pages.set('s1', [song('s1')]);
    await radioSession.refill(ctx(seed));
    drain();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await radioSession.refill(ctx(seed));
      if (radioSession.isExhausted()) break;
    }
    expect(radioSession.isExhausted()).toBe(true);
    expect(radioSession.canRefill()).toBe(false);
  });
});
