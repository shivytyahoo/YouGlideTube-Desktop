// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  SHORTS_RESELECTED_EVENT,
  announceShortsReselected,
  shortsReselectAction,
} from "./shortsReselect";

describe("shortsReselectAction", () => {
  it("scrolls back up when the reel is past the top", () => {
    expect(shortsReselectAction(3)).toBe("scroll");
  });

  it("refreshes when already at the top", () => {
    expect(shortsReselectAction(0)).toBe("refresh");
  });
});

describe("announceShortsReselected", () => {
  it("dispatches the reselect event", () => {
    const listener = vi.fn();
    window.addEventListener(SHORTS_RESELECTED_EVENT, listener);
    announceShortsReselected();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHORTS_RESELECTED_EVENT, listener);
  });
});
