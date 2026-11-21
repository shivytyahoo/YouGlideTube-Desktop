import { describe, expect, it } from "vitest";

import {
  clipTitle,
  musicDownloadRequest,
  videoDownloadRequest,
} from "./downloadActions";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const video = {
  id: "abc123def45",
  title: "Cabin",
  channelName: "RTVE",
  thumbnailUrl: null,
  durationSeconds: 300,
} as VideoSummary;
const selection = {
  formatId: "136",
  height: 1080,
  fps: 30,
  videoCodec: "AVC",
  container: "mp4",
} as const;

const track = {
  id: "abc123def45",
  videoId: "abc123def45",
  title: "Song",
  artists: [{ name: "M83", id: null }],
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  playlistId: null,
  params: null,
} as SongItem;

describe("clipTitle", () => {
  it("names a clip with its range", () => {
    expect(clipTitle("Cabin", { startMs: 60_000, endMs: 150_000 })).toBe("Cabin (1:00–2:30)");
    expect(clipTitle("Cabin", { startMs: 3_723_000, endMs: 3_729_000 })).toBe("Cabin (1:02:03–1:02:09)");
  });
});

describe("videoDownloadRequest", () => {
  it("carries a clip and suffixes the title", () => {
    const request = videoDownloadRequest(video, {}, selection, "1080p", {
      clip: { startMs: 60_000, endMs: 150_000 },
    });
    expect(request.clipStartMs).toBe(60_000);
    expect(request.clipEndMs).toBe(150_000);
    expect(request.title).toBe("Cabin (1:00–2:30)");
  });

  it("leaves a full download alone", () => {
    const request = videoDownloadRequest(video, {}, selection, "1080p");
    expect(request.clipStartMs).toBeUndefined();
    expect(request.clipEndMs).toBeUndefined();
    expect(request.title).toBe("Cabin");
  });
});

describe("musicDownloadRequest", () => {
  it("carries a clip and suffixes the title", () => {
    const request = musicDownloadRequest(track, {}, "AAC", {
      clip: { startMs: 60_000, endMs: 150_000 },
    });
    expect(request.clipStartMs).toBe(60_000);
    expect(request.clipEndMs).toBe(150_000);
    expect(request.title).toBe("Song (1:00–2:30)");
  });
});
