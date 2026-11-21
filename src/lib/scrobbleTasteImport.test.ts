import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ picked: [] as Array<{ id: string }>, load: vi.fn(), toggle: vi.fn() }));
const searchMusicTyped = vi.fn();
const getScrobbleTopArtists = vi.fn();
vi.mock('./api/music', () => ({
  searchMusicTyped: (...args: unknown[]) => searchMusicTyped(...args),
}));
vi.mock('./api/scrobble', () => ({
  getScrobbleTopArtists: (...args: unknown[]) => getScrobbleTopArtists(...args),
  getScrobbleSimilarTracks: vi.fn(),
}));
vi.mock('../store/useFavouriteArtistsStore', () => ({
  useFavouriteArtistsStore: { getState: () => store },
}));

import { importTopArtists } from './scrobbleTasteImport';

const artist = (id: string, title: string) => ({ type: 'artist', id, title, thumbnail: null, channelId: null });

describe('importTopArtists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.picked = [{ id: 'k' }];
    store.load.mockResolvedValue(undefined);
    store.toggle.mockResolvedValue(undefined);
  });

  it('adds exact name matches only and counts the new ones', async () => {
    getScrobbleTopArtists.mockResolvedValue(['Beyoncé', 'Near', 'Known']);
    searchMusicTyped.mockImplementation(async (name: string) => ({
      sections: [{
        items: name === 'Beyoncé' ? [artist('b', 'BEYONCE')] : name === 'Near' ? [artist('n', 'Nearly')] : [artist('k', 'known')],
      }],
    }));

    expect(await importTopArtists('LASTFM')).toBe(1);
    expect(store.toggle).toHaveBeenCalledWith({ id: 'b', name: 'BEYONCE', thumbnailUrl: '' });
    expect(store.toggle).toHaveBeenCalledTimes(1);
    expect(getScrobbleTopArtists).toHaveBeenCalledWith('LASTFM', 20);
  });

  it('passes on a failure to read the account', async () => {
    getScrobbleTopArtists.mockRejectedValue(new Error('down'));
    await expect(importTopArtists('LISTENBRAINZ')).rejects.toThrow('down');
  });
});
