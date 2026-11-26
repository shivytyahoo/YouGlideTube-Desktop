// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel } from "./Channel";
import type { ChannelPage } from "../types/video";

const pageState = vi.hoisted(() => ({
  page: null as ChannelPage | null,
  loading: true,
  failed: false,
}));

vi.mock("../lib/useChannelPage", () => ({
  useChannelPage: () => ({ ...pageState, retry: vi.fn() }),
  useChannelAbout: () => ({ about: null, loading: false, failed: false }),
}));
vi.mock("../lib/useChannelFeed", () => ({
  useChannelFeed: () => ({
    feed: null,
    loading: false,
    loadingMore: false,
    failed: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("../lib/useChannelWatched", () => ({
  useChannelWatched: () => [],
}));
vi.mock("../lib/useInfiniteScroll", () => ({
  useInfiniteScroll: () => ({ current: null }),
}));
vi.mock("../lib/usePublishTitle", () => ({
  usePublishTitle: () => {},
}));
vi.mock("../lib/useShortsContent", () => ({
  useShortsEnabled: () => true,
  useChannelShortsTabKept: () => false,
  channelTabsFor: (tabs: unknown[]) => tabs,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const renderChannel = () => {
  root.render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/channel/UCtest123"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/channel/:channelId",
          element: createElement(Channel, { onPlay: () => {}, onAddToQueue: () => {} }),
        }),
      ),
    ),
  );
};

beforeEach(() => {
  pageState.page = null;
  pageState.loading = true;
  pageState.failed = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("Channel loading -> loaded", () => {
  it("renders the loaded channel after the loading skeleton without a hooks error", () => {
    act(() => {
      renderChannel();
    });
    expect(host.textContent ?? "").not.toContain("Test Channel");

    act(() => {
      pageState.page = {
        details: {
          id: "UCtest123",
          name: "Test Channel",
          handle: "@testchannel",
          description: "A test channel",
          avatarUrl: null,
          bannerUrl: null,
          subscriberCountText: "1M subscribers",
          videoCountText: "100 videos",
          verified: false,
          tabs: [],
          aboutToken: null,
        },
        home: { items: [], sections: [] },
      } as unknown as ChannelPage;
      pageState.loading = false;
      renderChannel();
    });
    // Before the fix this second render threw React error 310 ("Rendered more
    // hooks than during the previous render"): the Shorts-queue useMemo sat
    // below the loading early return, so it ran only on the loaded render.
    expect(host.textContent ?? "").toContain("Test Channel");
  });
});
