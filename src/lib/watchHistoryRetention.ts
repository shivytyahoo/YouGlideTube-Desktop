import { SETTINGS } from "./settings/schema";
import type { WatchHistoryRecord } from "../types/db";

const DAY_MS = 86_400_000;
export const WATCH_HISTORY_DEFAULT_RETENTION_DAYS = 90;
export const WATCH_HISTORY_DEFAULT_MAX_SIZE = 500;

type SettingValues = Record<string, string | undefined>;

const retentionDays = (values: SettingValues): number => {
  const days = Number(values[SETTINGS.WATCH_HISTORY_RETENTION_DAYS] ?? WATCH_HISTORY_DEFAULT_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : WATCH_HISTORY_DEFAULT_RETENTION_DAYS;
};

const maxSize = (values: SettingValues): number => {
  const size = Number(values[SETTINGS.WATCH_HISTORY_MAX_SIZE] ?? WATCH_HISTORY_DEFAULT_MAX_SIZE);
  return Number.isFinite(size) && size > 0 ? size : WATCH_HISTORY_DEFAULT_MAX_SIZE;
};

const autoDeleteOn = (values: SettingValues): boolean =>
  values[SETTINGS.WATCH_HISTORY_AUTO_DELETE] === "true";

/** Newest first, as the store keeps them. */
const byWatchDateDesc = (records: WatchHistoryRecord[]): WatchHistoryRecord[] =>
  [...records].sort((a, b) => Date.parse(b.watchDate) - Date.parse(a.watchDate));

/**
 * What the viewer's watch-history settings let the list show: nothing past
 * the retention age when auto-delete is on, and nothing past the max size.
 * Mirrors `visibleSearchEntries` for search history.
 */
export function visibleWatchHistory(
  records: WatchHistoryRecord[],
  values: SettingValues,
  now: number,
): WatchHistoryRecord[] {
  const oldest = autoDeleteOn(values) ? now - retentionDays(values) * DAY_MS : 0;
  return byWatchDateDesc(records)
    .filter((record) => Date.parse(record.watchDate) >= oldest)
    .slice(0, maxSize(values));
}

/** The video ids auto-delete should remove: expired ones, then the oldest past the max size. */
export function watchHistoryPruneIds(
  records: WatchHistoryRecord[],
  values: SettingValues,
  now: number,
): string[] {
  if (!autoDeleteOn(values)) return [];
  const oldest = now - retentionDays(values) * DAY_MS;
  const sorted = byWatchDateDesc(records);
  const expired = sorted
    .filter((record) => Date.parse(record.watchDate) < oldest)
    .map((record) => record.videoId);
  const kept = sorted.filter((record) => Date.parse(record.watchDate) >= oldest);
  const excess = kept.slice(maxSize(values)).map((record) => record.videoId);
  return [...new Set([...expired, ...excess])];
}
