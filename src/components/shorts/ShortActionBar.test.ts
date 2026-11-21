// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortItem } from "../../types/shorts";

type Reactions = {
  state: "none" | "liked" | "disliked";
  like: () => void;
  dislike: () => void;
  likeDelta: number;
};

const reactionsMock = vi.fn((..._args: unknown[]): Reactions => ({
  state: "none",
  like: vi.fn(),
  dislike: vi.fn(),
  likeDelta: 0,
}));
vi.mock("../../lib/useVideoReactions", () => ({
  useVideoReactions: (...args: unknown[]) => reactionsMock(...args),
}));
vi.mock("../../lib/useExitGhost", () => ({ useExitGhost: () => {} }));
vi.mock("../../lib/savedShortsLibrary", () => ({
  isShortSaved: async () => false,
  removeShortFromLibrary: vi.fn(),
  saveShortToLibrary: vi.fn(),
}));
vi.mock("../../lib/useOriginalTitle", () => ({ useOriginalTitle: () => null }));

import { ShortActionBar } from "./ShortActionBar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const short: ShortItem = {
  id: "short00001",
  title: "Test Short",
  channelName: "Channel",
  channelId: "chan1",
  thumbnailUrl: "https://example.test/thumb.jpg",
  likeCountText: "100",
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  reactionsMock.mockImplementation(() => ({
    state: "none",
    like: vi.fn(),
    dislike: vi.fn(),
    likeDelta: 0,
  }));
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

async function renderBar(likeDelta: number) {
  reactionsMock.mockImplementation(() => ({
    state: likeDelta > 0 ? "liked" : "none",
    like: vi.fn(),
    dislike: vi.fn(),
    likeDelta,
  }));
  await act(async () => {
    root.render(
      createElement(ShortActionBar, {
        short,
        details: null,
        rydData: null,
        onRequestPanel: () => {},
        onMoreLikeThis: () => {},
        likeFromSurfaceRef: { current: () => {} },
      }),
    );
  });
}

describe("ShortActionBar like count", () => {
  it("shows the snapshot count when nothing is liked", async () => {
    await renderBar(0);
    expect(host.textContent).toContain("100");
  });

  it("moves the count by the server-confirmed like delta without RYD data", async () => {
    await renderBar(1);
    expect(host.textContent).toContain("101");
    expect(host.textContent).not.toContain("100");
  });
});
