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
const setVideoLiked = vi.fn(async (_videoId: string, _liked: boolean, _params?: string | null) => true);
const setVideoDisliked = vi.fn(async (_videoId: string, _params?: string | null) => true);
vi.mock("./api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  setVideoLiked: (videoId: string, liked: boolean, params?: string | null) => setVideoLiked(videoId, liked, params),
  setVideoDisliked: (videoId: string, params?: string | null) => setVideoDisliked(videoId, params),
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
let meta: {
  likeParams?: string | null;
  removeLikeParams?: string | null;
  dislikeParams?: string | null;
  removeDislikeParams?: string | null;
} | null = null;

function Harness() {
  latest = useVideoReactions(video, meta);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  meta = null;
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
    await vi.waitFor(() => expect(setVideoLiked).toHaveBeenCalledWith("vid00000001", true, null));
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

  it("a dislike registers on the account and moves the dislike count", async () => {
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
    await vi.waitFor(() => expect(setVideoDisliked).toHaveBeenCalledWith("vid00000001", null));
    expect(setVideoLiked).not.toHaveBeenCalled();
    expect(latest.state).toBe("disliked");
    expect(latest.likeDelta).toBe(0);
    expect(latest.dislikeDelta).toBe(1);
  });

  it("a dislike calls the server even when the video isn't in the library", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    await renderHarness();
    expect(latest.state).toBe("none");
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(setVideoDisliked).toHaveBeenCalledWith("vid00000001", null));
    expect(latest.state).toBe("disliked");
    expect(latest.dislikeDelta).toBe(1);
  });

  it("un-disliking removes the rating on the account", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    await renderHarness();
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(setVideoDisliked).toHaveBeenCalledWith("vid00000001", null));
    expect(latest.state).toBe("disliked");
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(setVideoLiked).toHaveBeenCalledWith("vid00000001", false, null));
    expect(latest.state).toBe("none");
    expect(latest.dislikeDelta).toBe(0);
  });

  it("rolls the dislike back and says so when the account refuses it", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    setVideoDisliked.mockRejectedValueOnce(new Error("nope"));
    await renderHarness();
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(useUiStore.getState().toast?.variant).toBe("error"));
    expect(useUiStore.getState().toast?.message).toContain("Google account");
    expect(latest.state).toBe("none");
    expect(latest.dislikeDelta).toBe(0);
  });

  it("passes the harvested like params to the server", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    meta = {
      likeParams: "LIKE_PARAMS",
      removeLikeParams: "REMOVE_PARAMS",
      dislikeParams: "DISLIKE_PARAMS",
      removeDislikeParams: "DISLIKE_REMOVE_PARAMS",
    };
    await renderHarness();
    await act(async () => {
      await latest.like();
    });
    await vi.waitFor(() => expect(setVideoLiked).toHaveBeenCalledWith("vid00000001", true, "LIKE_PARAMS"));
    await act(async () => {
      await latest.dislike();
    });
    await vi.waitFor(() => expect(setVideoDisliked).toHaveBeenCalledWith("vid00000001", "DISLIKE_PARAMS"));
  });
});
