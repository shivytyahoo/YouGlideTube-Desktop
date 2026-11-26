// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subscriptions } from "./Subscriptions";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { useNotificationStore } from "../store/useNotificationStore";
import { useChannelShortsStore } from "../store/useChannelShortsStore";

const serverFeed = vi.hoisted(() => ({
  status: "signed-out",
  videos: [] as unknown[],
  shorts: [] as unknown[],
  channels: [] as unknown[],
  continuation: null,
  hasMore: false,
  loading: false,
  loadingMore: false,
  loadMoreFailed: false,
  error: null as string | null,
  lastLoadedAt: null as number | null,
  refresh: vi.fn(),
  loadMore: vi.fn(),
}));
vi.mock("../lib/useServerSubscriptions", () => ({
  useServerSubscriptions: () => serverFeed,
}));
vi.mock("../lib/useSubscriptionFeed", () => ({
  useSubscriptionFeed: () => ({
    videos: [],
    rssChannels: [],
    loading: false,
    error: null,
    scanProgress: null,
    failedChannelIds: [],
    lastRefreshedAt: null,
    refresh: vi.fn(),
    refreshChannels: vi.fn(),
  }),
  useSubscriptionChannelDetails: () => ({}),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The page loads the local subscriptions on mount; wait for that read to land. */
async function waitForLocalLoad() {
  await act(async () => {
    for (let i = 0; i < 50; i++) {
      const state = useSubscriptionStore.getState();
      if (!state.loading && state.subscriptions.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  serverFeed.status = "signed-out";
  serverFeed.videos = [];
  serverFeed.shorts = [];
  serverFeed.channels = [];
  window.localStorage.removeItem("mock_setting_subscriptions");
  useSubscriptionStore.setState({
    subscriptions: [],
    subscriptionGroups: [],
    subscriptionGroupsLoaded: true,
    loading: false,
    recentlyUnsubscribedIds: new Set<string>(),
  });
  useNotificationStore.setState({ channelNotifications: {}, channelPrefsLoaded: true });
  useChannelShortsStore.setState({ excluded: new Set<string>() });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

describe("Subscriptions page", () => {
  it("has no Import-subscriptions option", () => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(Subscriptions)));
    });
    expect(host.textContent).not.toContain("Import Subscriptions");
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(buttons).not.toContain("Import Subscriptions");
  });

  it("still shows the feed controls", () => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(Subscriptions)));
    });
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(buttons).toContain("Manage");
    expect(buttons).toContain("Refresh");
  });

  it("shows a channel subscribed here even when the server feed has not returned it yet", async () => {
    serverFeed.status = "signed-in";
    serverFeed.channels = [{ id: "UC111", name: "Server Channel" }] as unknown[];
    window.localStorage.setItem(
      "mock_setting_subscriptions",
      JSON.stringify([
        { id: "UC111", name: "Server Channel" },
        { id: "UC222", name: "Just Subscribed Channel" },
      ]),
    );
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(Subscriptions)));
    });
    await waitForLocalLoad();
    expect(host.textContent).toContain("Server Channel");
    expect(host.textContent).toContain("Just Subscribed Channel");
    expect(host.textContent?.split("Server Channel").length).toBe(2);
  });

  it("hides a channel unsubscribed here even while the server feed still lists it", async () => {
    serverFeed.status = "signed-in";
    serverFeed.channels = [
      { id: "UC111", name: "Server Channel" },
      { id: "UC333", name: "Just Unsubscribed Channel" },
    ] as unknown[];
    window.localStorage.setItem(
      "mock_setting_subscriptions",
      JSON.stringify([{ id: "UC111", name: "Server Channel" }]),
    );
    useSubscriptionStore.setState({ recentlyUnsubscribedIds: new Set(["UC333"]) });
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(Subscriptions)));
    });
    await waitForLocalLoad();
    expect(host.textContent).toContain("Server Channel");
    expect(host.textContent).not.toContain("Just Unsubscribed Channel");
  });
});
