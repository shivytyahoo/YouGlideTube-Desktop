import { useEffect } from "react";

import { checkChannelAutoDownloads } from "./api/downloads";
import { isTauriEnv } from "./api/env";
import { startVideoDownload } from "./downloadActions";
import { getPlural } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useDownloadStore } from "../store/useDownloadStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";

/** First pass after launch; the app has settled by then. */
export const CHANNEL_AUTO_DOWNLOAD_FIRST_RUN_MS = 20_000;
/** A pass every half hour while the app stays open. */
export const CHANNEL_AUTO_DOWNLOAD_INTERVAL_MS = 30 * 60 * 1000;

/** `{ channelId: opt-in epoch seconds }`, tolerant of a corrupt stored value. */
export function parseAutoDownloadChannels(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const next: Record<string, number> = {};
    for (const [channelId, epoch] of Object.entries(parsed as Record<string, unknown>)) {
      const seconds = typeof epoch === "number" ? Math.floor(epoch) : Number.NaN;
      if (channelId && Number.isFinite(seconds) && seconds > 0) next[channelId] = seconds;
    }
    return next;
  } catch {
    return {};
  }
}

/** The map with one channel opted in from now, or out. */
export function withAutoDownloadChannel(
  channels: Record<string, number>,
  channelId: string,
  enabled: boolean,
): Record<string, number> {
  const next = { ...channels };
  if (enabled) next[channelId] = Math.floor(Date.now() / 1000);
  else delete next[channelId];
  return next;
}

/** A download already there wins, whatever its state: a failed or paused one was the viewer's call. */
async function alreadyHandled(videoId: string): Promise<boolean> {
  const library = useDownloadsLibraryStore.getState();
  await library.ensureLoaded();
  if (useDownloadsLibraryStore.getState().downloadedIds.has(videoId)) return true;
  return Object.values(useDownloadStore.getState().active).some(
    (item) => (item.videoId ?? item.id) === videoId,
  );
}

let passRunning = false;

/** One pass: ask the backend for new uploads from opted-in channels and queue them. */
export async function runChannelAutoDownloadPass(): Promise<number> {
  if (passRunning || !navigator.onLine) return 0;
  const { values } = useAppSettingsStore.getState();
  if (Object.keys(parseAutoDownloadChannels(values[SETTINGS.AUTO_DOWNLOAD_CHANNELS])).length === 0) {
    return 0;
  }
  passRunning = true;
  try {
    const { candidates } = await checkChannelAutoDownloads();
    let queued = 0;
    for (const video of candidates) {
      if (video.isLive || video.isUpcoming || video.isShort || video.isMembersOnly) continue;
      if (await alreadyHandled(video.id)) continue;
      try {
        await startVideoDownload(video, values);
        queued += 1;
      } catch (error) {
        console.warn("Failed to save a new upload from a channel", video.id, error);
      }
    }
    if (queued > 0) {
      useUiStore.getState().showToast({ message: getPlural("auto_download_channels_queued", queued) });
    }
    return queued;
  } catch (error) {
    console.warn("Failed to check channels for new uploads", error);
    return 0;
  } finally {
    passRunning = false;
  }
}

/** Starts the background pass: 20 seconds after launch, then every 30 minutes. */
export function useChannelAutoDownloads(): void {
  useEffect(() => {
    let disposed = false;
    let first: number | undefined;
    let interval: number | undefined;
    void isTauriEnv().then((tauri) => {
      if (!tauri || disposed) return;
      first = window.setTimeout(() => {
        void runChannelAutoDownloadPass();
        interval = window.setInterval(
          () => void runChannelAutoDownloadPass(),
          CHANNEL_AUTO_DOWNLOAD_INTERVAL_MS,
        );
      }, CHANNEL_AUTO_DOWNLOAD_FIRST_RUN_MS);
    });
    return () => {
      disposed = true;
      if (first !== undefined) window.clearTimeout(first);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
}
