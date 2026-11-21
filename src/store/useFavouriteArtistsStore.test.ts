import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
const recommendation = vi.hoisted(() => ({ logInteraction: vi.fn() }));
vi.mock("../lib/api/db", () => db);
vi.mock("../lib/api/recommendation", () => recommendation);

import { useFavouriteArtistsStore } from "./useFavouriteArtistsStore";

const artist = { id: "UC1", name: "Artist", thumbnailUrl: "" };

describe("picked artists", () => {
  beforeEach(() => {
    useFavouriteArtistsStore.setState({ picked: [], loaded: false });
    db.setSetting.mockReset().mockResolvedValue(undefined);
    recommendation.logInteraction.mockReset();
  });

  it("saves the pick locally", async () => {
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([artist]);
    expect(db.setSetting).toHaveBeenCalledWith("favourite_artists", JSON.stringify([artist]));
  });

  it("never teaches the video engine", async () => {
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(recommendation.logInteraction).not.toHaveBeenCalled();
  });

  it("unpicks", async () => {
    useFavouriteArtistsStore.setState({ picked: [artist] });
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([]);
  });

  it("goes back when the save fails", async () => {
    db.setSetting.mockRejectedValue(new Error("gone"));
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([]);
  });
});
