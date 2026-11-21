import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccountSignedIn = vi.fn(async () => false);
const getServerPlaylists = vi.fn(
  async (_continuation?: string): Promise<{ playlists: PlaylistSummary[]; continuation: string | null }> =>
    ({ playlists: [], continuation: null }),
);
const createServerPlaylist = vi.fn(async (_name: string) => "PL-new");
const deleteServerPlaylist = vi.fn(async (_playlistId: string) => undefined);
const renameServerPlaylist = vi.fn(async (_playlistId: string, _name: string) => undefined);
const addVideoToServerPlaylist = vi.fn(async (_playlistId: string, _videoId: string) => undefined);
const removeVideoFromServerPlaylist = vi.fn(async (_playlistId: string, _videoId: string) => undefined);
const addVideosToServerPlaylist = vi.fn(async (_playlistId: string, videoIds: string[]) => videoIds);
const removeVideosFromServerPlaylist = vi.fn(async (_playlistId: string, videoIds: string[]) => videoIds);
vi.mock("../lib/api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  getServerPlaylists: (...args: [string | undefined]) => getServerPlaylists(...args),
  createServerPlaylist: (...args: [string]) => createServerPlaylist(...args),
  deleteServerPlaylist: (...args: [string]) => deleteServerPlaylist(...args),
  renameServerPlaylist: (...args: [string, string]) => renameServerPlaylist(...args),
  addVideoToServerPlaylist: (...args: [string, string]) => addVideoToServerPlaylist(...args),
  removeVideoFromServerPlaylist: (...args: [string, string]) => removeVideoFromServerPlaylist(...args),
  addVideosToServerPlaylist: (...args: [string, string[]]) => addVideosToServerPlaylist(...args),
  removeVideosFromServerPlaylist: (...args: [string, string[]]) => removeVideosFromServerPlaylist(...args),
  isSignedOutError: (error: unknown) => error instanceof Error && error.message === "signed-out",
}));
vi.mock("../lib/useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));
vi.mock("../lib/playlistLibrary", () => ({
  parseVideoCountFromText: (text?: string | null) => {
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1] ?? "", 10) : null;
  },
  formatVideoCountText: (count: number) => (count === 1 ? "1 video" : `${count} videos`),
}));

import { isSystemServerPlaylistId, useServerPlaylistsStore } from "./useServerPlaylistsStore";
import type { PlaylistSummary } from "../types/video";

const summary = (id: string, title = id, videoCountText: string | null = "0 videos"): PlaylistSummary => ({
  type: "playlist",
  id,
  title,
  thumbnailUrl: null,
  videoCountText,
});

