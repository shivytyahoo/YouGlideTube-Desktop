import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => void settings.set(key, value));
vi.mock("../lib/api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
vi.mock("../lib/api/music", () => ({ getMusicQueue: vi.fn(), getLikedMusic: () => getLikedMusic(), setMusicLiked: (...args: [string, boolean]) => setMusicLiked(...args) }));
const getAccountSignedIn = vi.fn(async () => false);
const setMusicLiked = vi.fn(async (_videoId: string, _liked: boolean) => true);
const getLikedMusic = vi.fn(async (): Promise<MusicPlaylistPage> => ({
  id: "LM",
  title: "Liked Music",
  author: null,
  songCountText: null,
  thumbnail: null,
  description: null,
  songs: [],
  continuation: null,
}));
const getLikedVideos = vi.fn(async (_continuation?: string): Promise<LikedVideosPage> => ({ title: "Liked videos", videos: [], continuation: null }));
const setVideoLiked = vi.fn(async (_videoId: string, _liked: boolean) => true);
vi.mock("../lib/api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  getLikedVideos: (...args: [string | undefined]) => getLikedVideos(...args),
  setVideoLiked: (...args: [string, boolean]) => setVideoLiked(...args),
}));

import { mergeLikedItems, selectMergedLikes, useLikesStore, type LikedItem } from "./useLikesStore";
import { useUiStore } from "./useUiStore";
import type { SongItem, MusicPlaylistPage } from "../types/music";
import type { LikedVideosPage } from "../lib/api/account";

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
    useUiStore.setState({ toast: null });
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

  it("says so when the account refuses the song like", async () => {
    getAccountSignedIn.mockResolvedValue(true);
    setMusicLiked.mockRejectedValueOnce(new Error("nope"));
    await useLikesStore.getState().toggleSong(song);
    await vi.waitFor(() => expect(useUiStore.getState().toast?.variant).toBe("error"));
    expect(useUiStore.getState().toast?.message).toContain("Google account");
  });

  it("never calls the account when signed out", async () => {
    await useLikesStore.getState().toggleSong(song);
    expect(setMusicLiked).not.toHaveBeenCalled();
  });
});

describe("useLikesStore server likes", () => {
  const serverVideo = (id: string): LikedItem => ({
    kind: "video",
    id,
    likedAt: "2026-02-02T00:00:00.000Z",
    video: { id, title: id, channelName: "c" },
  });

  beforeEach(() => {
    setSetting.mockClear();
    settings.clear();
    getAccountSignedIn.mockResolvedValue(true);
    setVideoLiked.mockClear();
    setVideoLiked.mockResolvedValue(true);
    getLikedVideos.mockClear();
    getLikedVideos.mockResolvedValue({ title: "Liked videos", videos: [], continuation: null });
    getLikedMusic.mockClear();
    useLikesStore.setState({ items: [], serverItems: [], loaded: true, serverLoaded: false });
    useUiStore.setState({ toast: null });
  });

  it("loads the account's liked videos first, local-only appended", async () => {
    const localOnly = like("local-only", "2026-01-01T00:00:00.000Z");
    useLikesStore.setState({ items: [localOnly] });
    getLikedVideos.mockResolvedValue({
      title: "Liked videos",
      videos: [{ id: "srv", title: "srv", channelName: "c" }],
      continuation: null,
    });
    await useLikesStore.getState().loadServer();
    const state = useLikesStore.getState();
    expect(state.serverLoaded).toBe(true);
    expect(state.serverItems.map((item) => item.id)).toEqual(["srv"]);
    expect(selectMergedLikes(state).map((item) => item.id)).toEqual(["srv", "local-only"]);
    expect(mergeLikedItems(state.serverItems, state.items).map((item) => item.id)).toEqual(["srv", "local-only"]);
  });

  it("keeps the last good server list when the walk fails", async () => {
    getLikedVideos.mockResolvedValue({
      title: "Liked videos",
      videos: [{ id: "srv", title: "srv", channelName: "c" }],
      continuation: null,
    });
    await useLikesStore.getState().loadServer();
    expect(useLikesStore.getState().serverItems.map((item) => item.id)).toEqual(["srv"]);
    useLikesStore.setState({ serverLoaded: false });
    getLikedVideos.mockRejectedValueOnce(new Error("gone"));
    await useLikesStore.getState().loadServer();
    expect(useLikesStore.getState().serverItems.map((item) => item.id)).toEqual(["srv"]);
  });

  it("unlikes a server-only video when it is removed", async () => {
    const item = serverVideo("srv");
    useLikesStore.setState({ serverItems: [item], serverLoaded: true });
    await useLikesStore.getState().remove("video", "srv");
    expect(setVideoLiked).toHaveBeenCalledWith("srv", false);
    expect(useLikesStore.getState().serverItems).toEqual([]);
  });

  it("puts the row back when the server refuses the unlike", async () => {
    const item = serverVideo("srv");
    useLikesStore.setState({ serverItems: [item], serverLoaded: true });
    setVideoLiked.mockRejectedValueOnce(new Error("nope"));
    await useLikesStore.getState().remove("video", "srv");
    expect(useLikesStore.getState().items.map((row) => row.id)).toEqual(["srv"]);
    expect(useUiStore.getState().toast?.variant).toBe("error");
  });

  it("unlikes every server video on Clear all", async () => {
    useLikesStore.setState({ serverItems: [serverVideo("a"), serverVideo("b")], serverLoaded: true });
    await useLikesStore.getState().clear();
    expect(setVideoLiked).toHaveBeenCalledWith("a", false);
    expect(setVideoLiked).toHaveBeenCalledWith("b", false);
    expect(useLikesStore.getState().serverItems).toEqual([]);
  });

  it("never calls the account when signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    useLikesStore.setState({ serverItems: [serverVideo("srv")], serverLoaded: true });
    await useLikesStore.getState().remove("video", "srv");
    expect(setVideoLiked).not.toHaveBeenCalled();
  });
});
