import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SongItem } from '../types/music';
import {
  isArtistHidden,
  isSongHidden,
  musicArtistKey,
  useMusicActionsStore,
} from './useMusicActionsStore';

vi.mock('../lib/recap/recapQueue', () => ({ recapArtistSaidNo: vi.fn() }));
vi.mock('./useMusicPlayerStore', () => ({
  useMusicPlayerStore: { getState: () => ({ setHiddenPredicate: vi.fn(), pruneQueue: vi.fn() }) },
}));

const song = (id: string, artistId: string, artistName: string): SongItem => ({
  id,
  videoId: id,
  title: id,
  artists: [{ id: artistId, name: artistName }],
  album: null,
  duration: 180,
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  thumbnail: '',
  explicit: false,
  playlistId: null,
  params: null,
});

const excluded = () => useMusicActionsStore.getState().excludedArtistKeys;

describe('musicArtistKey', () => {
  it('prefers the id and falls back to the normalized name', () => {
    expect(musicArtistKey({ id: 'UC1', name: 'Name' })).toBe('UC1');
    expect(musicArtistKey({ id: null, name: '  The Band ' })).toBe('the band');
    expect(musicArtistKey(null)).toBe('');
  });
});

describe('session-only not interested', () => {
  beforeEach(() => {
    useMusicActionsStore.setState({ excludedArtistKeys: new Set(), loaded: false });
  });

  it('hides the artist, not just the track', () => {
    const store = useMusicActionsStore.getState();
    store.notInterested(song('track-1', 'artist-a', 'Artist A'));
    expect(isSongHidden(excluded(), song('track-1', 'artist-a', 'Artist A'))).toBe(true);
    expect(isSongHidden(excluded(), song('track-2', 'artist-a', 'Artist A'))).toBe(true);
    expect(isSongHidden(excluded(), song('track-3', 'artist-b', 'Artist B'))).toBe(false);
    expect(isArtistHidden(excluded(), { id: 'artist-a', name: 'Artist A' })).toBe(true);
    expect(isArtistHidden(excluded(), { id: 'artist-b', name: 'Artist B' })).toBe(false);
  });

  it('does not escalate a second mark: the artist stays session-excluded, nothing persists', async () => {
    const store = useMusicActionsStore.getState();
    await store.load();
    store.notInterested(song('track-1', 'artist-a', 'Artist A'));
    store.notInterested(song('track-2', 'artist-a', 'Artist A'));
    store.blockArtist({ id: 'artist-a', name: 'Artist A' });
    const state = useMusicActionsStore.getState();
    expect(state.excludedArtistKeys).toEqual(new Set(['artist-a']));
    expect(state).not.toHaveProperty('blockedArtists');
    expect(state).not.toHaveProperty('dismissedTrackIds');
    expect(state).not.toHaveProperty('suppressedArtistKeys');
  });

  it('unblocks again within the session', () => {
    const store = useMusicActionsStore.getState();
    store.blockArtist({ id: 'artist-a', name: 'Artist A' });
    expect(isSongHidden(excluded(), song('track-1', 'artist-a', 'Artist A'))).toBe(true);
    store.unblockArtist('artist-a');
    expect(isSongHidden(excluded(), song('track-1', 'artist-a', 'Artist A'))).toBe(false);
  });

  it('ignores a song with no artist to blame', () => {
    const store = useMusicActionsStore.getState();
    store.notInterested({ ...song('track-1', 'artist-a', 'Artist A'), artists: [] });
    expect(useMusicActionsStore.getState().excludedArtistKeys.size).toBe(0);
  });
});
