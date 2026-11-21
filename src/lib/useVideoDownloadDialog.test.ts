import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { DownloadStarted, StartDownloadRequest } from "./api/downloads";
import type { VideoSummary } from "../types/video";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOriginalTitle = vi.fn();
const getDownloadFormats = vi.fn();
const startDownload = vi.fn();
const recapVideoAction = vi.fn();
vi.mock("./api/youtube", async (original) => ({
  ...(await original<typeof import("./api/youtube")>()),
  getOriginalTitle: (videoId: string) => getOriginalTitle(videoId),
}));
vi.mock("./api/downloads", async (original) => ({
  ...(await original<typeof import("./api/downloads")>()),
  getDownloadFormats: (videoId: string) => getDownloadFormats(videoId),
  startDownload: (request: StartDownloadRequest) => startDownload(request),
}));
vi.mock("./recap/recapQueue", async (original) => ({
  ...(await original<typeof import("./recap/recapQueue")>()),
  recapVideoAction: (...args: unknown[]) => recapVideoAction(...args),
}));

const { parseClipTimestamp, useVideoDownloadDialog } = await import("./useVideoDownloadDialog");

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

// The title cache lives for the session by design, so each test uses its own id.
let nextId = 0;
const freshId = () => `dlg${String(nextId++).padStart(8, "0")}`;

function setOriginalTitles(enabled: boolean) {
  useAppSettingsStore.setState({
    values: { ...useAppSettingsStore.getState().values, [SETTINGS.ORIGINAL_TITLES]: String(enabled) },
  });
}

describe("useVideoDownloadDialog title", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dialog: ReturnType<typeof useVideoDownloadDialog>;

  function Dialog({ video }: { video: VideoSummary }) {
    dialog = useVideoDownloadDialog(video);
    return null;
  }

  const open = async (id: string) => {
    const video = { id, title: "Listed title", channelName: "RTVE" } as VideoSummary;
    act(() => root.render(createElement(Dialog, { video })));
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getOriginalTitle.mockResolvedValue("Título original");
    getDownloadFormats.mockResolvedValue({ formats: [], audioTracks: [], captions: [] });
    setOriginalTitles(true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setOriginalTitles(false);
  });

  it("keeps the listed title while switched off", async () => {
    setOriginalTitles(false);
    await open(freshId());

    expect(dialog.title).toBe("Listed title");
    expect(dialog.displayTitle).toBe("Listed title");
    expect(getOriginalTitle).not.toHaveBeenCalled();
  });

  it("names the file and the dialog by the original title", async () => {
    await open(freshId());

    expect(dialog.title).toBe("Título original");
    expect(dialog.displayTitle).toBe("Título original");
  });

  it("keeps the listed title when there is no original", async () => {
    getOriginalTitle.mockResolvedValue(null);
    await open(freshId());

    expect(dialog.title).toBe("Listed title");
  });

  it("keeps a name the user typed before the answer landed", async () => {
    let answer: (title: string) => void = () => undefined;
    getOriginalTitle.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await open(freshId());

    act(() => dialog.setTitle("My name"));
    answer("Título original");
    await flush();

    expect(dialog.title).toBe("My name");
  });

  it("goes back to the original title after a retry resets the dialog", async () => {
    await open(freshId());

    act(() => dialog.retry());
    await flush();

    expect(dialog.title).toBe("Título original");
  });
});

describe("useVideoDownloadDialog clip", () => {
  let host: HTMLDivElement;
  let root: Root;
  let dialog: ReturnType<typeof useVideoDownloadDialog>;

  function Dialog({ video }: { video: VideoSummary }) {
    dialog = useVideoDownloadDialog(video);
    return null;
  }

  const open = async (id: string) => {
    const video = { id, title: "Listed title", channelName: "RTVE", durationSeconds: 300 } as VideoSummary;
    act(() => root.render(createElement(Dialog, { video })));
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getOriginalTitle.mockResolvedValue("Título original");
    getDownloadFormats.mockResolvedValue({
      formats: [],
      audioTracks: [
        { key: "a", label: "AAC", languageCode: null, isDefault: true, codec: "AAC", bitrate: 128_000, sizeBytes: 1000 },
      ],
      captions: [],
    });
    startDownload.mockResolvedValue({ id: "job-1", filePath: "/v/Cabin.mp4" });
    setOriginalTitles(true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setOriginalTitles(false);
  });

  it("parses clip timestamps", () => {
    expect(parseClipTimestamp("1:30")).toBe(90_000);
    expect(parseClipTimestamp("1:02:03")).toBe(3_723_000);
    expect(parseClipTimestamp("90")).toBe(90_000);
    expect(parseClipTimestamp("1:60")).toBeNull();
    expect(parseClipTimestamp("abc")).toBeNull();
    expect(parseClipTimestamp("")).toBeNull();
  });

  it("prefills the clip to the full video", async () => {
    await open(freshId());

    expect(dialog.canClip).toBe(true);
    expect(dialog.clipStart).toBe("0:00");
    expect(dialog.clipEnd).toBe("5:00");
    expect(dialog.clipRange).toBeNull();
    expect(dialog.fileName).toBe("Título original");
  });

  it("refuses to start with an invalid clip", async () => {
    await open(freshId());
    act(() => {
      dialog.setMode("audio");
    });
    act(() => {
      dialog.setClipEnabled(true);
    });
    act(() => {
      dialog.setClipStart("2:00");
      dialog.setClipEnd("1:00");
    });

    let started: DownloadStarted | null = null;
    await act(async () => {
      started = await dialog.submit();
    });

    expect(started).toBeNull();
    expect(startDownload).not.toHaveBeenCalled();
    expect(dialog.clipError).toBe("Enter a valid clip range — start before end, inside the video length.");
  });

  it("starts an audio clip with its range", async () => {
    await open(freshId());
    act(() => {
      dialog.setMode("audio");
    });
    act(() => {
      dialog.setClipEnabled(true);
    });
    act(() => {
      dialog.setClipStart("1:00");
      dialog.setClipEnd("2:30");
    });

    expect(dialog.clipRange).toEqual({ startMs: 60_000, endMs: 150_000 });
    expect(dialog.fileName).toBe("Título original (1:00–2:30)");

    let started: DownloadStarted | null = null;
    await act(async () => {
      started = await dialog.submit();
    });

    expect(started).toEqual({ id: "job-1", filePath: "/v/Cabin.mp4" });
    expect(startDownload).toHaveBeenCalledTimes(1);
    const request = startDownload.mock.calls[0]?.[0] as StartDownloadRequest | undefined;
    expect(request?.clipStartMs).toBe(60_000);
    expect(request?.clipEndMs).toBe(150_000);
    expect(request?.title).toBe("Título original (1:00–2:30)");
    expect(request?.mediaKind).toBe("audio");
  });
});
