import { describe, expect, it } from "vitest";

import { moveNavTab, orderedNavTabs } from "./navTabOrder";

describe("orderedNavTabs", () => {
  it("returns the default order for an empty value", () => {
    expect(orderedNavTabs(null)).toEqual(["home", "shorts", "explore", "music"]);
    expect(orderedNavTabs("[]")).toEqual(["home", "shorts", "explore", "music"]);
  });

  it("keeps the stored order and appends missing tabs", () => {
    expect(orderedNavTabs('["music","home"]')).toEqual(["music", "home", "shorts", "explore"]);
  });

  it("drops unknown tabs and survives corrupt JSON", () => {
    expect(orderedNavTabs('["music","tv","home"]')).toEqual(["music", "home", "shorts", "explore"]);
    expect(orderedNavTabs("not json")).toEqual(["home", "shorts", "explore", "music"]);
  });
});

describe("moveNavTab", () => {
  it("moves a tab up and down", () => {
    expect(moveNavTab("[]", "music", -1)).toBe('["home","shorts","music","explore"]');
    expect(moveNavTab("[]", "home", 1)).toBe('["shorts","home","explore","music"]');
  });

  it("does nothing at the ends", () => {
    expect(moveNavTab("[]", "home", -1)).toBe('["home","shorts","explore","music"]');
    expect(moveNavTab("[]", "music", 1)).toBe('["home","shorts","explore","music"]');
  });
});
