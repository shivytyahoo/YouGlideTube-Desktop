import { describe, expect, it } from "vitest";

import { hiddenFoldersDiff, parseHiddenFolders, parseStoredHiddenFolders } from "./hiddenFolders";

describe("parseHiddenFolders", () => {
  it("trims lines, drops empties and de-duplicates", () => {
    expect(parseHiddenFolders("  /a/music\n\n/b/photos\n/a/music\n")).toEqual(["/a/music", "/b/photos"]);
  });
});

describe("hiddenFoldersDiff", () => {
  it("excludes new paths and lifts dropped ones", () => {
    expect(hiddenFoldersDiff(["/a", "/b"], ["/b", "/c"])).toEqual({ toExclude: ["/c"], toRemove: ["/a"] });
  });

  it("is empty when nothing changed", () => {
    expect(hiddenFoldersDiff(["/a"], ["/a"])).toEqual({ toExclude: [], toRemove: [] });
  });
});

describe("parseStoredHiddenFolders", () => {
  it("parses the stored JSON list and ignores corrupt values", () => {
    expect(parseStoredHiddenFolders('["/a", "/b"]')).toEqual(["/a", "/b"]);
    expect(parseStoredHiddenFolders("not json")).toEqual([]);
    expect(parseStoredHiddenFolders(undefined)).toEqual([]);
  });
});
