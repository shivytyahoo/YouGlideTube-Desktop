import { MIN_SHELF_ITEMS } from './musicRecall';
import type { MusicSeedArt, MusicShelf, SongItem, YTItem } from '../types/music';

/** A shelf the app composes itself: library, discovery or server sections share this shape. */
export interface PersonalSection {
  id: string;
  title: string;
  subtitle?: string;
  items: YTItem[];
  /** The whole header opens this route. */
  route?: string;
  seedArt?: MusicSeedArt;
  /** The header offers Play all over the section's songs. */
  playAll?: boolean;
  previews?: Record<string, SongItem[]>;
}

/** `anchor` = charts/releases that can lead a first-run home. */
export type MusicFeedOrigin = 'anchor' | 'personal' | 'remote';

export interface MusicFeedSection extends PersonalSection {
  browseId?: string | null;
  params?: string | null;
  source?: string;
  origin: MusicFeedOrigin;
}

/** Quick Picks and Moods render with their own layouts, so they are slots in the order. */
export type MusicFeedEntry =
  | { kind: 'section'; section: MusicFeedSection }
  | { kind: 'quickPicks' }
  | { kind: 'moods' };

export interface ComposeOptions {
  hasMoods?: boolean;
  /** Fixes the shuffled middle of the page for one app session. */
  sessionSeed?: number;
}

const SESSION_SEED = Math.floor(Math.random() * 2 ** 32);

/** Always first, in this order, when they have content. */
const HEAD_GROUPS = [
  'your-playlists', 'your-subscriptions', 'listen-again', 'on-repeat', 'rotation', 'speed-dial', 'rediscover', 'deep-cuts', 'artists-for-you',
];

/** After the shuffled groups: this one loads as you scroll down, so it mustn't push anything above you. */
const TAIL_GROUPS = ['lastfm-discover'];

/** YouTube's shelves that have a switch of their own, by the English title Android reads them by too. */
const TITLED_SHELVES: Array<[RegExp, string]> = [
  [/music videos for you/i, 'music-videos-for-you'],
  [/live performances/i, 'live-performances'],
  [/music videos/i, 'music-videos'],
  [/^listen again$/i, 'listen-again'],
  [/^recommended$/i, 'recommended'],
  [/^top albums$/i, 'top-albums'],
];

const titledShelfId = (title: string) => TITLED_SHELVES.find(([pattern]) => pattern.test(title))?.[1];

/** Three lead groups picked by how much the user has listened; the rest are shuffled. */
const LEAD_GROUPS: Record<string, string[]> = {
  cold_start: ['charts', 'moods', 'new-releases'],
  warming: ['quick-picks', 'from-community', 'daily-discover'],
  mature: ['quick-picks', 'similar', 'from-community'],
};

/**
 * The session-discovery block, fixed after the personal block in Android's order:
 * Quick Picks, Daily Discover, Daily Mixes, then the Similar To rows. A first-run home
 * has no session to draw on, so it skips this block and leads with charts instead.
 */
const SESSION_GROUPS = ['quick-picks', 'daily-discover', 'daily-mixes', 'similar'];

function itemKey(item: YTItem): string {
  switch (item.type) {
    case 'song': {
      const artist = item.artists[0]?.id ?? item.artists[0]?.name ?? '';
      const recording = `${item.title.trim().toLowerCase()}:${artist.trim().toLowerCase()}`;
      return recording !== ':' ? `song:${recording}` : `song:${item.videoId ?? item.id}`;
    }
    case 'album': return `album:${item.browseId}`;
    default: return `${item.type}:${item.id}`;
  }
}

const isAnchor = (section: MusicShelf) =>
  section.source === 'newReleases' || !!section.source?.startsWith('chart');

function remoteSection(section: MusicShelf): MusicFeedSection {
  const first = section.items[0];
  const titled = titledShelfId(section.title);
  // YouTube's own Listen again is the same shelf as the session one, so it joins the
  // fixed personal block (third) instead of landing last with the generic feed.
  const isListenAgain = titled === 'listen-again';
  return {
    id: titled ?? `remote:${section.source ?? section.browseId ?? section.title}:${first ? itemKey(first) : ''}`,
    title: section.title,
    subtitle: section.subtitle ?? undefined,
    items: section.items,
    browseId: section.browseId,
    params: section.params,
    source: section.source,
    origin: isAnchor(section) || titled ? (isListenAgain ? 'personal' : 'anchor') : 'remote',
  };
}

/**
 * Sections that belong together share a group: a Similar to row with its Other
 * performances and More from rows, all chart shelves, all Daily Mixes.
 */
