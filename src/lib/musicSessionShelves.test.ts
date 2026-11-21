import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchHistoryRecord } from '../types/db';
import type { ArtistPage, SongItem } from '../types/music';
import {
  dailyDiscoverSection,
  dailyMixSections,
  listenAgainSection,
  loadSessionHistory,
  maturityOf,
  onRepeatSection,
  quickPickSongs,
  resolveHistorySongs,
  similarSections,
  speedDialSection,
  summarizeHistory,
  type SessionHistory,
} from './musicSessionShelves';

const mockedDb = vi.hoisted(() => ({ history: [] as WatchHistoryRecord[] }));
const mockedApi = vi.hoisted(() => ({
  queue: new Map<string, SongItem>(),
  related: new Map<string, SongItem[]>(),
  artistPages: new Map<string, ArtistPage>(),
}));
vi.mock('./api/db', () => ({ getMusicHistory: async () => mockedDb.history }));
vi.mock('./api/music', () => ({
  getMusicQueue: async (ids: string[]) => ({
    items: ids.map((id) => mockedApi.queue.get(id)).filter((song): song is SongItem => !!song),
    currentIndex: null,
    continuation: null,
    lyricsBrowseId: null,
    lyricsParams: null,
    relatedBrowseId: null,
    radioPlaylistId: null,
  }),
  getMusicRelatedTyped: async (videoId: string) => ({
    sections: [],
    songs: mockedApi.related.get(videoId) ?? [],
    otherPerformances: [],
    albums: [],
    artists: [],
    playlists: [],
  }),
  getMusicArtistPage: async (browseId: string) => mockedApi.artistPages.get(browseId) ?? null,
}));
vi.mock('./i18n/index', () => ({
  getString: (key: string, ...args: unknown[]) =>
    args.length > 0 ? `${key}:${String(args[0])}` : key,
}));

const song = (id: string, artistId = 'artist', artistName = 'Artist'): SongItem => ({
  id,
  videoId: id,
  title: id,
  artists: [{ id: artistId, name: artistName }],
  album: null,
  duration: 180,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  thumbnail: `thumb-${id}`,
  explicit: false,
  playlistId: null,
  params: null,
});

const record = (videoId: string, channelId: string, date = '2026-01-02'): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  channelId,
  channelName: channelId,
  watchDate: date,
  watchDurationSeconds: 120,
  isMusic: true,
});

const historyOf = (records: WatchHistoryRecord[]): SessionHistory => {
  const { songs, playCounts, artists } = summarizeHistory(records);
  return {
    records,
    songs: songs.map((r) => mockedApi.queue.get(r.videoId) ?? {
      ...song(r.videoId, r.channelId ?? 'artist', r.channelName ?? 'Artist'),
      thumbnail: '',
    }),
    playCounts,
    artists,
  };
};

const artistPage = (id: string, topSongs: SongItem[], related: string[]): ArtistPage => ({
  artist: { id, title: id, thumbnail: null, channelId: null, isProfile: false },
  sections: [
    {
      kind: 'topSongs',
      title: 'Top',
      moreEndpointBrowseId: null,
      moreEndpointParams: null,
      items: topSongs.map((s) => ({ type: 'song' as const, ...s })),
    },
    {
      kind: 'relatedArtists',
      title: 'Related',
      moreEndpointBrowseId: null,
      moreEndpointParams: null,
      items: related.map((name) => ({
        type: 'artist' as const,
        id: name,
        title: name,
        thumbnail: null,
        channelId: null,
        isProfile: false,
      })),
    },
  ],
  description: null,
  subscriberCountText: null,
  monthlyListenerCount: null,
  isSubscribed: false,
});

describe('summarizeHistory', () => {
  it('counts repeats and ranks artists by plays', () => {
    const { songs, playCounts, artists } = summarizeHistory([
      record('a', 'artist-a', '2026-01-01'),
      record('b', 'artist-b', '2026-01-02'),
      record('a', 'artist-a', '2026-01-03'),
    ]);
    expect(songs.map((r) => r.videoId)).toEqual(['a', 'b']);
    expect(playCounts.get('a')).toBe(2);
    expect(artists[0]?.name).toBe('artist-a');
    expect(artists[0]?.count).toBe(2);
  });

  it('skips rows without a title or id', () => {
    const { songs } = summarizeHistory([record('', 'artist-a'), { ...record('x', 'artist-a'), title: '' }]);
    expect(songs).toEqual([]);
  });
});

describe('resolveHistorySongs', () => {
  it('keeps unresolvable rows as playable stubs', async () => {
    mockedApi.queue.set('known', song('known'));
    const resolved = await resolveHistorySongs([record('known', 'a'), record('gone', 'b')]);
    expect(resolved.map((s) => s.videoId)).toEqual(['known', 'gone']);
    expect(resolved[0]?.thumbnail).toBe('thumb-known');
    expect(resolved[1]?.thumbnail).toBe('');
  });
});

