import { addWatchRecord } from "./api/db";
import { shouldRecordWatchHistory } from "./deepGlide";
import type { SongItem } from "../types/music";

const videoIdOf = (t: SongItem): string => t.videoId ?? t.id;

/**
 * Saves a listen of `listenedSeconds` actually played (not the playhead) to the
 * shared history, as a music row so it never feeds the video brain.
 */
export async function recordSongHistory(
  track: SongItem,
  listenedSeconds: number,
  totalSeconds: number,
): Promise<void> {
  const id = videoIdOf(track);
  const channelName = track.artists.map((a) => a.name).filter(Boolean).join(", ");
  const total = Math.floor(totalSeconds || track.duration || 0);
  const watched = Math.floor(Math.max(0, listenedSeconds));

  if (shouldRecordWatchHistory()) {
    try {
      await addWatchRecord({
        videoId: id,
        title: track.title,
        channelName,
        watchDate: new Date().toISOString(),
        watchDurationSeconds: watched,
        totalDurationSeconds: total,
        isMusic: true,
      });
    } catch (e) {
      console.warn("Failed to save song to watch history", e);
    }
  }
}
