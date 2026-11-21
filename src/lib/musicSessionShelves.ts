// The music home's session shelves: what the listener played this session, built from
// the persisted listen history (SQLite watch_history rows with isMusic — the desktop
// equivalent of the Android app's memory-only session history, capped at 100 plays).
// Everything here degrades to an empty shelf instead of throwing, so one failed source
// never breaks the home.
import { getMusicHistory } from './api/db';
import { getMusicQueue } from './api/music';
import { getString } from './i18n/index';
import type { PersonalSection } from './musicFeedComposer';
import {
  audioMusicOnly,
  interleaveSimilar,
  recallArtist,
  relatedSongs,
  shuffled,
  songIdOf,
} from './musicRecall';
import { interleaveQuickPickLanes, pickFanArtists, selectQuickPickSeeds } from './musicQuickPicks';
import type { FavouriteArtist } from '../store/useFavouriteArtistsStore';
import type { WatchHistoryRecord } from '../types/db';
import type { ArtistItem, SongItem, YTItem } from '../types/music';

/** How many plays the session pool holds, as on Android. */
export const SESSION_HISTORY_LIMIT = 100;
const SHELF_SONGS = 20;
const SPEED_DIAL_MAX = 40;
const QUICK_PICK_SEEDS = 5;
const QUICK_PICK_SONGS = 20;
const DAILY_DISCOVER_SEEDS = 5;
const DAILY_MIX_ARTISTS = 3;
const DAILY_MIX_SONGS = 20;
const SIMILAR_ARTISTS = 3;
const SIMILAR_TOP_SONGS = 10;
const SIMILAR_FAN_ARTISTS = 4;

export interface SessionArtistPlay {
  key: string;
  id: string | null;
  name: string;
  count: number;
  latestAt: number;
}

export interface SessionHistory {
  records: WatchHistoryRecord[];
  /** Distinct songs, most recent first, resolved to full items where YouTube knows them. */
  songs: SongItem[];
  playCounts: Map<string, number>;
  /** Artists by play count, then recency. */
  artists: SessionArtistPlay[];
}

export function artistKeyOf(id?: string | null, name?: string | null): string {
  return (id ?? '').trim() || (name ?? '').trim().toLowerCase();
}

/** A playable stand-in for a history row YouTube no longer resolves. */
export function stubSong(record: WatchHistoryRecord): SongItem {
  return {
    id: record.videoId,
    videoId: record.videoId,
    title: record.title,
    artists: record.channelName ? [{ name: record.channelName, id: record.channelId ?? null }] : [],
    album: null,
    duration: record.totalDurationSeconds ?? null,
    musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
    thumbnail: '',
    explicit: false,
    playlistId: null,
    params: null,
  };
}

/** Distinct plays, most recent first, with a count per song and per artist. */
export function summarizeHistory(records: WatchHistoryRecord[]): {
  songs: WatchHistoryRecord[];
  playCounts: Map<string, number>;
  artists: SessionArtistPlay[];
} {
  const latest = new Map<string, WatchHistoryRecord>();
  const playCounts = new Map<string, number>();
  const artistPlays = new Map<string, SessionArtistPlay>();
  for (const record of records) {
    const id = record.videoId;
    if (!id || !record.title) continue;
    playCounts.set(id, (playCounts.get(id) ?? 0) + 1);
    const at = Date.parse(record.watchDate) || 0;
    const seen = latest.get(id);
    if (!seen || at > (Date.parse(seen.watchDate) || 0)) latest.set(id, record);
    const key = artistKeyOf(record.channelId, record.channelName);
    if (!key) continue;
    const artist = artistPlays.get(key);
    if (artist) {
      artist.count += 1;
      if (at > artist.latestAt) artist.latestAt = at;
    } else {
      artistPlays.set(key, {
        key,
        id: record.channelId ?? null,
        name: record.channelName ?? '',
        count: 1,
        latestAt: at,
      });
    }
  }
  const songs = [...latest.values()].sort(
    (a, b) => (Date.parse(b.watchDate) || 0) - (Date.parse(a.watchDate) || 0),
  );
  const artists = [...artistPlays.values()].sort((a, b) => b.count - a.count || b.latestAt - a.latestAt);
  return { songs, playCounts, artists };
}

