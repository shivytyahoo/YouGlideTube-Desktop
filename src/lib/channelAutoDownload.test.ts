import { beforeEach, describe, expect, it, vi } from "vitest";

const checkChannelAutoDownloads = vi.fn();
vi.mock("./api/downloads", () => ({
  checkChannelAutoDownloads: (...args: unknown[]) => checkChannelAutoDownloads(...args),
}));
const startVideoDownload = vi.fn();
vi.mock("./downloadActions", () => ({
  startVideoDownload: (...args: unknown[]) => startVideoDownload(...args),
}));
const library = { ensureLoaded: async () => undefined, downloadedIds: new Set<string>() };
vi.mock("../store/useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: { getState: () => library },
}));
const active: Record<string, unknown> = {};
vi.mock("../store/useDownloadStore", () => ({
  useDownloadStore: { getState: () => ({ active }) },
}));

import {
  CHANNEL_AUTO_DOWNLOAD_FIRST_RUN_MS,
  CHANNEL_AUTO_DOWNLOAD_INTERVAL_MS,
  parseAutoDownloadChannels,
  runChannelAutoDownloadPass,
  withAutoDownloadChannel,
} from "./channelAutoDownload";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";
import type { VideoSummary } from "../types/video";

let counter = 0;
const video = (extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id: `v${++counter}`,
  title: "Video",
  channelName: "Chan",
  channelId: "UC1",
  durationSeconds: 600,
  ...extra,
});

const optedIn = () =>
  useAppSettingsStore.setState({
    values: { [SETTINGS.AUTO_DOWNLOAD_CHANNELS]: JSON.stringify({ UC1: 100 }) },
  });

describe("channel opt-in map", () => {
  it("parses only positive epochs", () => {
    expect(parseAutoDownloadChannels('{"UC1": 1700000000, "UC2": 0, "UC3": "soon"}')).toEqual({
      UC1: 1_700_000_000,
    });
    expect(parseAutoDownloadChannels("")).toEqual({});
    expect(parseAutoDownloadChannels(undefined)).toEqual({});
    expect(parseAutoDownloadChannels("not json")).toEqual({});
    expect(parseAutoDownloadChannels("[1]")).toEqual({});
  });

  it("opts a channel in from now and back out", () => {
    const before = Math.floor(Date.now() / 1000);
    const next = withAutoDownloadChannel({}, "UC9", true);
    expect(next.UC9).toBeGreaterThanOrEqual(before);
    expect(withAutoDownloadChannel(next, "UC9", false)).toEqual({});
    expect(withAutoDownloadChannel({ UC1: 100 }, "UC2", true).UC1).toBe(100);
  });
});

describe("channel auto-download pass", () => {
  beforeEach(() => {
    checkChannelAutoDownloads.mockReset().mockResolvedValue({ candidates: [], failedChannelIds: [] });
    startVideoDownload.mockReset().mockResolvedValue({ id: "job" });
    library.downloadedIds = new Set();
    for (const key of Object.keys(active)) delete active[key];
    useUiStore.setState({ toast: null });
    optedIn();
  });

  it("runs 20 seconds after launch and then every 30 minutes", () => {
    expect(CHANNEL_AUTO_DOWNLOAD_FIRST_RUN_MS).toBe(20_000);
    expect(CHANNEL_AUTO_DOWNLOAD_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("stays off with no opted-in channel", async () => {
    useAppSettingsStore.setState({ values: {} });
    await expect(runChannelAutoDownloadPass()).resolves.toBe(0);
    expect(checkChannelAutoDownloads).not.toHaveBeenCalled();
  });

  it("queues new uploads and skips what is already handled", async () => {
    library.downloadedIds = new Set(["v1"]);
    active["job"] = { videoId: "v2", id: "job" };
    checkChannelAutoDownloads.mockResolvedValue({
      candidates: [
        video({ id: "v1" }),
        video({ id: "v2" }),
        video({ id: "v3" }),
        video({ id: "v4", isShort: true }),
        video({ id: "v5", isLive: true }),
      ],
      failedChannelIds: [],
    });
    await expect(runChannelAutoDownloadPass()).resolves.toBe(1);
    expect(startVideoDownload).toHaveBeenCalledTimes(1);
    expect(startVideoDownload).toHaveBeenCalledWith(expect.objectContaining({ id: "v3" }), expect.anything());
    expect(useUiStore.getState().toast?.message).toContain("1");
  });

  it("a failed check queues nothing and stays quiet", async () => {
    checkChannelAutoDownloads.mockRejectedValue(new Error("offline"));
    await expect(runChannelAutoDownloadPass()).resolves.toBe(0);
    expect(startVideoDownload).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast).toBeNull();
  });
});
