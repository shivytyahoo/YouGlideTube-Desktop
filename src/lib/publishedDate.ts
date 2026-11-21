import type { VideoSummary } from "../types/video";

// Mirrors the Android app's DateDisplay.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function parseRelativeToTimestamp(text: string, now = Date.now()): number | null {
  const n = text.toLowerCase().replace(/streamed|premiered|live|ago/g, "").trim();
  if (!n) return null;
  if (n.includes("just now") || n.includes("today")) return now;
  if (n.includes("yesterday")) return now - DAY_MS;

  const compactMatch = n.match(
    /(\d+)\s*(mo|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|[smhdwy])\b/,
  );
  const value = Number(compactMatch?.[1] ?? n.match(/\d+/)?.[0]);
  if (!Number.isFinite(value)) return null;

  const compactUnit = compactMatch?.[2] ?? "";
  const is = (units: string[], word: string) => units.includes(compactUnit) || n.includes(word);
  let unitMs: number;
  if (is(["s", "sec", "secs", "second", "seconds"], "second")) unitMs = SECOND_MS;
  else if (is(["m", "min", "mins", "minute", "minutes"], "minute")) unitMs = MINUTE_MS;
  else if (is(["h", "hr", "hrs", "hour", "hours"], "hour")) unitMs = HOUR_MS;
  else if (is(["d"], "day")) unitMs = DAY_MS;
  else if (is(["w"], "week")) unitMs = 7 * DAY_MS;
  else if (is(["mo"], "month")) unitMs = 30 * DAY_MS;
  else if (is(["y"], "year")) unitMs = 365 * DAY_MS;
  else return null;
  return now - value * unitMs;
}

export function formatYouTubeRelativeTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
  if (days >= 365) return format.format(-Math.floor(days / 365), "year");
  if (days >= 30) return format.format(-Math.floor(days / 30), "month");
  if (days >= 7) return format.format(-Math.floor(days / 7), "week");
  if (days > 0) return format.format(-days, "day");
  if (hours > 0) return format.format(-hours, "hour");
  if (minutes > 0) return format.format(-minutes, "minute");
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(0, "second");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseAbsoluteDate(text: string): number | null {
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])).getTime();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  const monthFirst = text.match(/^([a-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})$/i);
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})$/i);
  const [month, day, year] = monthFirst
    ? [monthFirst[1], monthFirst[2], monthFirst[3]]
    : dayFirst
      ? [dayFirst[2], dayFirst[1], dayFirst[3]]
      : [];
  const monthIndex = month ? MONTHS.indexOf(month.slice(0, 3).toLowerCase()) : -1;
  if (monthIndex < 0) return null;
  return new Date(Number(year), monthIndex, Number(day)).getTime();
}

export function parseToTimestamp(text: string | null | undefined, now = Date.now()): number | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 100_000_000_000) return numeric;

  const cleanRaw = raw.replace(/^(streamed|premiered)\s+(live\s+)?(on\s+)?/i, "").trim();
  return parseAbsoluteDate(cleanRaw) ?? parseRelativeToTimestamp(cleanRaw, now);
}

export function resolveDisplayUploadTimestamp(
  text: string,
  storedTimestamp: number | null | undefined,
  now = Date.now(),
): number | null {
  const stored = storedTimestamp && storedTimestamp > 0 ? storedTimestamp : null;
  const relative = parseRelativeToTimestamp(text, now);
  if (stored !== null && relative !== null) return Math.min(stored, relative);
  if (relative !== null) return relative;
  return preferStoredWithinDay(parseToTimestamp(text, now), stored);
}

// A date alone parses to midnight, so on the same day the stored time is more precise.
function preferStoredWithinDay(parsed: number | null, stored: number | null): number | null {
  if (parsed === null) return stored;
  if (stored === null) return parsed;
  return new Date(parsed).toDateString() === new Date(stored).toDateString() ? stored : parsed;
}

function relativePrefix(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("streamed ")) return "Streamed";
  if (lower.startsWith("premiered ")) return "Premiered";
  return null;
}

/** The upload time the backend read from the card's text; it reads every language, this file only English. */
export function backendPublishedTimestamp(video: VideoSummary): number | null {
  return video.publishedAtMs && video.publishedAtMs > 0 ? video.publishedAtMs : null;
}

export function withPublishedAt(video: VideoSummary, now = Date.now()): VideoSummary {
  if (!video.publishedText) return video;
  const fromBackend = video.publishedAt ? null : backendPublishedTimestamp(video);
  const publishedAt = fromBackend ?? resolveDisplayUploadTimestamp(video.publishedText, video.publishedAt, now);
  if (publishedAt === null || publishedAt === video.publishedAt) return video;
  return { ...video, publishedAt };
}

// --- Date & time display (Android's DateDisplay.kt, DateTimeScreen.kt) ---

export type DateDisplayMode = "relative" | "exact" | "both";
export type DateContextMode = "default" | "relative" | "exact" | "both";
export type DateFormatStyle = "system" | "mmm_d_yyyy" | "d_mmm_yyyy" | "iso" | "dmy_slash" | "mdy_slash";
export type DateContext = "lists" | "watch" | "description";

export interface DateDisplaySettings {
  mode: DateDisplayMode;
  formatStyle: DateFormatStyle;
  listsMode: DateContextMode;
  watchMode: DateContextMode;
  descriptionMode: DateContextMode;
}

