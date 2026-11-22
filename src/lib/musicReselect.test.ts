import { describe, expect, it, vi } from "vitest";
import { MUSIC_RESELECTED_EVENT, announceMusicReselected } from "./musicReselect";

describe("announceMusicReselected", () => {
  it("dispatches the music-reselected event", () => {
    const listener = vi.fn();
    window.addEventListener(MUSIC_RESELECTED_EVENT, listener);
    try {
      announceMusicReselected();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MUSIC_RESELECTED_EVENT, listener);
    }
  });
});
