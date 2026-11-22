import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pullTriggersRefresh, resistedPull, usePullToRefresh } from "./usePullToRefresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("resistedPull", () => {
  it("trails the finger at half speed and caps the travel", () => {
    expect(resistedPull(0)).toBe(0);
    expect(resistedPull(100)).toBe(50);
    expect(resistedPull(300)).toBe(120);
  });
});

describe("pullTriggersRefresh", () => {
  it("fires at the threshold and not below it", () => {
    expect(pullTriggersRefresh(71)).toBe(false);
    expect(pullTriggersRefresh(72)).toBe(true);
  });
});

describe("usePullToRefresh", () => {
  let host: HTMLDivElement;
  let root: Root;

  function Harness({
    onRefresh,
    refreshing = false,
    disabled = false,
  }: {
    onRefresh: () => void;
    refreshing?: boolean;
    disabled?: boolean;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    const { pullPx } = usePullToRefresh(ref, { onRefresh, refreshing, disabled });
    return createElement(
      "div",
      { ref, "data-pull": String(pullPx), style: { height: 200, overflowY: "auto" } },
      createElement("div", { style: { height: 400 } }),
    );
  }

  function renderHarness(props: { onRefresh: () => void; refreshing?: boolean; disabled?: boolean }) {
    act(() => {
      root.render(createElement(Harness, props));
    });
    return host.firstElementChild as HTMLDivElement;
  }

  function pull(el: HTMLElement, startY: number, endY: number) {
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    (start as unknown as { touches: { clientY: number }[] }).touches = [{ clientY: startY }];
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    (move as unknown as { touches: { clientY: number }[] }).touches = [{ clientY: endY }];
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(start);
      el.dispatchEvent(move);
      el.dispatchEvent(end);
    });
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("refreshes on release after a pull past the threshold", () => {
    const onRefresh = vi.fn();
    const el = renderHarness({ onRefresh });
    pull(el, 100, 300);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(el.getAttribute("data-pull")).toBe("0");
  });

  it("does not refresh after a short pull", () => {
    const onRefresh = vi.fn();
    const el = renderHarness({ onRefresh });
    pull(el, 100, 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not pull while scrolled down", () => {
    const onRefresh = vi.fn();
    const el = renderHarness({ onRefresh });
    el.scrollTop = 50;
    pull(el, 100, 300);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(el.getAttribute("data-pull")).toBe("0");
  });

  it("does not refresh on an upward drag", () => {
    const onRefresh = vi.fn();
    const el = renderHarness({ onRefresh });
    pull(el, 300, 100);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not fire again while a refresh is in flight", () => {
    const onRefresh = vi.fn();
    const el = renderHarness({ onRefresh, refreshing: true });
    pull(el, 100, 300);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
