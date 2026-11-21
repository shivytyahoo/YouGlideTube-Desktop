import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendApiError } from "./api/errors";
import { useServerWatchLater } from "./useServerWatchLater";
import type { WatchLaterPage } from "./api/account";
import type { VideoSummary } from "../types/video";

const getAccountSignedIn = vi.fn();
const getWatchLater = vi.fn();
const setVideoWatchLater = vi.fn();
const listen = vi.fn();
const unlisten = vi.fn();
const removeVideoFromWatchLater = vi.fn();
const setServerSetVideoIds = vi.fn();

vi.mock("./api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/account")>()),
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
  getWatchLater: (...args: unknown[]) => getWatchLater(...args),
  setVideoWatchLater: (...args: unknown[]) => setVideoWatchLater(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("./useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));
vi.mock("./playlistLibrary", () => ({
  removeVideoFromWatchLater: (...args: unknown[]) => removeVideoFromWatchLater(...args),
}));
vi.mock("../store/useWatchLaterStore", () => ({
  useWatchLaterStore: Object.assign(vi.fn(() => 0), {
    getState: () => ({ setServerSetVideoIds }),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (id: string): VideoSummary => ({ id, title: id }) as VideoSummary;

function wlPage(overrides: Partial<WatchLaterPage>): WatchLaterPage {
  return { title: "Watch Later", videos: [], continuation: null, ...overrides };
}

let latest: ReturnType<typeof useServerWatchLater>;
let root: ReturnType<typeof createRoot>;

function Harness({ enabled }: { enabled: boolean }) {
  latest = useServerWatchLater(enabled);
  return null;
}

async function renderHarness(enabled = true) {
  await act(async () => {
    root.render(createElement(Harness, { enabled }));
  });
  await vi.waitFor(() => expect(latest.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountSignedIn.mockResolvedValue(true);
  listen.mockResolvedValue(unlisten);
  removeVideoFromWatchLater.mockResolvedValue(undefined);
  setVideoWatchLater.mockResolvedValue(true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe("useServerWatchLater", () => {
  it("does nothing while disabled", async () => {
    await renderHarness(false);

    expect(latest.status).toBe("unknown");
    expect(latest.videos).toEqual([]);
    expect(getAccountSignedIn).not.toHaveBeenCalled();
  });

  it("stays signed-out and never calls the server list while signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.videos).toEqual([]);
    expect(getWatchLater).not.toHaveBeenCalled();
  });

  it("loads the list, dedupes across pages, and publishes the entry ids", async () => {
    getWatchLater
      .mockResolvedValueOnce(
        wlPage({
          videos: [
            { video: video("v1"), setVideoId: "set-1" },
            { video: video("v2"), setVideoId: "set-2" },
          ],
          continuation: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        wlPage({
          videos: [{ video: video("v2"), setVideoId: "set-2" }, { video: video("v3") }],
        }),
      );

    await renderHarness();

    expect(latest.status).toBe("signed-in");
    expect(latest.videos.map((item) => item.id)).toEqual(["v1", "v2"]);
    expect(setServerSetVideoIds).toHaveBeenLastCalledWith({ v1: "set-1", v2: "set-2" });

    await act(async () => {
      await latest.loadMore();
    });
    await vi.waitFor(() => expect(latest.videos).toHaveLength(3));
    expect(latest.videos.map((item) => item.id)).toEqual(["v1", "v2", "v3"]);
    expect(setServerSetVideoIds).toHaveBeenLastCalledWith({
      v1: "set-1",
      v2: "set-2",
      v3: null,
    });
  });

  it("reloads when the active account switches after mount", async () => {
    getWatchLater
      .mockResolvedValueOnce(wlPage({ videos: [{ video: video("v1"), setVideoId: "set-1" }] }))
      .mockResolvedValueOnce(wlPage({ videos: [{ video: video("v2"), setVideoId: "set-2" }] }));

    await renderHarness();
    expect(latest.videos.map((item) => item.id)).toEqual(["v1"]);

    // The second listener is the account-switched one.
    expect(listen.mock.calls[1]?.[0]).toBe("google-account-switched");
    const handler = listen.mock.calls[1]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });
    await vi.waitFor(() => expect(getWatchLater).toHaveBeenCalledTimes(2));
    expect(latest.videos.map((item) => item.id)).toEqual(["v2"]);
  });

  it("removes a row through the server and the local copy", async () => {
    getWatchLater.mockResolvedValueOnce(
      wlPage({ videos: [{ video: video("v1"), setVideoId: "set-1" }] }),
    );

    await renderHarness();
    let result: Awaited<ReturnType<typeof latest.remove>> = "failed";
    await act(async () => {
      result = await latest.remove("v1");
    });

    expect(result).toBe("removed");
    expect(setVideoWatchLater).toHaveBeenCalledWith("v1", false, "set-1");
    expect(removeVideoFromWatchLater).toHaveBeenCalledWith("v1");
    expect(latest.videos).toEqual([]);
  });

  it("says needs-refresh for a row without an entry id, and never calls the server", async () => {
    getWatchLater.mockResolvedValueOnce(wlPage({ videos: [{ video: video("v1") }] }));

    await renderHarness();
    let result: Awaited<ReturnType<typeof latest.remove>> = "failed";
    await act(async () => {
      result = await latest.remove("v1");
    });

    expect(result).toBe("needs-refresh");
    expect(setVideoWatchLater).not.toHaveBeenCalled();
    expect(latest.videos.map((item) => item.id)).toEqual(["v1"]);
  });

  it("fails a remove for an unknown video", async () => {
    getWatchLater.mockResolvedValueOnce(wlPage({ videos: [] }));

    await renderHarness();
    let result: Awaited<ReturnType<typeof latest.remove>> = "removed";
    await act(async () => {
      result = await latest.remove("nope");
    });

    expect(result).toBe("failed");
    expect(setVideoWatchLater).not.toHaveBeenCalled();
  });

  it("loads every remaining page for loadAll", async () => {
    getWatchLater
      .mockResolvedValueOnce(
        wlPage({ videos: [{ video: video("v1"), setVideoId: "set-1" }], continuation: "p2" }),
      )
      .mockResolvedValueOnce(
        wlPage({ videos: [{ video: video("v2"), setVideoId: "set-2" }], continuation: "p3" }),
      )
      .mockResolvedValueOnce(wlPage({ videos: [{ video: video("v3") }] }));

    await renderHarness();
    let all: VideoSummary[] = [];
    await act(async () => {
      all = await latest.loadAll();
    });

    expect(all.map((item) => item.id)).toEqual(["v1", "v2", "v3"]);
    expect(latest.hasMore).toBe(false);
    expect(getWatchLater).toHaveBeenCalledTimes(3);
  });

  it("drops to signed-out on a Validation error", async () => {
    getWatchLater.mockRejectedValueOnce(
      new BackendApiError("not signed in", "validation", null),
    );

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.videos).toEqual([]);
  });
});
