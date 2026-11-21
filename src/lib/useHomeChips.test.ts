import { describe, expect, it } from "vitest";
import {
  ALL_CHIP,
  LIVE_CHIP,
  MIXES_CHIP,
  NEW_TO_YOU_CHIP,
  RECENT_CHIP,
  WATCHED_CHIP,
  chipToRestore,
  serverChipKey,
  visibleChipKeys,
  visibleHomeMixes,
} from "./useHomeChips";

const serverChips = [
  { label: "All", params: null },
  { label: "Music", params: "EgZtdXNpYw%3D%3D" },
  { label: "Gaming", params: null },
];

const chips = (overrides = {}) => ({ hasMixes: true, hasWatched: true, empty: [], serverChips: [], ...overrides });

describe("visibleChipKeys", () => {
  it("keeps Android's order", () => {
    expect(visibleChipKeys(chips(), ALL_CHIP)).toEqual([
      ALL_CHIP,
      NEW_TO_YOU_CHIP,
      RECENT_CHIP,
      MIXES_CHIP,
      LIVE_CHIP,
      WATCHED_CHIP,
    ]);
  });

  it("leaves out Mixes and Watched until they can be filled, and chips that came back empty", () => {
    const keys = visibleChipKeys(chips({ hasMixes: false, hasWatched: false, empty: [LIVE_CHIP] }), ALL_CHIP);
    expect(keys).toEqual([ALL_CHIP, NEW_TO_YOU_CHIP, RECENT_CHIP]);
  });

  it("never takes away the chosen chip", () => {
    expect(visibleChipKeys(chips({ empty: [LIVE_CHIP] }), LIVE_CHIP)).toContain(LIVE_CHIP);
    expect(visibleChipKeys(chips({ hasWatched: false }), WATCHED_CHIP)).toContain(WATCHED_CHIP);
  });

  it("puts the server chips after All, without a second All", () => {
    expect(visibleChipKeys(chips({ serverChips }), ALL_CHIP)).toEqual([
      ALL_CHIP,
      "server:Music",
      "server:Gaming",
      NEW_TO_YOU_CHIP,
      RECENT_CHIP,
      MIXES_CHIP,
      LIVE_CHIP,
      WATCHED_CHIP,
    ]);
  });

  it("never takes away the chosen server chip, even when it came back empty", () => {
    const key = serverChipKey("Music");
    expect(visibleChipKeys(chips({ serverChips, empty: [key] }), key)).toContain(key);
  });
});

describe("chipToRestore", () => {
  it("keeps a fixed chip", () => {
    expect(chipToRestore(RECENT_CHIP, chips())).toBe(RECENT_CHIP);
    expect(chipToRestore(MIXES_CHIP, chips())).toBe(MIXES_CHIP);
  });

  it("falls back to All when the chip left", () => {
    expect(chipToRestore(WATCHED_CHIP, chips({ hasWatched: false }))).toBe(ALL_CHIP);
    expect(chipToRestore(serverChipKey("Music"), chips())).toBe(ALL_CHIP);
    expect(chipToRestore(serverChipKey("Music"), chips({ serverChips }))).toBe(serverChipKey("Music"));
  });
});

describe("visibleHomeMixes", () => {
  const video = (id: string) => ({ id, title: id, channelName: "c" });
  const mix = (seed: string, count: number) => ({
    seed: video(seed),
    videos: Array.from({ length: count }, (_, i) => video(`${seed}${i}`)),
  });
  const hiding = (...ids: string[]) => (candidate: { id: string }) => ids.includes(candidate.id);

  it("takes hidden videos out of a mix", () => {
    const [kept] = visibleHomeMixes([mix("a", 6)], hiding("a0"));
    expect(kept?.videos.map((v) => v.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("drops a mix whose seed is hidden, or that falls below five videos", () => {
    expect(visibleHomeMixes([mix("a", 6)], hiding("a"))).toEqual([]);
    expect(visibleHomeMixes([mix("a", 5)], hiding("a0"))).toEqual([]);
  });
});
