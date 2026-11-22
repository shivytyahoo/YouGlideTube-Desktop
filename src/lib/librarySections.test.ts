import { describe, expect, it } from "vitest";

import { parseHiddenLibrarySections, toggledHiddenSections, hiddenOnLibraryPage } from "./librarySections";

describe("hidden Library sections", () => {
  it("reads what was stored and survives junk", () => {
    expect([...parseHiddenLibrarySections('["HISTORY",3]')]).toEqual(["HISTORY"]);
    expect(parseHiddenLibrarySections("{").size).toBe(0);
    expect(parseHiddenLibrarySections('"HISTORY"').size).toBe(0);
  });

  it("adds and removes a section", () => {
    const hidden = parseHiddenLibrarySections(toggledHiddenSections(new Set(), "LIKED_VIDEOS", true));
    expect(hidden.has("LIKED_VIDEOS")).toBe(true);
    expect(parseHiddenLibrarySections(toggledHiddenSections(hidden, "LIKED_VIDEOS", false)).size).toBe(0);
  });

  it("maps the old merged ids onto the split shelves", () => {
    expect([...parseHiddenLibrarySections('["PLAYLISTS"]')].sort()).toEqual([
      "MUSIC_PLAYLISTS",
      "VIDEO_PLAYLISTS",
    ]);
    expect([...parseHiddenLibrarySections('["LIKES"]')].sort()).toEqual([
      "LIKED_MUSIC",
      "LIKED_VIDEOS",
    ]);
    // Unhiding one split shelf leaves the other hidden.
    const hidden = parseHiddenLibrarySections('["PLAYLISTS"]');
    expect([...parseHiddenLibrarySections(toggledHiddenSections(hidden, "VIDEO_PLAYLISTS", false))]).toEqual([
      "MUSIC_PLAYLISTS",
    ]);
  });
});

describe("hiddenOnLibraryPage", () => {
  it("hides Saved Shorts while Shorts are hidden, on top of the viewer's own choices", () => {
    const hidden = new Set(["LIKED_VIDEOS"]);
    expect(hiddenOnLibraryPage(hidden, true)).toBe(hidden);
    expect([...hiddenOnLibraryPage(hidden, false)].sort()).toEqual(["LIKED_VIDEOS", "SAVED_SHORTS"]);
  });

  it("hides Albums and Music downloads while Show Music is off", () => {
    const hidden = new Set(["LIKED_VIDEOS"]);
    expect(hiddenOnLibraryPage(hidden, true, true)).toBe(hidden);
    expect([...hiddenOnLibraryPage(hidden, true, false)].sort()).toEqual([
      "ALBUMS",
      "LIKED_MUSIC",
      "LIKED_VIDEOS",
      "MUSIC_DOWNLOADS",
      "MUSIC_PLAYLISTS",
    ]);
  });
});
