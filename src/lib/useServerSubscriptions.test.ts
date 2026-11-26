import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendApiError } from "./api/errors";
import { serverFeedChannels, useServerSubscriptions } from "./useServerSubscriptions";
import type { ServerFeedPage } from "./api/account";
import type { VideoSummary } from "../types/video";

const getAccountSignedIn = vi.fn();
const getServerSubscriptions = vi.fn();
const getGuideSubscriptions = vi.fn();
const listen = vi.fn();
const unlisten = vi.fn();

vi.mock("./api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/account")>()),
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
  getServerSubscriptions: (...args: unknown[]) => getServerSubscriptions(...args),
  getGuideSubscriptions: (...args: unknown[]) => getGuideSubscriptions(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("./useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (id: string, channelId = "ch-1", channelName = "Channel One"): VideoSummary =>
  ({ id, title: id, channelId, channelName }) as VideoSummary;

function page(overrides: Partial<ServerFeedPage>): ServerFeedPage {
  return {
    videos: [],
    shorts: [],
    channels: [],
    playlists: [],
    chips: [],
    continuation: null,
    removeTokens: {},
    ...overrides,
  };
}

let latest: ReturnType<typeof useServerSubscriptions>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useServerSubscriptions();
  return null;
}

async function renderHarness() {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await vi.waitFor(() => expect(latest.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountSignedIn.mockResolvedValue(true);
  getGuideSubscriptions.mockResolvedValue([]);
  listen.mockResolvedValue(unlisten);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe("useServerSubscriptions", () => {
  it("stays signed-out and never calls the feed while signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.videos).toEqual([]);
    expect(getServerSubscriptions).not.toHaveBeenCalled();
    expect(getGuideSubscriptions).not.toHaveBeenCalled();
  });

  it("loads the first page and dedupes repeated videos across pages", async () => {
    getServerSubscriptions
      .mockResolvedValueOnce(
        page({
          videos: [video("v1"), video("v2")],
          channels: [{ channelId: "ch-1", name: "Channel One" }],
          continuation: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        page({
          videos: [video("v2"), video("v3")],
          channels: [{ channelId: "ch-2", name: "Channel Two" }],
          continuation: null,
        }),
      );

    await renderHarness();
    expect(latest.status).toBe("signed-in");
    expect(latest.videos.map((item) => item.id)).toEqual(["v1", "v2"]);
    expect(latest.hasMore).toBe(true);

    await act(async () => {
      await latest.loadMore();
    });
    await vi.waitFor(() => expect(latest.videos).toHaveLength(3));
    expect(latest.videos.map((item) => item.id)).toEqual(["v1", "v2", "v3"]);
    expect(latest.channels.map((channel) => channel.id)).toEqual(["ch-1", "ch-2"]);
    expect(latest.hasMore).toBe(false);
  });

  it("builds the channel rail from the videos when the feed carries none", () => {
    const channels = serverFeedChannels(
      [],
      [video("v1", "ch-1", "One"), video("v2", "ch-1", "One"), video("v3", "ch-2", "Two")],
    );
    expect(channels.map((channel) => channel.id)).toEqual(["ch-1", "ch-2"]);
    expect(channels[0]?.name).toBe("One");
  });

  it("prefers the feed's own channels over the videos' channels", () => {
    const channels = serverFeedChannels(
      [{ channelId: "ch-9", name: "Rail Channel" }],
      [video("v1", "ch-1", "One")],
    );
    expect(channels.map((channel) => channel.id)).toEqual(["ch-9"]);
  });

  it("drops to signed-out, with the lists cleared, on a Validation error", async () => {
    getServerSubscriptions.mockRejectedValueOnce(
      new BackendApiError("not signed in", "validation", null),
    );

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.videos).toEqual([]);
    expect(latest.error).toBeNull();
  });

  it("reloads when sign-in completes after mount", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    getServerSubscriptions.mockResolvedValue(page({ videos: [video("v1")] }));

    await renderHarness();
    expect(latest.status).toBe("signed-out");

    const handler = listen.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();
    getAccountSignedIn.mockResolvedValue(true);

    await act(async () => {
      handler!();
    });
    await vi.waitFor(() => expect(latest.status).toBe("signed-in"));
    expect(getServerSubscriptions).toHaveBeenCalledTimes(1);
    expect(latest.videos.map((item) => item.id)).toEqual(["v1"]);
  });

  it("reloads when the active account switches after mount", async () => {
    getServerSubscriptions
      .mockResolvedValueOnce(page({ videos: [video("v1")] }))
      .mockResolvedValueOnce(page({ videos: [video("v2")] }));

    await renderHarness();
    expect(latest.videos.map((item) => item.id)).toEqual(["v1"]);

    // The second listener is the account-switched one.
    expect(listen.mock.calls[1]?.[0]).toBe("google-account-switched");
    const handler = listen.mock.calls[1]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });
    await vi.waitFor(() => expect(getServerSubscriptions).toHaveBeenCalledTimes(2));
    expect(latest.videos.map((item) => item.id)).toEqual(["v2"]);
  });

  it("reports a failed page load without clearing the list", async () => {
    getServerSubscriptions
      .mockResolvedValueOnce(page({ videos: [video("v1")], continuation: "page-2" }))
      .mockRejectedValueOnce(new Error("network down"));

    await renderHarness();
    await act(async () => {
      await latest.loadMore();
    });
    await vi.waitFor(() => expect(latest.loadMoreFailed).toBe(true));
    expect(latest.videos.map((item) => item.id)).toEqual(["v1"]);
  });

  it("loads the guide list alongside the feed when signed in", async () => {
    getServerSubscriptions.mockResolvedValue(page({}));
    getGuideSubscriptions.mockResolvedValue([
      {
        channelId: "UC999",
        name: "Guide Channel",
        avatarUrl: "https://i.ytimg.com/guide.jpg",
      },
    ]);

    await renderHarness();

    await vi.waitFor(() =>
      expect(latest.guideChannels).toEqual([
        { id: "UC999", name: "Guide Channel", avatarUrl: "https://i.ytimg.com/guide.jpg" },
      ]),
    );
    expect(getGuideSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("falls back to the feed channels when the guide load fails", async () => {
    getServerSubscriptions.mockResolvedValue(
      page({ channels: [{ channelId: "UC111", name: "Server Channel" }] }),
    );
    getGuideSubscriptions.mockRejectedValue(new Error("guide down"));

    await renderHarness();

    await vi.waitFor(() => expect(latest.guideChannels).toEqual([]));
    expect(latest.channels).toEqual([{ id: "UC111", name: "Server Channel" }]);
  });
});
