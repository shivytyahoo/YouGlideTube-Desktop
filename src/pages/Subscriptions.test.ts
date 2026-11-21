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

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  useSubscriptionStore.setState({
    subscriptions: [],
    subscriptionGroups: [],
    subscriptionGroupsLoaded: true,
    loading: false,
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
});