/** Resolves history rows to full songs in batches, keeping the rows YouTube forgot as stubs. */
export async function resolveHistorySongs(records: WatchHistoryRecord[]): Promise<SongItem[]> {
  const ids = [...new Set(records.map((record) => record.videoId).filter(Boolean))];
  const fetched = new Map<string, SongItem>();
  try {
    for (let index = 0; index < ids.length; index += 50) {
      const page = await getMusicQueue(ids.slice(index, index + 50));
      for (const song of page.items) {
        if (song.videoId) fetched.set(song.videoId, song);
        if (song.id) fetched.set(song.id, song);
      }
    }
  } catch (error) {
    console.warn('Failed to resolve listen history', error);
  }
  return records
    .map((record) => fetched.get(record.videoId) ?? stubSong(record))
    .filter((song, index, all) => all.findIndex((other) => songIdOf(other) === songIdOf(song)) === index);
}

export async function loadSessionHistory(): Promise<SessionHistory> {
  const records = await getMusicHistory(SESSION_HISTORY_LIMIT, 0).catch(() => []);
  const { songs, playCounts, artists } = summarizeHistory(records);
  const resolved = await resolveHistorySongs(songs);
  return { records, songs: resolved, playCounts, artists };
}

/** 'cold_start' with no plays, 'mature' once the session has a real shape, 'warming' between. */
export function maturityOf(history: SessionHistory | null): string {
  if (!history || history.songs.length === 0) return 'cold_start';
  return history.songs.length >= 20 ? 'mature' : 'warming';
}

const toItems = (songs: SongItem[]): YTItem[] => songs.map((song) => ({ type: 'song' as const, ...song }));

/** Most recent distinct plays. */
export function listenAgainSection(history: SessionHistory): PersonalSection | null {
  const songs = history.songs.slice(0, SHELF_SONGS);
  if (songs.length === 0) return null;
  return {
    id: 'listen-again',
    title: getString('music_listen_again'),
    items: toItems(songs),
    playAll: true,
  };
}

/** Most-played songs this session, most played first. */
export function onRepeatSection(history: SessionHistory): PersonalSection | null {
  const songs = history.songs
    .filter((song) => (history.playCounts.get(songIdOf(song)) ?? 0) >= 2)
    .sort((a, b) => (history.playCounts.get(songIdOf(b)) ?? 0) - (history.playCounts.get(songIdOf(a)) ?? 0))
    .slice(0, SHELF_SONGS);
  if (songs.length === 0) return null;
  return {
    id: 'on-repeat',
    title: getString('music_on_repeat'),
    items: toItems(songs),
    playAll: true,
  };
}

/**
 * The most reached-for songs: session plays round-robin with what is popular now, so the
 * grid stays full even on a short session.
 */
export function speedDialSection(history: SessionHistory, forYou: SongItem[]): PersonalSection | null {
  const tracks = interleaveQuickPickLanes(
    [audioMusicOnly(history.songs), audioMusicOnly(forYou)],
    SPEED_DIAL_MAX,
  );
  if (tracks.length === 0) return null;
  return { id: 'speed-dial', title: getString('music_speed_dial'), items: toItems(tracks) };
}

/**
 * Quick Picks: one related lane per seed — the song playing now first, then recent plays,
 * each from a different artist — interleaved so no station owns the shelf.
 */
export async function quickPickSongs(
  history: SessionHistory,
  currentTrack: SongItem | null,
  favourites: SongItem[] = [],
): Promise<SongItem[]> {
  if (history.records.length === 0 && !currentTrack && favourites.length === 0) return [];
  const seeds = selectQuickPickSeeds(history.records, currentTrack, QUICK_PICK_SEEDS, favourites);
  if (seeds.length === 0) return [];
  const lanes = await Promise.all(seeds.map((seed) => relatedSongs(seed.videoId)));
  const played = new Set(history.songs.map(songIdOf));
  if (currentTrack) played.add(songIdOf(currentTrack));
  return interleaveQuickPickLanes(lanes, QUICK_PICK_SONGS, played);
}

/** Five shuffled session-history seeds, one related pick each. */
export async function dailyDiscoverSection(history: SessionHistory): Promise<PersonalSection | null> {
  const seeds = shuffled(history.songs).slice(0, DAILY_DISCOVER_SEEDS);
  if (seeds.length === 0) return null;
  const picks: SongItem[] = [];
  const seen = new Set(history.songs.map(songIdOf));
  for (const seed of seeds) {
    const [pick] = await relatedSongs(songIdOf(seed));
    if (!pick) continue;
    const id = songIdOf(pick);
    if (seen.has(id)) continue;
    seen.add(id);
    picks.push(pick);
  }
  if (picks.length === 0) return null;
  return { id: 'daily-discover', title: getString('music_daily_discover'), items: toItems(picks) };
}

