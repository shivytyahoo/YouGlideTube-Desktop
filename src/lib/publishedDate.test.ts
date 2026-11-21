import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATE_DISPLAY_SETTINGS,
  formatExactDate,
  formatUploadDate,
  formatYouTubeRelativeTime,
  parseRelativeToTimestamp,
  parseToTimestamp,
  withPublishedAt,
  type DateDisplaySettings,
} from "./publishedDate";
import type { VideoSummary } from "../types/video";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 26, 12);

const video = (publishedText: string | null, publishedAt?: number): VideoSummary => ({
  id: "v",
  title: "v",
  channelName: "chan",
  publishedText,
  publishedAt,
});

describe("parseRelativeToTimestamp", () => {
  it("reads YouTube's relative forms", () => {
    expect(parseRelativeToTimestamp("1 hour ago", NOW)).toBe(NOW - HOUR);
    expect(parseRelativeToTimestamp("3 days ago", NOW)).toBe(NOW - 3 * DAY);
    expect(parseRelativeToTimestamp("2 months ago", NOW)).toBe(NOW - 60 * DAY);
    expect(parseRelativeToTimestamp("Streamed 5 hours ago", NOW)).toBe(NOW - 5 * HOUR);
    expect(parseRelativeToTimestamp("yesterday", NOW)).toBe(NOW - DAY);
  });

  it("returns null for absolute dates and live text", () => {
    expect(parseRelativeToTimestamp("Jun 19, 2020", NOW)).toBeNull();
    expect(parseRelativeToTimestamp("Streamed live on Jun 19, 2020", NOW)).toBeNull();
    expect(parseRelativeToTimestamp("LIVE", NOW)).toBeNull();
  });
});

describe("parseToTimestamp", () => {
  it("reads absolute dates as local midnight", () => {
    const expected = new Date(2020, 5, 19).getTime();
    expect(parseToTimestamp("Jun 19, 2020")).toBe(expected);
    expect(parseToTimestamp("19 Jun 2020")).toBe(expected);
    expect(parseToTimestamp("2020-06-19")).toBe(expected);
    expect(parseToTimestamp("Streamed live on Jun 19, 2020")).toBe(expected);
  });

  it("falls back to relative text", () => {
    expect(parseToTimestamp("3 days ago", NOW)).toBe(NOW - 3 * DAY);
  });
});

describe("formatYouTubeRelativeTime", () => {
  it("uses the largest whole unit", () => {
    expect(formatYouTubeRelativeTime(NOW - 90 * 60_000, NOW)).toBe("1 hour ago");
    expect(formatYouTubeRelativeTime(NOW - 10 * DAY, NOW)).toBe("1 week ago");
    expect(formatYouTubeRelativeTime(NOW - 400 * DAY, NOW)).toBe("1 year ago");
  });
});

describe("withPublishedAt", () => {
  it("pins relative text to the moment it is stored", () => {
    expect(withPublishedAt(video("1 hour ago"), NOW).publishedAt).toBe(NOW - HOUR);
  });

  it("keeps an earlier pinned timestamp when the same text is stored again later", () => {
    const pinned = video("1 hour ago", NOW - HOUR);
    expect(withPublishedAt(pinned, NOW + DAY)).toBe(pinned);
  });

  it("pins an absolute date, keeping a stored time from the same day", () => {
    expect(withPublishedAt(video("Jun 19, 2020"), NOW).publishedAt).toBe(new Date(2020, 5, 19).getTime());
    const sameDay = new Date(2020, 5, 19, 15).getTime();
    const pinned = video("Jun 19, 2020", sameDay);
    expect(withPublishedAt(pinned, NOW)).toBe(pinned);
  });

  it("pins text in another language to the time the backend read from it", () => {
    const spanish = { ...video("hace 3 m"), publishedAtMs: NOW - 90 * DAY };
    expect(withPublishedAt(spanish, NOW + DAY).publishedAt).toBe(NOW - 90 * DAY);
  });

  it("keeps a track pinned before the backend sent its time", () => {
    const pinned = { ...video("1 hour ago", NOW - 2 * DAY), publishedAtMs: NOW - HOUR };
    expect(withPublishedAt(pinned, NOW)).toBe(pinned);
  });

  it("leaves missing and live text alone", () => {
    expect(withPublishedAt(video(null), NOW).publishedAt).toBeUndefined();
    expect(withPublishedAt(video("LIVE"), NOW).publishedAt).toBeUndefined();
  });
});

