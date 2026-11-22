import { describe, expect, it } from "vitest";

import {
  applyServerPlaylistOrder,
  loadServerPlaylistOrder,
  saveServerPlaylistOrder,
} from "./serverPlaylistOrder";

const video = (id: string) => ({ id });

describe("applyServerPlaylistOrder", () => {
  it("places dragged rows first and leaves the rest in the account's order", () => {
    expect(
      applyServerPlaylistOrder(
        [video("a"), video("b"), video("c"), video("d")],
        ["c", "a"],
      ).map((item) => item.id),
    ).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps the account's order when nothing was dragged", () => {
    const videos = [video("a"), video("b")];
    expect(applyServerPlaylistOrder(videos, [])).toBe(videos);
  });
});

describe("saved server playlist order", () => {
  it("round-trips through storage", () => {
    saveServerPlaylistOrder("PL1", ["c", "a"]);
    expect(loadServerPlaylistOrder("PL1")).toEqual(["c", "a"]);
    expect(loadServerPlaylistOrder("PL2")).toEqual([]);
  });
});