interface MixSeed {
  key: string;
  name: string;
  tracks: SongItem[];
}

/** Artists with at least two session tracks, most played first, then favourite artists. */
async function mixSeeds(
  history: SessionHistory,
  favouriteArtists: FavouriteArtist[],
): Promise<MixSeed[]> {
  const byArtist = new Map<string, SongItem[]>();
  for (const song of history.songs) {
    const primary = song.artists[0];
    const key = artistKeyOf(primary?.id, primary?.name);
    if (!key) continue;
    byArtist.set(key, [...(byArtist.get(key) ?? []), song]);
  }
  const seeds: MixSeed[] = history.artists
    .filter((artist) => (byArtist.get(artist.key)?.length ?? 0) >= 2)
    .slice(0, DAILY_MIX_ARTISTS)
    .map((artist) => ({ key: artist.key, name: artist.name, tracks: byArtist.get(artist.key) ?? [] }));
  if (seeds.length >= DAILY_MIX_ARTISTS) return seeds;
  const wanted = new Set(seeds.map((seed) => seed.key));
  for (const favourite of favouriteArtists) {
    if (seeds.length >= DAILY_MIX_ARTISTS) break;
    const key = artistKeyOf(favourite.id, favourite.name);
    if (!key || wanted.has(key)) continue;
    wanted.add(key);
    if (!favourite.id) continue;
    const page = await recallArtist(favourite.id);
    const tracks = page?.topSongs.slice(0, 4) ?? [];
    if (tracks.length === 0) continue;
    seeds.push({ key, name: favourite.name, tracks });
  }
  return seeds;
}

/** One "%s Mix" per top artist: their session tracks, expanded with related picks. */
export async function dailyMixSections(
  history: SessionHistory,
  favouriteArtists: FavouriteArtist[],
): Promise<PersonalSection[]> {
  const sections: PersonalSection[] = [];
  const used = new Set(history.songs.map(songIdOf));
  for (const seed of await mixSeeds(history, favouriteArtists)) {
    const items = [...seed.tracks];
    for (const track of seed.tracks.slice(0, 3)) {
      for (const pick of await relatedSongs(songIdOf(track))) {
        const id = songIdOf(pick);
        if (used.has(id)) continue;
        used.add(id);
        items.push(pick);
        if (items.length >= DAILY_MIX_SONGS) break;
      }
      if (items.length >= DAILY_MIX_SONGS) break;
    }
    if (items.length < 3) continue;
    sections.push({
      id: `mix-${seed.key}`,
      title: getString('music_daily_mix', seed.name),
      items: toItems(items.slice(0, DAILY_MIX_SONGS)),
      playAll: true,
    });
  }
  return sections;
}

/**
 * One "Similar to {artist}" row per top artist: their top tracks, with fan artists
 * interleaved — one from each top artist's neighbourhood in turn, so no single
 * artist's circle fills the row.
 */
export async function similarSections(history: SessionHistory): Promise<PersonalSection[]> {
  const top = history.artists.filter((artist) => artist.id).slice(0, SIMILAR_ARTISTS);
  if (top.length === 0) return [];
  const pages = await Promise.all(top.map((artist) => recallArtist(artist.id as string)));
  const relatedLists = pages.map((page) => page?.related ?? []);
  const exclude = new Set(top.map((artist) => artist.id as string));
  const fanIds = pickFanArtists(
    relatedLists.map((related) => related.map((artist) => artist.id)),
    exclude,
    SIMILAR_ARTISTS * SIMILAR_FAN_ARTISTS,
  );
  const fanById = new Map<string, ArtistItem>();
  for (const related of relatedLists) {
    for (const artist of related) fanById.set(artist.id, artist);
  }
  const sections: PersonalSection[] = [];
  top.forEach((artist, index) => {
    const page = pages[index];
    const songs = (page?.topSongs ?? []).slice(0, SIMILAR_TOP_SONGS);
    if (songs.length === 0) return;
    const fans = fanIds
      .map((id) => fanById.get(id))
      .filter((fan): fan is ArtistItem => !!fan)
      .map((fan) => ({ type: 'artist' as const, ...fan }));
    sections.push({
      id: `similar-${artist.key}`,
      title: `${getString('music_similar_to')} ${artist.name}`,
      items: interleaveSimilar(toItems(songs), [fans]),
    });
  });
  return sections;
}
