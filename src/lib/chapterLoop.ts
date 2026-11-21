import type { LoopChapter } from "../types/video";

/**
 * How early playback re-seeks, so the loop catches the chapter end before the
 * video's own ended event (a timeupdate lands about every 250ms).
 */
export const CHAPTER_LOOP_END_EPSILON_SECONDS = 0.25;

/** True when playback has reached the end of the looped chapter. */
export function shouldLoopBack(
  loop: LoopChapter | null,
  videoId: string | null | undefined,
  currentTime: number,
): boolean {
  if (!loop || loop.videoId !== videoId) return false;
  if (!(loop.endSeconds > loop.startSeconds)) return false;
  return currentTime >= loop.endSeconds - CHAPTER_LOOP_END_EPSILON_SECONDS;
}

/**
 * True when a seek leaves the looped chapter, so the loop turns off. The
 * loop's own re-seek lands on the chapter start, inside the range, so it
 * never turns itself off.
 */
export function seekLeavesLoop(
  loop: LoopChapter | null,
  videoId: string | null | undefined,
  time: number,
): boolean {
  if (!loop || loop.videoId !== videoId) return false;
  return time < loop.startSeconds || time > loop.endSeconds;
}
