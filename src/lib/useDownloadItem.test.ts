import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDownloadItemActions } from "./useDownloadItem";
import type { DownloadProgress } from "./api/downloads";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useUiStore } from "../store/useUiStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockRevealDownload } = vi.hoisted(() => ({
  mockRevealDownload: vi.fn(async (_videoId: string, _kind: string) => {}),
}));

vi.mock("./api/downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/downloads")>();
  return { ...actual, revealDownload: mockRevealDownload };
});

const progress: DownloadProgress = {
  id: "dl-1",
  title: "A video",
  mediaKind: "video",
  qualityLabel: "1080p",
  filePath: "/videos/A video.mp4",
  downloadedBytes: 100,
  totalBytes: 100,
  status: "completed",
  error: null,
  errorKind: null,
  videoId: "vid00000001",
  thumbnailUrl: null,
  collectionDbId: null,
  artist: null,
  bytesPerSecond: null,
  etaSeconds: null,
};

function Probe() {
  const actions = useDownloadItemActions();
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => actions.play(progress) }, "play"),
    createElement("button", { type: "button", onClick: () => actions.reveal(progress) }, "reveal"),
  );
}

describe("useDownloadItemActions failures", () => {
  let host: HTMLDivElement;
  let root: Root;

  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mockRevealDownload.mockClear();
    mockRevealDownload.mockImplementation(async () => {});
    useDownloadsLibraryStore.setState({ records: [] });
    useUiStore.setState({ toast: null });
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(Probe)));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("says so when the download's file is gone instead of silently doing nothing", () => {
    act(() => {
      button("play").click();
    });
    expect(useUiStore.getState().toast?.message).toBe("That download is no longer on this device.");
    expect(useUiStore.getState().toast?.variant).toBe("error");
  });

  it("says so when showing the download in its folder fails", async () => {
    mockRevealDownload.mockRejectedValueOnce(new Error("gone"));
    await act(async () => {
      button("reveal").click();
    });
    expect(mockRevealDownload).toHaveBeenCalledWith("vid00000001", "video");
    expect(useUiStore.getState().toast?.message).toBe("Couldn't show the download in its folder.");
    expect(useUiStore.getState().toast?.variant).toBe("error");
  });
});