describe('loadSessionHistory', () => {
  beforeEach(() => {
    mockedDb.history = [];
    mockedApi.queue.clear();
  });

  it('loads nothing on an empty history', async () => {
    const history = await loadSessionHistory();
    expect(history.songs).toEqual([]);
    expect(maturityOf(history)).toBe('cold_start');
  });

  it('warms up with a few plays and matures at twenty songs', async () => {
    mockedDb.history = Array.from({ length: 25 }, (_, i) => record(`s${i}`, `artist-${i % 3}`));
    const history = await loadSessionHistory();
    expect(history.songs).toHaveLength(25);
    expect(maturityOf(history)).toBe('mature');
    expect(maturityOf({ ...history, songs: history.songs.slice(0, 5) })).toBe('warming');
  });
});

describe('session shelves', () => {
  beforeEach(() => {
    mockedApi.queue.clear();
    mockedApi.related.clear();
    mockedApi.artistPages.clear();
  });

  it('listen again is the most recent plays, on repeat the most played', () => {
    const history = historyOf([
      record('a', 'artist-a', '2026-01-01'),
      record('b', 'artist-b', '2026-01-02'),
      record('a', 'artist-a', '2026-01-03'),
      record('c', 'artist-c', '2026-01-04'),
    ]);
    expect(listenAgainSection(history)?.items.map((item) => ('videoId' in item ? item.videoId : ''))).toEqual([
      'c', 'a', 'b',
    ]);
    expect(onRepeatSection(history)?.items.map((item) => ('videoId' in item ? item.videoId : ''))).toEqual(['a']);
    expect(listenAgainSection({ ...history, songs: [] })).toBeNull();
    expect(onRepeatSection({ ...history, songs: [] })).toBeNull();
  });

  it('speed dial mixes session plays with what is popular now', () => {
    const history = historyOf([record('a', 'artist-a'), record('b', 'artist-b')]);
    const section = speedDialSection(history, [song('hot-1', 'hot'), song('hot-2', 'hot')]);
    expect(section?.id).toBe('speed-dial');
    expect(section?.items).toHaveLength(4);
    expect(speedDialSection({ ...history, songs: [] }, [])).toBeNull();
  });

  it('quick picks seed from the song playing and recent plays', async () => {
    const history = historyOf([record('a', 'artist-a'), record('b', 'artist-b')]);
    mockedApi.related.set('now', [song('rel-now', 'artist-x')]);
    mockedApi.related.set('a', [song('rel-a', 'artist-y')]);
    mockedApi.related.set('b', [song('rel-b', 'artist-z')]);
    const picks = await quickPickSongs(history, song('now', 'artist-now'));
    expect(picks.map((s) => s.videoId)).toContain('rel-now');
    expect(picks.map((s) => s.videoId)).toContain('rel-a');
    expect(await quickPickSongs({ ...history, records: [], songs: [] }, null)).toEqual([]);
  });

  it('daily discover takes one related pick per shuffled seed', async () => {
    const history = historyOf([record('a', 'artist-a'), record('b', 'artist-b')]);
    mockedApi.related.set('a', [song('rel-a', 'artist-y')]);
    mockedApi.related.set('b', [song('rel-b', 'artist-z')]);
    const section = await dailyDiscoverSection(history);
    expect(section?.id).toBe('daily-discover');
    expect(section?.items).toHaveLength(2);
    expect(await dailyDiscoverSection({ ...history, songs: [] })).toBeNull();
  });

  it('daily mixes group repeat artists and fall back to favourites', async () => {
    const history = historyOf([
      record('a1', 'artist-a'),
      record('a2', 'artist-a'),
      record('b1', 'artist-b'),
    ]);
    mockedApi.related.set('a1', [song('rel-a1', 'artist-x')]);
    mockedApi.related.set('a2', [song('rel-a2', 'artist-y')]);
    mockedApi.artistPages.set(
      'fav-artist',
      artistPage('fav-artist', [song('fav-1', 'fav-artist'), song('fav-2', 'fav-artist')], []),
    );
    mockedApi.related.set('fav-1', [song('rel-fav', 'artist-q')]);
    const sections = await dailyMixSections(history, [
      { id: 'fav-artist', name: 'Fav', thumbnailUrl: '' },
    ]);
    expect(sections.map((s) => s.id)).toEqual(['mix-artist-a', 'mix-fav-artist']);
    expect(sections[0]?.title).toBe('music_daily_mix:artist-a');
    expect(sections[1]?.items.length).toBeGreaterThan(0);
  });

  it('similar rows pair top tracks with fan artists', async () => {
    const history = historyOf([
      record('a1', 'artist-a'),
      record('a2', 'artist-a'),
      record('b1', 'artist-b'),
    ]);
    mockedApi.artistPages.set(
      'artist-a',
      artistPage('artist-a', [song('top-a1', 'artist-a'), song('top-a2', 'artist-a')], ['fan-1', 'fan-2']),
    );
    mockedApi.artistPages.set(
      'artist-b',
      artistPage('artist-b', [song('top-b1', 'artist-b')], ['fan-3']),
    );
    const sections = await similarSections(history);
    expect(sections.map((s) => s.id)).toEqual(['similar-artist-a', 'similar-artist-b']);
    expect(sections[0]?.title).toBe('music_similar_to artist-a');
    const kinds = sections[0]?.items.map((item) => item.type);
    expect(kinds).toContain('artist');
    expect(kinds).toContain('song');
  });
});