/** Lets a fire-and-forget refresh from the previous test land before seeding state. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const ids = () => useServerPlaylistsStore.getState().playlists.map((playlist) => playlist.id);

describe("useServerPlaylistsStore", () => {
  beforeEach(async () => {
    getAccountSignedIn.mockClear();
    getAccountSignedIn.mockResolvedValue(true);
    getServerPlaylists.mockClear();
    getServerPlaylists.mockResolvedValue({ playlists: [], continuation: null });
    createServerPlaylist.mockClear();
    deleteServerPlaylist.mockClear();
    deleteServerPlaylist.mockResolvedValue(undefined);
    renameServerPlaylist.mockClear();
    addVideosToServerPlaylist.mockClear();
    removeVideosFromServerPlaylist.mockClear();
    await flush();
    useServerPlaylistsStore.setState({ playlists: [], loaded: false, loading: false });
  });

  it("stays empty when signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    await useServerPlaylistsStore.getState().load();
    expect(useServerPlaylistsStore.getState().playlists).toEqual([]);
    expect(useServerPlaylistsStore.getState().loaded).toBe(true);
    expect(getServerPlaylists).not.toHaveBeenCalled();
  });

  it("loads the account's playlists and tags them for the cards", async () => {
    getServerPlaylists.mockResolvedValue({
      playlists: [summary("PL1", "One"), summary("PL2", "Two")],
      continuation: null,
    });
    await useServerPlaylistsStore.getState().load();
    expect(ids()).toEqual(["PL1", "PL2"]);
    expect(useServerPlaylistsStore.getState().playlists[0]!.type).toBe("playlist");
    expect(useServerPlaylistsStore.getState().loaded).toBe(true);
  });

  it("walks continuation pages", async () => {
    getServerPlaylists
      .mockResolvedValueOnce({ playlists: [summary("PL1", "One")], continuation: "tok" })
      .mockResolvedValueOnce({ playlists: [summary("PL2", "Two")], continuation: null });
    await useServerPlaylistsStore.getState().load();
    expect(ids()).toEqual(["PL1", "PL2"]);
    expect(getServerPlaylists).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good list when a re-read fails", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PL1", "One")] });
    getServerPlaylists.mockRejectedValueOnce(new Error("gone"));
    await useServerPlaylistsStore.getState().refresh();
    expect(ids()).toEqual(["PL1"]);
  });

  it("merges: a fresh response updates what it carries, the rest is kept", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PL1", "One"), summary("PL2", "Two")] });
    getServerPlaylists.mockResolvedValue({
      playlists: [summary("PL1", "One, renamed")],
      continuation: null,
    });
    await useServerPlaylistsStore.getState().refresh();
    expect(ids()).toEqual(["PL1", "PL2"]);
    expect(useServerPlaylistsStore.getState().playlists[0]!.title).toBe("One, renamed");
  });

  it("never resurrects a deleted playlist on the next refresh", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PLdel", "Gone"), summary("PLkeep", "Keep")] });
    await useServerPlaylistsStore.getState().deletePlaylist("PLdel");
    expect(ids()).toEqual(["PLkeep"]);
    getServerPlaylists.mockResolvedValue({
      playlists: [summary("PLdel", "Gone"), summary("PLkeep", "Keep")],
      continuation: null,
    });
    await useServerPlaylistsStore.getState().refresh();
    expect(ids()).toEqual(["PLkeep"]);
  });

  it("puts the playlist back when the server refuses the delete", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PLref", "Refused"), summary("PLkeep", "Keep")] });
    getServerPlaylists.mockResolvedValue({
      playlists: [summary("PLref", "Refused"), summary("PLkeep", "Keep")],
      continuation: null,
    });
    deleteServerPlaylist.mockRejectedValueOnce(new Error("nope"));
    await expect(useServerPlaylistsStore.getState().deletePlaylist("PLref")).rejects.toThrow("nope");
    expect(ids()).toEqual(["PLref", "PLkeep"]);
  });

  it("creates on the account and shows the entry at once", async () => {
    const entry = await useServerPlaylistsStore.getState().create("  New list  ");
    expect(createServerPlaylist).toHaveBeenCalledWith("New list");
    expect(entry.id).toBe("PL-new");
    expect(entry.title).toBe("New list");
    expect(entry.videoCountText).toBe("0 videos");
    expect(ids()[0]).toBe("PL-new");
  });

  it("renames on the account and updates the title locally", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PL1", "One")] });
    await useServerPlaylistsStore.getState().rename("PL1", "Renamed");
    expect(renameServerPlaylist).toHaveBeenCalledWith("PL1", "Renamed");
    expect(useServerPlaylistsStore.getState().playlists[0]!.title).toBe("Renamed");
  });

  it("bumps the count on bulk add and remove", async () => {
    useServerPlaylistsStore.setState({ playlists: [summary("PL1", "One", "2 videos")] });
    await useServerPlaylistsStore.getState().addVideos("PL1", ["v1", "v2"]);
    expect(useServerPlaylistsStore.getState().playlists[0]!.videoCountText).toBe("4 videos");
    await useServerPlaylistsStore.getState().removeVideos("PL1", ["v1"]);
    expect(useServerPlaylistsStore.getState().playlists[0]!.videoCountText).toBe("3 videos");
  });

  it("treats system lists and listed playlists as server playlists", () => {
    expect(isSystemServerPlaylistId("WL")).toBe(true);
    expect(isSystemServerPlaylistId("LL")).toBe(true);
    expect(isSystemServerPlaylistId("LM")).toBe(true);
    expect(isSystemServerPlaylistId("PL1")).toBe(false);
    useServerPlaylistsStore.setState({ playlists: [summary("PL1", "One")] });
    const state = useServerPlaylistsStore.getState();
    expect(state.isServerPlaylist("WL")).toBe(true);
    expect(state.isServerPlaylist("PL1")).toBe(true);
    expect(state.isServerPlaylist("PL9")).toBe(false);
  });
});
