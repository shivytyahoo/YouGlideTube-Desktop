import { describe, expect, it } from "vitest";

import { SETTINGS } from "./settings/schema";
import { visibleWatchHistory, watchHistoryPruneIds } from "./watchHistoryRetention";
import type { WatchHistoryRecord } from "../types/db";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-22T12:00:00Z");

const record = (videoId: string, daysAgo: number): WatchHistoryRecord => ({
  videoId,
  title: videoId,
  watchDate: new Date(NOW - daysAgo * DAY).toISOString(),
  watchDurationSeconds: 60,
});

const values = (overrides: Record<string, string> = {}): Record<string, string | undefined> => ({
  [SETTINGS.WATCH_HISTORY_AUTO_DELETE]: "true",
  [SETTINGS.WATCH_HISTORY_RETENTION_DAYS]: "30",
  [SETTINGS.WATCH_HISTORY_MAX_SIZE]: "2",
  ...overrides,
});

describe("visibleWatchHistory", () => {
  it("drops entries older than the retention period when auto-delete is on", () => {
    const shown = visibleWatchHistory(
      [record("new", 1), record("old", 40)],
      values(),
      NOW,
    );
    expect(shown.map((item) => item.videoId)).toEqual(["new"]);
  });

  it("keeps old entries when auto-delete is off but still caps the size", () => {
    const shown = visibleWatchHistory(
      [record("a", 100), record("b", 90), record("c", 80)],
      values({ [SETTINGS.WATCH_HISTORY_AUTO_DELETE]: "false" }),
      NOW,
    );
    expect(shown.map((item) => item.videoId)).toEqual(["c", "b"]);
  });
});

describe("watchHistoryPruneIds", () => {
  it("prunes expired entries and the oldest past the max size", () => {
    expect(
      watchHistoryPruneIds(
        [record("new", 1), record("mid", 10), record("extra", 20), record("old", 40)],
        values(),
        NOW,
      ),
    ).toEqual(["old", "extra"]);
  });

  it("prunes nothing when auto-delete is off", () => {
    expect(
      watchHistoryPruneIds(
        [record("old", 400)],
        values({ [SETTINGS.WATCH_HISTORY_AUTO_DELETE]: "false" }),
        NOW,
      ),
    ).toEqual([]);
  });
});
