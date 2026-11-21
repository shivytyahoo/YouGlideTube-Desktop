// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoReactions } from "./useVideoReactions";
import { useLikesStore } from "../store/useLikesStore";
import { useUiStore } from "../store/useUiStore";
import type { VideoSummary } from "../types/video";

const settings = new Map<string, string>();
vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
  addWatchRecord: vi.fn(),
  blockChannel: vi.fn(),
  unblockChannel: vi.fn(),
}));

const getAccountSignedIn = vi.fn(async () => false);
const setVideoLiked = vi.fn(async (_videoId: string, _liked: boolean) => true);
vi.mock("./api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  setVideoLiked: (videoId: string, liked: boolean) => setVideoLiked(videoId, liked),
}));

const showSaveToast = vi.fn();
const showSaveFailedToast = vi.fn();
vi.mock("./saveToast", () => ({
  showSaveToast: (...args: unknown[]) => showSaveToast(...args),
  showSaveFailedToast: (...args: unknown[]) => showSaveFailedToast(...args),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = {
  id: "vid00000001",
  title: "Test Video",
  channelName: "Channel",
  thumbnailUrl: null,
} as VideoSummary;

let latest: ReturnType<typeof useVideoReactions>;
let root: Root;

function Harness() {
  latest = useVideoReactions(video, null);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  getAccountSignedIn.mockResolvedValue(false);
  setVideoLiked.mockResolvedValue(true);
  useLikesStore.setState({ items: [], loaded: true });
  useUiStore.setState({ toast: null });
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

async function renderHarness() {
  await act(async () => {
    root.render(createElement(Harness));
  });
}

describe("useVideoReactions server confirmation", () => {
  it("confirms a like on the account and moves the count", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    await renderHarness();
    await act(async () => {
      await latest.like();
    });
    await vi.waitFor(() => expect(setVideoLiked).toHaveBeenCalledWith("vid00000001", true));
    expect(latest.state).toBe("liked");
    expect(latest.likeDelta).toBe(1);
    expect(showSaveToast).toHaveBeenCalled();
  });

  it("rolls the like back and says so when the account refuses it", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    setVideoLiked.mockRejectedValueOnce(new Error("nope"));
    await renderHarness();
    await act(async () => {
      await latest.like();
    });
    await vi.waitFor(() => expect(useUiStore.getState().toast?.variant).toBe("error"));
    expect(useUiStore.getState().toast?.message).toContain("Google account");
    expect(latest.state).toBe("none");
    expect(latest.likeDelta).toBe(0);
    await vi.waitFor(() => expect(useLikesStore.getState().items).toEqual([]));
  });

  it("stays local-only when signed out", async () => {
    await renderHarness();
    await act(async () => {
      await latest.like();
    });
    expect(setVideoLiked).not.toHaveBeenCalled();
    expect(latest.state).toBe("liked");
    expect(latest.likeDelta).toBe(0);
  });

  it("a dislike removes the account like", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    useLikesStore.setState({
      items: [{ kind: "video", id: video.id, likedAt: new Date().toISOString(), video }],
      loaded: true,
    });
    await renderHarness();
    expect(latest.state).toBe("liked");
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(setVideoLiked).toHaveBeenCalledWith("vid00000001", false));
    expect(latest.state).toBe("disliked");
    expect(latest.likeDelta).toBe(0);
  });
});
