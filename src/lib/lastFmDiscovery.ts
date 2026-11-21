import { getMusicHistory } from './api/db';
import { searchMusicTyped } from './api/music';
import { getScrobbleSimilarTracks, type SimilarTrack } from './api/scrobble';
import { audioMusicOnly, songIdOf } from './musicRecall';
import { foldForSearch } from './musicVideoMatching';
import type { SongItem, YTItem } from '../types/music';

const SEEDS = 3;
const PER_SEED = 15;
const SHOWN = 12;
const PARALLEL_SEARCHES = 4;
const TTL_MS = 6 * 60 * 60 * 1000;

/** Case, accents and spacing ignored, so "Beyoncé" matches "BEYONCE". */
export function matchKey(text: string): string {
  return foldForSearch(text).trim().replace(/\s+/g, ' ');
}

const pairKey = (track: SimilarTrack) => `${matchKey(track.artist)} ${matchKey(track.title)}`;

/** Takes from each seed in turn, so one song's neighbourhood can't fill the shelf, and skips the seeds. */
export function discoveryPicks(similar: SimilarTrack[][], seeds: SimilarTrack[], limit: number): SimilarTrack[] {
  const seen = new Set(seeds.map(pairKey));
  const longest = Math.max(0, ...similar.map((tracks) => tracks.length));
  const picks: SimilarTrack[] = [];
  for (let index = 0; index < longest && picks.length < limit; index += 1) {
    for (const tracks of similar) {
      const track = tracks[index];
      if (!track || picks.length >= limit || seen.has(pairKey(track))) continue;
      seen.add(pairKey(track));
      picks.push(track);
    }
  }
  return picks;
}

/** Runs `job` over `items` a few at a time, never one search per item all at once. */
export async function inChunks<T, R>(items: T[], size: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(job))));
  }
  return results;
}

export const songsIn = (items: YTItem[]): SongItem[] =>
  items.filter((item): item is Extract<YTItem, { type: 'song' }> => item.type === 'song');

/** The song on YouTube Music, kept only when its artist matches; a near match is left out, not guessed. */
async function findSong({ artist, title }: SimilarTrack): Promise<SongItem | null> {
  const wanted = matchKey(artist);
  const found = await searchMusicTyped(`${artist} ${title}`, 'songs').catch(() => null);
  const songs = audioMusicOnly(songsIn(found?.sections.flatMap((section) => section.items) ?? []));
  return songs.find((song) => song.artists.some((candidate) => matchKey(candidate.name) === wanted)) ?? null;
}

let cached: { seeds: string; at: number; songs: SongItem[] } | null = null;

/** The songs on repeat lately, from the user's own listen history. */
async function repeatSeeds(): Promise<SimilarTrack[]> {
  const history = await getMusicHistory(100, 0).catch(() => []);
  const plays = new Map<string, { artist: string; title: string; count: number; at: number }>();
  for (const record of history) {
    const id = record.videoId;
    if (!id || !record.title) continue;
    const seen = plays.get(id);
    const at = Date.parse(record.watchDate) || 0;
    if (seen) {
      seen.count += 1;
      if (at > seen.at) seen.at = at;
    } else {
      plays.set(id, { artist: record.channelName ?? '', title: record.title, count: 1, at });
    }
  }
  return [...plays.values()]
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .slice(0, SEEDS)
    .map(({ artist, title }) => ({ artist, title }));
}

/** Songs Last.fm's listeners pair with what you have on repeat, kept for a while as the seeds stay the same. */
export async function lastFmDiscoverySongs(now = Date.now()): Promise<SongItem[]> {
  const seedPairs = await repeatSeeds();
  if (seedPairs.length === 0) return [];
  const seedIds = seedPairs.map((seed) => pairKey(seed)).join(',');
  if (cached?.seeds === seedIds && now - cached.at < TTL_MS) return cached.songs;
  const similar = await Promise.all(
    seedPairs.map((seed) => getScrobbleSimilarTracks(seed.artist, seed.title, PER_SEED).catch(() => [])),
  );
  const found = await inChunks(discoveryPicks(similar, seedPairs, SHOWN), PARALLEL_SEARCHES, findSong);
  const unique = new Map(found.filter((song): song is SongItem => !!song).map((song) => [songIdOf(song), song]));
  const songs = [...unique.values()];
  cached = { seeds: seedIds, at: now, songs };
  return songs;
}

export function clearLastFmDiscoveryCache(): void {
  cached = null;
}