export const DEFAULT_DATE_DISPLAY_SETTINGS: DateDisplaySettings = {
  mode: "relative",
  formatStyle: "system",
  listsMode: "default",
  watchMode: "default",
  descriptionMode: "default",
};

const DATE_DISPLAY_MODES: readonly string[] = ["relative", "exact", "both"];
const DATE_CONTEXT_MODES: readonly string[] = ["default", "relative", "exact", "both"];
const DATE_FORMAT_STYLES: readonly string[] = ["system", "mmm_d_yyyy", "d_mmm_yyyy", "iso", "dmy_slash", "mdy_slash"];

/** Stored values are plain strings; an unknown one falls back to the default. */
export function dateDisplaySettingsFromValues(values: {
  mode?: string;
  formatStyle?: string;
  listsMode?: string;
  watchMode?: string;
  descriptionMode?: string;
}): DateDisplaySettings {
  return {
    mode: (DATE_DISPLAY_MODES.includes(values.mode ?? "") ? values.mode : "relative") as DateDisplayMode,
    formatStyle: (DATE_FORMAT_STYLES.includes(values.formatStyle ?? "")
      ? values.formatStyle
      : "system") as DateFormatStyle,
    listsMode: (DATE_CONTEXT_MODES.includes(values.listsMode ?? "") ? values.listsMode : "default") as DateContextMode,
    watchMode: (DATE_CONTEXT_MODES.includes(values.watchMode ?? "") ? values.watchMode : "default") as DateContextMode,
    descriptionMode: (DATE_CONTEXT_MODES.includes(values.descriptionMode ?? "")
      ? values.descriptionMode
      : "default") as DateContextMode,
  };
}

export function resolveDateDisplayMode(settings: DateDisplaySettings, context: DateContext): DateDisplayMode {
  const override =
    context === "lists" ? settings.listsMode : context === "watch" ? settings.watchMode : settings.descriptionMode;
  return override === "default" ? settings.mode : override;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** The exact date, in the chosen style. Empty when the moment is unknown. */
export function formatExactDate(timestampMs: number, style: DateFormatStyle): string {
  if (!timestampMs || timestampMs <= 0) return "";
  const date = new Date(timestampMs);
  // Intl orders the fields by locale, so the "d MMM yyyy" pattern is assembled
  // by hand from the locale's short month name; only "system" takes the
  // locale's own ordering wholesale.
  const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  switch (style) {
    case "iso":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    case "dmy_slash":
      return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
    case "mdy_slash":
      return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()}`;
    case "mmm_d_yyyy":
      return `${monthShort} ${date.getDate()}, ${date.getFullYear()}`;
    case "d_mmm_yyyy":
      return `${date.getDate()} ${monthShort} ${date.getFullYear()}`;
    case "system":
    default:
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
  }
}

/**
 * The moment behind a calendar date, only when something actually knows it: absolute text
 * ("Jun 18, 2025"), a timestamp from an exact source, or an age under a day. "1 year ago"
 * alone covers twelve months, so turning it into a date would print one the upload never
 * had — the same rule as Android's exactUploadTimestamp.
 */
function exactUploadTimestamp(
  text: string,
  resolvedTimestamp: number | null,
  timestampMs: number | null,
  timestampIsExact: boolean,
  now: number,
): number | null {
  if (timestampIsExact && timestampMs !== null && timestampMs > 0) return timestampMs;
  const relative = parseRelativeToTimestamp(text, now);
  if (relative !== null) {
    // Under a day the calendar date follows from the age; "3 days ago" could be either of two dates.
    return now - relative < DAY_MS ? resolvedTimestamp : null;
  }
  return parseToTimestamp(text, now) !== null ? resolvedTimestamp : null;
}

export interface FormatUploadDateOptions {
  /** A stored/backend timestamp to pin the text to. */
  timestampMs?: number | null;
  /** The timestamp is the exact upload moment (e.g. a settings preview sample). */
  timestampIsExact?: boolean;
  now?: number;
}

/** How an upload date reads, in the mode the user chose for this place. */
export function formatUploadDate(
  text: string | null | undefined,
  settings: DateDisplaySettings,
  context: DateContext,
  options: FormatUploadDateOptions = {},
): string {
  const raw = text?.trim() ?? "";
  if (!raw) return "";
  if (raw.toLowerCase() === "live") return "LIVE";
  const now = options.now ?? Date.now();
  const stored = options.timestampMs && options.timestampMs > 0 ? options.timestampMs : null;
  const timestamp = resolveDisplayUploadTimestamp(raw, stored, now);
  if (timestamp === null) return raw;
  const mode = resolveDateDisplayMode(settings, context);
  const prefix = relativePrefix(raw);
  const relativeCore = formatYouTubeRelativeTime(timestamp, now);
  const relative = prefix ? `${prefix} ${relativeCore === "now" ? "just now" : relativeCore}` : relativeCore;
  const exactTimestamp = exactUploadTimestamp(raw, timestamp, stored, options.timestampIsExact ?? false, now);
  const exact =
    exactTimestamp !== null && exactTimestamp > 0 ? formatExactDate(exactTimestamp, settings.formatStyle) : "";
  const exactWithPrefix = prefix && exact ? `${prefix} ${exact}` : exact;
  switch (mode) {
    case "exact":
      return exactWithPrefix || relative;
    case "both":
      if (relative && exact) return `${relative} • ${exact}`;
      if (exactWithPrefix) return exactWithPrefix;
      return relative;
    case "relative":
    default:
      return relative;
  }
}
