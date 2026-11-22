import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/db", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
  addWatchRecord: vi.fn(async () => undefined),
  blockChannel: vi.fn(async () => undefined),
  unblockChannel: vi.fn(async () => undefined),
}));

import { VideoCardFeedback } from "./VideoCardFeedback";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (id: string): VideoSummary => ({ id, title: "A video", channelName: "Chan", channelId: "UC1" });

describe("VideoCardFeedback", () => {
  let host: HTMLDivElement;
  let root: Root;

  function renderFeedback(isWatched = false) {
    act(() => {
      root.render(createElement(VideoCardFeedback, { video: card("a"), isWatched }));
    });
    return Array.from(host.querySelectorAll("button"));
  }

  function button(label: string) {
    const found = renderFeedback().find((b) => b.textContent?.includes(label));
    expect(found).toBeDefined();
    return found!;
  }

  beforeEach(() => {
    useFeedActionsStore.setState({
      dismissedVideoIds: new Set(),
      blockedChannelIds: new Set(),
      suppressedChannelIds: new Map(),
      watchedVideoIds: new Set(),
    });
    useUiStore.setState({ toast: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the interested and not-interested buttons", () => {
    const buttons = renderFeedback();
    expect(buttons.map((b) => b.textContent)).toContain("I want more like this");
    expect(buttons.map((b) => b.textContent)).toContain("Not interested");
  });

  it("toasts on 'I want more like this'", async () => {
    const btn = button("I want more like this");
    await act(async () => {
      btn.click();
    });
    expect(useUiStore.getState().toast?.message).toBe("Got it! You'll see more content like this.");
  });

  it("marks not interested with an undo toast", async () => {
    const btn = button("Not interested");
    await act(async () => {
      btn.click();
    });
    expect(useFeedActionsStore.getState().dismissedVideoIds.has("a")).toBe(true);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe("Got it! You'll see less content like this.");
    expect(toast?.actions.map((action) => action.label)).toEqual(["Undo"]);
    act(() => {
      toast?.actions[0]?.onSelect?.();
    });
    expect(useFeedActionsStore.getState().dismissedVideoIds.has("a")).toBe(false);
  });

  it("toggles the watched mark", async () => {
    const toggle = renderFeedback().find((b) => b.getAttribute("aria-label") === "Mark as watched");
    expect(toggle).toBeDefined();
    await act(async () => {
      toggle!.click();
    });
    expect(useFeedActionsStore.getState().watchedVideoIds.has("a")).toBe(true);
  });
});
