// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShortItem } from "../../types/shorts";

const loadMore = vi.fn();
const retry = vi.fn();
const items: ShortItem[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i + 1}`,
  title: `Short ${i + 1}`,
  channelName: "Glide",
  channelId: null,
  thumbnailUrl: `https://i.ytimg.com/vi/s${i + 1}/oar2.jpg`,
  channelAvatarUrl: null,
  viewCountText: null,
  likeCountText: null,
  commentCountText: null,
  publishedText: null,
  sequenceParams: null,
}));
let feedState = {
  items,
  loading: false,
  loadingMore: false,
  error: null as string | null,
  loadMore,
  moreLikeThis: vi.fn(),
  reset: vi.fn(),
  retry,
};
let routeState: unknown = null;

vi.mock("../../lib/useShortsFeed", () => ({ useShortsFeed: () => feedState }));
vi.mock("../../lib/useShortStream", () => ({ prefetchShortStreams: vi.fn() }));
vi.mock("../../lib/feedImpressions", () => ({ IMPRESSION_DWELL_MS: 1000, noteImpression: vi.fn() }));
vi.mock("../../lib/shortViews", () => ({ startShortView: vi.fn(), finishShortView: vi.fn() }));
vi.mock("./ShortPlayer", () => ({ ShortPlayer: () => null }));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ videoId: "s1" }),
  useLocation: () => ({ state: routeState }),
  useNavigate: () => vi.fn(),
}));

const { ShortsFeed } = await import("./ShortsFeed");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let observerCallback: IntersectionObserverCallback | null = null;
class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const scrollIntoView = vi.fn();

let host: HTMLElement;
let root: Root;

const renderFeed = () => act(async () => root.render(createElement(ShortsFeed)));
const nextButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Next Short"]')!;

const goToIndex = (index: number) => {
  const section = host.querySelectorAll("section")[index]!;
  act(() => {
    observerCallback?.(
      [{ target: section, isIntersecting: true, intersectionRatio: 0.7 } as unknown as IntersectionObserverEntry],
      null as unknown as IntersectionObserver,
    );
  });
};

beforeEach(() => {
  feedState = {
    items,
    loading: false,
    loadingMore: false,
    error: null,
    loadMore,
    moreLikeThis: vi.fn(),
    reset: vi.fn(),
    retry,
  };
  routeState = null;
  loadMore.mockReset();
  retry.mockReset();
  scrollIntoView.mockReset();
  observerCallback = null;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
  Element.prototype.scrollIntoView = scrollIntoView;
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

describe("ShortsFeed next button", () => {
  it("advances to the next slide from the middle of the feed", async () => {
    await renderFeed();
    const next = nextButton();
    expect(next.disabled).toBe(false);

    scrollIntoView.mockClear();
    await act(async () => next.click());

    const sections = host.querySelectorAll("section");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scrollIntoView.mock.instances[0]).toBe(sections[1]);
  });

  it("stays enabled at the last loaded short and fetches more", async () => {
    await renderFeed();
    goToIndex(items.length - 1);
    loadMore.mockClear();

    const next = nextButton();
    expect(next.disabled).toBe(false);
    await act(async () => next.click());

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state while more shorts are being fetched", async () => {
    await renderFeed();
    goToIndex(items.length - 1);
    feedState = { ...feedState, loadingMore: true };
    await renderFeed();

    const next = nextButton();
    expect(next.disabled).toBe(true);
    expect(next.querySelector(".animate-spin")).not.toBeNull();
  });

  it("stays disabled at the end of a queue that deliberately stops", async () => {
    routeState = { initialQueue: items, queueEnd: "stop" };
    await renderFeed();
    goToIndex(items.length - 1);

    expect(nextButton().disabled).toBe(true);
  });

  it("shows a retry button on a load error and retries when tapped", async () => {
    feedState = { ...feedState, items: [], error: "boom" };
    await renderFeed();

    const button = host.querySelector("button");
    expect(button?.textContent).toContain("Retry");
    await act(async () => button?.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows a back pill when opened on a short", async () => {
    await renderFeed();
    expect(host.querySelector('button[aria-label="Back"]')).not.toBeNull();
    expect(host.querySelector("h1")).toBeNull();
  });
});
