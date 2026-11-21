import { useEffect, useMemo } from 'react';

import { getString } from './i18n/index';
import { storedAlbumToItem, useAlbumLibraryStore } from '../store/useAlbumLibraryStore';
import { useSubscriptionStore } from '../store/useSubscriptionStore';
import { useServerMusicLibrary } from './useServerMusicLibrary';import type { PersonalSection } from './musicFeedComposer';

/** Your own lists and the artists you follow, at the top of the music home. */
export function useMusicLibraryShelves(): PersonalSection[] {
  const albums = useAlbumLibraryStore((state) => state.albums);
  const loaded = useAlbumLibraryStore((state) => state.loaded);
  const load = useAlbumLibraryStore((state) => state.load);
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const serverLibrary = useServerMusicLibrary();

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return useMemo(() => {
    const sections: PersonalSection[] = [];
    // Signed in, the shelf comes from the account library first — the saved
    // playlists the server holds — with the local albums after them, as
    // Android's Your Playlists shelf does. Signed out it stays local-only.
    const serverPlaylists =
      serverLibrary.status === 'signed-in' ? serverLibrary.playlists : [];
    const owned = albums.filter((album) => album.source === 'Owned');
    const savedLocal = albums.filter((album) => album.source === 'Saved');
    // Server albums are not in this shelf — Android's Your Playlists holds
    // playlists only — so a saved album the server also lists still shows
    // here once, from the local store; the two id spaces never collide.
    const playlistItems = [
      ...serverPlaylists,
      ...owned.map((album) => ({ type: 'album' as const, ...storedAlbumToItem(album) })),
      ...savedLocal.map((album) => ({ type: 'album' as const, ...storedAlbumToItem(album) })),
    ];
    if (playlistItems.length > 0) {
      sections.push({
        id: 'your-playlists',
        title: getString('music_home_your_playlists'),
        route: '/albums',
        items: playlistItems,
      });
    }
    const artists = subscriptions.filter((channel) => channel.isMusic);
    if (artists.length > 0) {
      sections.push({
        id: 'your-subscriptions',
        title: getString('music_home_your_subscriptions'),
        route: '/subscriptions',
        items: artists.map((channel) => ({
          type: 'artist' as const,
          id: channel.id,
          title: channel.name,
          thumbnail: channel.avatarUrl ?? null,
          channelId: channel.id,
        })),
      });
    }
    return sections;
  }, [albums, subscriptions, serverLibrary.items, serverLibrary.playlists, serverLibrary.status]);
}