describe("formatExactDate", () => {
  it("formats the styles", () => {
    const ts = new Date(2026, 3, 15, 12).getTime();
    expect(formatExactDate(ts, "iso")).toBe("2026-04-15");
    expect(formatExactDate(ts, "dmy_slash")).toBe("15/04/2026");
    expect(formatExactDate(ts, "mdy_slash")).toBe("04/15/2026");
    expect(formatExactDate(ts, "mmm_d_yyyy")).toBe("Apr 15, 2026");
    expect(formatExactDate(ts, "d_mmm_yyyy")).toBe("15 Apr 2026");
    expect(formatExactDate(0, "iso")).toBe("");
  });
});

describe("formatUploadDate", () => {
  const exactIso: DateDisplaySettings = {
    mode: "exact",
    formatStyle: "iso",
    listsMode: "default",
    watchMode: "default",
    descriptionMode: "default",
  };
  const bothIso: DateDisplaySettings = { ...exactIso, mode: "both" };

  it("shows relative by default and exact when asked", () => {
    const pinned = NOW - 3 * DAY;
    expect(formatUploadDate("3 days ago", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", { timestampMs: pinned, now: NOW })).toBe(
      "3 days ago",
    );
    expect(formatUploadDate("5 hours ago", exactIso, "lists", { timestampMs: NOW - 5 * HOUR, now: NOW })).toBe(
      "2026-09-26",
    );
    expect(formatUploadDate("5 hours ago", bothIso, "lists", { timestampMs: NOW - 5 * HOUR, now: NOW })).toBe(
      "5 hours ago • 2026-09-26",
    );
  });

  it("does not invent a date from a coarse age", () => {
    const pinned = NOW - 400 * DAY;
    expect(formatUploadDate("1 year ago", exactIso, "lists", { timestampMs: pinned, now: NOW })).toBe("1 year ago");
    expect(formatUploadDate("3 days ago", bothIso, "lists", { timestampMs: NOW - 3 * DAY, now: NOW })).toBe(
      "3 days ago",
    );
  });

  it("shows the exact date for absolute text and recent uploads", () => {
    const published = new Date(2026, 8, 13).getTime();
    expect(
      formatUploadDate("Sep 13, 2026", exactIso, "lists", { timestampMs: published, now: published + 13 * DAY }),
    ).toBe("2026-09-13");
    expect(
      formatUploadDate("Streamed 5 hours ago", exactIso, "lists", { timestampMs: NOW - 5 * HOUR, now: NOW }),
    ).toBe("Streamed 2026-09-26");
  });

  it("keeps live text and falls back to the server wording without a timestamp", () => {
    expect(formatUploadDate("LIVE", exactIso, "lists", { now: NOW })).toBe("LIVE");
    expect(formatUploadDate("3 days ago", exactIso, "lists", { now: NOW })).toBe("3 days ago");
  });

  it("lets a per-section override win over the global mode", () => {
    const settings: DateDisplaySettings = {
      ...DEFAULT_DATE_DISPLAY_SETTINGS,
      listsMode: "exact",
      formatStyle: "iso",
    };
    const pinned = NOW - 5 * HOUR;
    expect(formatUploadDate("5 hours ago", settings, "lists", { timestampMs: pinned, now: NOW })).toBe("2026-09-26");
    expect(formatUploadDate("5 hours ago", settings, "watch", { timestampMs: pinned, now: NOW })).toBe("5 hours ago");
  });
});

describe("formatUploadDate with the default (relative) settings", () => {
  it("ages pinned text", () => {
    const pinned = NOW - HOUR;
    expect(formatUploadDate("1 hour ago", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", { timestampMs: pinned, now: NOW + 2 * DAY })).toBe(
      "2 days ago",
    );
    expect(
      formatUploadDate("Streamed 1 hour ago", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", {
        timestampMs: pinned,
        now: NOW + 2 * DAY,
      }),
    ).toBe("Streamed 2 days ago");
  });

  it("shows an absolute date as its age", () => {
    const published = new Date(2026, 8, 13).getTime();
    expect(
      formatUploadDate("Sep 13, 2026", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", {
        timestampMs: published,
        now: published + 13 * DAY,
      }),
    ).toBe("1 week ago");
  });

  it("shows text as given without a pinned timestamp, and live text", () => {
    expect(formatUploadDate("1 hour ago", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", { now: NOW + 2 * DAY })).toBe(
      "1 hour ago",
    );
    // An absolute date still reads as its age: the text itself pins the moment.
    expect(formatUploadDate("Sep 13, 2026", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", { now: NOW })).toBe(
      "1 week ago",
    );
    expect(formatUploadDate("LIVE", DEFAULT_DATE_DISPLAY_SETTINGS, "lists", { now: NOW })).toBe("LIVE");
  });
});
