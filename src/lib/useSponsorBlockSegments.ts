import { useEffect } from "react";
import { getSponsorBlockSegments, type SponsorBlockSegment } from "./api/foss";
import { downloadSponsorSegments, useDownloadedVideoRecord } from "./useDownloads";
import { isLocalMediaId } from "./localMediaId";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";

/** Whether SponsorBlock is off for the video playing, per the settings-menu toggle. */
export function useSponsorBlockOffForVideo(): boolean {
  const offVideoId = usePlayerStore((s) => s.sponsorBlockOffVideoId);
  const currentVideoId = usePlayerStore((s) => s.currentVideo?.id);
  return offVideoId != null && currentVideoId != null && offVideoId === currentVideoId;
}

/**
 * Keeps the store's segments on the video this player is playing. It lives with
 * the player because the pop-out window and a queued video in the mini player
 * have no Watch page to load them.
 */
export function useSponsorBlockSegments(videoId: string | null | undefined) {
  const offlineRecord = useDownloadedVideoRecord(videoId);
  const setSegments = usePlayerStore((s) => s.setSponsorBlockSegments);
  const offForVideo = useSponsorBlockOffForVideo();

  useEffect(() => {
    // Cleared first, so a slow or failed request can't skip this video at the
    // last video's timestamps.
    setSegments([]);
    if (!videoId || isLocalMediaId(videoId)) return;
    // Off for this video: no segments, so nothing is skipped or drawn.
    if (offForVideo) return;

    let cancelled = false;
    void (async () => {
      try {
        await useSettingsStore.getState().loadSettings();
        const settings = useSettingsStore.getState();
        if (cancelled || !settings.sponsorBlockEnabled) return;

        // A saved video skips with the segments stored when it was downloaded.
        const segments = offlineRecord
          ? downloadSponsorSegments<SponsorBlockSegment>(offlineRecord)
          : await getSponsorBlockSegments(videoId, settings.serverUrl).catch(() => []);
        if (!cancelled) setSegments(segments);
      } catch (e) {
        console.warn("Failed SponsorBlock loading process", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId, offlineRecord, setSegments, offForVideo]);
}
