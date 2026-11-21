import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => void settings.set(key, value));
vi.mock("../lib/api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
vi.mock("../lib/api/music", () => ({ getMusicQueue: vi.fn(), setMusicLiked: (...args: [string, boolean]) => setMusicLiked(...args) }));
const getAccountSignedIn = vi.fn(async () => false);
const setMusicLiked = vi.fn(async (_videoId: string, _liked: boolean) => true);
vi.mock("../lib/api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
}));

import { useLikesStore, type LikedItem } from "./useLikesStore";
import type { SongItem } from "../types/music";

const like = (id: string, likedAt: string): LikedItem => ({ kind: "video", id, likedAt, video: { id, title: id, channelName: "c" } });
const newer = like("newer", "2026-02-01T00:00:00.000Z");
const older = like("older", "2026-01-01T00:00:00.000Z");
const ids = () => useLikesStore.getState().items.map((item) => item.id);

describe("useLikesStore many at once", () => {
  beforeEach(() => {
    setSetting.mockClear();
    settings.clear();
    useLikesStore.setState({ items: [newer, older], loaded: true });
  });

  it("removes in one write and puts them back in date order", async () => {
    const removed = await useLikesStore.getState().removeMany([newer]);
    expect(ids()).toEqual(["older"]);
    expect(setSetting).toHaveBeenCalledTimes(1);
    await useLikesStore.getState().restore(removed);
    expect(ids()).toEqual(["newer", "older"]);
  });

  it("rolls back a removal the backend refused", async () => {
    setSetting.mockRejectedValueOnce(new Error("db"));
    await expect(useLikesStore.getState().removeMany([newer])).rejects.toThrow("db");
    expect(ids()).toEqual(["newer", "older"]);
  });

  it("does not duplicate on restore", async () => {
    await useLikesStore.getState().restore([older]);
    expect(ids()).toEqual(["newer", "older"]);
  });
});

describe("useLikesStore toggleSong", () => {
  const song: SongItem = {
    id: "vid00000001",
    videoId: "vid00000001",
    title: "Test Song",
    artists: [],
    album: null,
    duration: null,
    musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
    thumbnail: "",
    explicit: false,
    playlistId: null,
    params: null,
    viewsText: null,
  };

  beforeEach(() => {
    setSetting.mockClear();
    settings.clear();
    getAccountSignedIn.mockResolvedValue(false);
    setMusicLiked.mockClear();
    useLikesStore.setState({ items: [], loaded: true });
  });

  it("writes the like to the account when signed in", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    const nowLiked = await useLikesStore.getState().toggleSong(song);
    expect(nowLiked).toBe(true);
    expect(useLikesStore.getState().isLikedSong(song)).toBe(true);
    expect(setMusicLiked).toHaveBeenCalledWith("vid00000001", true);
  });

  it("keeps the local like when the account refuses it", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    setMusicLiked.mockRejectedValueOnce(new Error("nope"));
    const nowLiked = await useLikesStore.getState().toggleSong(song);
    expect(nowLiked).toBe(true);
    expect(useLikesStore.getState().isLikedSong(song)).toBe(true);
  });

  it("never calls the account when signed out", async () => {
    await useLikesStore.getState().toggleSong(song);
    expect(setMusicLiked).not.toHaveBeenCalled();
  });
});