export function feedGroupOf(entry: MusicFeedEntry): string {
  if (entry.kind === 'quickPicks') return 'quick-picks';
  if (entry.kind === 'moods') return 'moods';
  const { section } = entry;
  if (section.source?.startsWith('chart')) return 'charts';
  if (section.source === 'newReleases') return 'new-releases';
  // The "{mood} Vibes" playlist row is the from-community lead.
  if (section.id === 'vibes') return 'from-community';
  const similar = /^(?:similar|performances|artist-albums)-(.+)$/.exec(section.id);
  if (similar) return `similar:${similar[1]}`;
  if (section.id.startsWith('mix-')) return 'daily-mixes';
  if (section.id.startsWith('fans-')) return 'fans';
  if (section.id.startsWith('genre-')) return 'genre-mixes';
  return section.id;
}

/** FNV-1a over seed + key: a stable pseudo-random rank that survives sections streaming in. */
function sessionRank(seed: number, key: string): number {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** A stable per-session choice of `count` items, e.g. which genres or vibe to show. */
export function pickForSession<T>(items: T[], count: number, keyOf: (item: T) => string, salt: string,
  seed: number = SESSION_SEED): T[] {
  return [...items]
    .sort((a, b) => sessionRank(seed, `${salt}:${keyOf(a)}`) - sessionRank(seed, `${salt}:${keyOf(b)}`))
    .slice(0, count);
}

function orderEntries(entries: MusicFeedEntry[], maturity: string, seed: number): MusicFeedEntry[] {
  const groups = new Map<string, MusicFeedEntry[]>();
  const generic: MusicFeedEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'section' && entry.section.origin === 'remote') {
      generic.push(entry);
      continue;
    }
    const key = feedGroupOf(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const take = (key: string): MusicFeedEntry[] => {
    if (key === 'similar') {
      const similar = [...groups.keys()].filter((group) => group.startsWith('similar:')).flatMap((group) => {
        const entries = groups.get(group) ?? [];
        groups.delete(group);
        return entries;
      });
      return similar;
    }
    const group = groups.get(key) ?? [];
    groups.delete(key);
    // The session Listen Again and YouTube's own are the same shelf: the session one
    // leads and the server copy is dropped rather than shown twice.
    return key === 'listen-again' ? group.slice(0, 1) : group;
  };
  const head = HEAD_GROUPS.flatMap(take);
  const session = maturity === 'cold_start'
    ? []
    : SESSION_GROUPS.flatMap((group) => (group === 'similar' ? take('similar') : take(group)));
  const leads = (LEAD_GROUPS[maturity] ?? LEAD_GROUPS.warming ?? []).flatMap((lead) =>
    lead === 'similar'
      ? [...groups.keys()].filter((key) => key.startsWith('similar:')).flatMap(take)
      : take(lead));
  const tail = TAIL_GROUPS.flatMap(take);
  const rest = [...groups.entries()]
    .sort(([a], [b]) => sessionRank(seed, a) - sessionRank(seed, b))
    .flatMap(([, group]) => group);
  return [...head, ...session, ...leads, ...rest, ...tail, ...generic];
}

/**
 * Orders the whole home: the fixed personal block, the session-discovery block (Quick Picks,
 * Daily Discover, Daily Mixes, Similar To) for anyone with plays behind them, three lead
 * groups chosen by listening maturity, the remaining groups in a per-session shuffle, then
 * YouTube's own feed. Below the personal block each item appears once (Quick Picks claim
 * theirs first), and a shelf that deduplication shrank below a useful size is dropped
 * rather than shown as a stub.
 */
export function composeMusicFeed(
  personal: PersonalSection[],
  remote: MusicShelf[],
  maturity: string,
  quickPicks: SongItem[],
  options: ComposeOptions = {},
): MusicFeedEntry[] {
  const entries: MusicFeedEntry[] = [
    ...personal.map((section): MusicFeedEntry => ({ kind: 'section', section: { ...section, origin: 'personal' } })),
    ...remote.map((section): MusicFeedEntry => ({ kind: 'section', section: remoteSection(section) })),
  ];
  if (quickPicks.length > 0) entries.push({ kind: 'quickPicks' });
  if (options.hasMoods) entries.push({ kind: 'moods' });

  const seen = new Set(quickPicks.map((song) => itemKey({ type: 'song', ...song })));
  const output: MusicFeedEntry[] = [];
  const hasVideosForYou = entries.some((entry) => entry.kind === 'section' && entry.section.id === 'music-videos-for-you');
  for (const entry of orderEntries(entries, maturity, options.sessionSeed ?? SESSION_SEED)) {
    if (entry.kind !== 'section') {
      output.push(entry);
      continue;
    }
    const { section } = entry;
    if (section.id === 'music-videos' && hasVideosForYou) continue;
    // The personal block is the user's own music: those shelves may repeat each other
    // (as on Android) and never take songs away from the discovery shelves below.
    if (HEAD_GROUPS.includes(feedGroupOf(entry))) {
      output.push(entry);
      continue;
    }
    const items = section.items.filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (items.length > 0 && items.length >= Math.min(MIN_SHELF_ITEMS, section.items.length)) {
      output.push({ kind: 'section', section: { ...section, items } });
    }
  }
  return output;
}
