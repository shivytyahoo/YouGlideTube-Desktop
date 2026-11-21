import { addWatchRecord } from "./api/db";
import { recapView } from "./recap/recapQueue";
import { shouldRecordWatchHistory } from "./deepGlide";
import type { ShortItem } from "../types/shorts";

/** Below this a Short was flicked past: it stays out of history. */
const HISTORY_MIN_MS = 2000;
interface View {
  short: ShortItem;
  positionMs: number;
  durationMs: number;
}

let current: View | null = null;

/**
 * Follows the Short on screen. Each viewing is recorded once, when the next
 * one starts or the feed closes, in the recap ledger and watch history.
 */
export function startShortView(short: ShortItem) {
  if (current?.short.id === short.id) return;
  finishShortView();
  current = {
    short,
    positionMs: 0,
    durationMs: 0,
  };
}

export function noteShortProgress(id: string, positionMs: number, durationMs: number) {
  if (current?.short.id !== id) return;
  if (durationMs > 0) current.durationMs = durationMs;
  current.positionMs = Math.max(current.positionMs, positionMs);
}

export function finishShortView() {
  const view = current;
  current = null;
  if (!view) return;
  // Never started playing: there is nothing to record.
  if (view.durationMs <= 0) return;
  recapView({
    videoId: view.short.id,
    title: view.short.title,
    channelId: view.short.channelId ?? "",
    channelName: view.short.channelName,
    format: "SHORT",
    watchedMs: Math.round(view.positionMs),
    counted: view.positionMs >= HISTORY_MIN_MS,
    skipped: view.positionMs < HISTORY_MIN_MS,
    continued: false,
  });
  // In history a watched Short can open related reel chains, as the Android app's do.
  if (view.positionMs >= HISTORY_MIN_MS && shouldRecordWatchHistory()) {
    void addWatchRecord({
      videoId: view.short.id,
      title: view.short.title,
      channelName: view.short.channelName,
      channelId: view.short.channelId ?? null,
      watchDate: new Date().toISOString(),
      watchDurationSeconds: Math.floor(view.positionMs / 1000),
      totalDurationSeconds: Math.ceil(view.durationMs / 1000),
      isMusic: false,
      isShort: true,
    }).catch((error) => {
      console.warn("Failed to save a Short to history", error);
    });
  }
}
