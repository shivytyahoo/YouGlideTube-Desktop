import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

const loadStoredPlaylists = vi.fn();
const addVideoToWatchLater = vi.fn();
const removeVideoFromWatchLater = vi.fn();
const getAccountSignedIn = vi.fn();
const setVideoWatchLater = vi.fn();
const getWatchLater = vi.fn();

vi.mock("../lib/playlistLibrary", () => ({
  PLAYLIST_LIBRARY_UPDATED_EVENT: "youglidetube:playlist-library-updated",
  WATCH_LATER_PLAYLIST_ID: "watch-later",
  loadStoredPlaylists: (...args: unknown[]) => loadStoredPlaylists(...args),
  addVideoToWatchLater: (...args: unknown[]) => addVideoToWatchLater(...args),
  removeVideoFromWatchLater: (...args: unknown[]) => removeVideoFromWatchLater(...args),
}));

vi.mock("../lib/api/account", () => ({
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
  setVideoWatchLater: (...args: unknown[]) => setVideoWatchLater(...args),
  getWatchLater: (...args: unknown[]) => getWatchLater(...args),
}));

const { useWatchLaterStore, WatchLaterRemoveNeedsRefreshError } = await import(
  "./useWatchLaterStore"
);

const video = (id: string) => ({ id, title: id }) as VideoSummary;

function libraryWith(ids: string[]) {
  return [
    { id: "watch-later", tracks: ids.map((id) => ({ id })) },
    { id: "other", tracks: [{ id: "elsewhere" }] },
  ];
}

describe("useWatchLaterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWatchLaterStore.setState({
      ids: new Set(),
      loaded: false,
      serverSetVideoIds: {},
      serverVersion: 0,
    });
    loadStoredPlaylists.mockResolvedValue(libraryWith(["a", "b"]));
    addVideoToWatchLater.mockResolvedValue(undefined);
    removeVideoFromWatchLater.mockResolvedValue(undefined);
    getAccountSignedIn.mockResolvedValue(false);
    setVideoWatchLater.mockResolvedValue(true);
  });

  it("reads only the Watch Later playlist's ids", async () => {
    await useWatchLaterStore.getState().load();

    const { ids } = useWatchLaterStore.getState();
    expect([...ids].sort()).toEqual(["a", "b"]);
    expect(ids.has("elsewhere")).toBe(false);
  });

  /*
    The whole point of the store: a feed mounts hundreds of cards at once, and
    they must not each trigger a read of the playlist library.
  */
  it("collapses concurrent loads into a single read", async () => {
    await Promise.all([
      useWatchLaterStore.getState().load(),
      useWatchLaterStore.getState().load(),
      useWatchLaterStore.getState().load(),
    ]);

    expect(loadStoredPlaylists).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous set when a read fails", async () => {
    await useWatchLaterStore.getState().load();
    loadStoredPlaylists.mockRejectedValueOnce(new Error("db down"));

    await useWatchLaterStore.getState().load();

    expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("adds optimistically, before the write resolves", async () => {
    let release = () => {};
    addVideoToWatchLater.mockReturnValueOnce(new Promise<void>((r) => { release = r; }));

    const pending = useWatchLaterStore.getState().add(video("c"));
    expect(useWatchLaterStore.getState().ids.has("c")).toBe(true);

    release();
    await pending;
  });

  it("rolls back an add when the write throws", async () => {
    await useWatchLaterStore.getState().load();
    addVideoToWatchLater.mockRejectedValueOnce(new Error("disk full"));

    await expect(useWatchLaterStore.getState().add(video("c"))).rejects.toThrow("disk full");
    expect(useWatchLaterStore.getState().ids.has("c")).toBe(false);
    expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("rolls back a remove when the write throws", async () => {
    await useWatchLaterStore.getState().load();
    removeVideoFromWatchLater.mockRejectedValueOnce(new Error("disk full"));

    await expect(useWatchLaterStore.getState().remove("a")).rejects.toThrow("disk full");
    expect(useWatchLaterStore.getState().ids.has("a")).toBe(true);
  });

  /*
    Import and P2P sync mutate the library without going through this store, so
    the event is the only thing keeping the set honest for those paths.
  */
  it("reloads when the library reports an external change", async () => {
    await useWatchLaterStore.getState().load();
    loadStoredPlaylists.mockResolvedValue(libraryWith(["a", "b", "synced"]));

    window.dispatchEvent(new Event("youglidetube:playlist-library-updated"));
    await vi.waitFor(() => {
      expect(useWatchLaterStore.getState().ids.has("synced")).toBe(true);
    });
  });

  it("ignores the event before the first load, so nothing reads eagerly", () => {
    window.dispatchEvent(new Event("youglidetube:playlist-library-updated"));

    expect(loadStoredPlaylists).not.toHaveBeenCalled();
  });

  describe("server Watch Later", () => {
    beforeEach(() => {
      getAccountSignedIn.mockResolvedValue(true);
      getWatchLater.mockResolvedValue({ title: "Watch later", videos: [], continuation: null });
    });

    // First in this block: it is the first signed-in load in the file,
    // so it is the one that syncs with the server.
    it("syncs the server list once per session and retries after a failed sync", async () => {
      getWatchLater.mockRejectedValueOnce(new Error("server down"));
      await useWatchLaterStore.getState().load();
      // The failed sync leaves the local mirror alone and retries next time.
      expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b"]);

      getWatchLater.mockResolvedValue({
        title: "Watch later",
        videos: [{ video: video("phone"), setVideoId: "set-phone" }],
        continuation: null,
      });
      await useWatchLaterStore.getState().load();
      expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b", "phone"]);
      expect(useWatchLaterStore.getState().serverSetVideoIds).toEqual({ phone: "set-phone" });

      await useWatchLaterStore.getState().load();
      expect(getWatchLater).toHaveBeenCalledTimes(2);
    });

    it("labels a video saved on the phone as saved", async () => {
      await useWatchLaterStore.getState().load();
      useWatchLaterStore.getState().setServerSetVideoIds({ phone: "set-phone" });

      expect(useWatchLaterStore.getState().ids.has("phone")).toBe(true);
    });

    it("resolves the entry id before removing a video saved this session", async () => {
      await useWatchLaterStore.getState().load();
      await useWatchLaterStore.getState().add(video("c"));
      expect(useWatchLaterStore.getState().serverSetVideoIds).toEqual({ c: null });

      getWatchLater.mockResolvedValue({
        title: "Watch later",
        videos: [{ video: video("c"), setVideoId: "set-c" }],
        continuation: null,
      });
      await useWatchLaterStore.getState().remove("c");

      expect(setVideoWatchLater).toHaveBeenCalledWith("c", false, "set-c");
      expect(removeVideoFromWatchLater).toHaveBeenCalledWith("c");
      expect(useWatchLaterStore.getState().ids.has("c")).toBe(false);
    });

    it("removes locally only when the server no longer carries the video", async () => {
      await useWatchLaterStore.getState().load();
      useWatchLaterStore.getState().setServerSetVideoIds({ b: null });

      await useWatchLaterStore.getState().remove("b");

      expect(setVideoWatchLater).not.toHaveBeenCalled();
      expect(removeVideoFromWatchLater).toHaveBeenCalledWith("b");
      expect(useWatchLaterStore.getState().ids.has("b")).toBe(false);
    });

    it("saves on the server first, then locally, and bumps the server version", async () => {
      await useWatchLaterStore.getState().load();

      await useWatchLaterStore.getState().add(video("c"));

      expect(setVideoWatchLater).toHaveBeenCalledWith("c", true);
      expect(addVideoToWatchLater).toHaveBeenCalledTimes(1);
      expect(useWatchLaterStore.getState().ids.has("c")).toBe(true);
      expect(useWatchLaterStore.getState().serverVersion).toBe(1);
    });

    it("rolls back an add when the server save fails, without touching the library", async () => {
      await useWatchLaterStore.getState().load();
      setVideoWatchLater.mockRejectedValueOnce(new Error("server down"));

      await expect(useWatchLaterStore.getState().add(video("c"))).rejects.toThrow(
        "server down",
      );
      expect(useWatchLaterStore.getState().ids.has("c")).toBe(false);
      expect(addVideoToWatchLater).not.toHaveBeenCalled();
      expect(useWatchLaterStore.getState().serverVersion).toBe(0);
    });

    it("removes through the server when the page published an entry id", async () => {
      await useWatchLaterStore.getState().load();
      useWatchLaterStore.getState().setServerSetVideoIds({ a: "set-a", b: null });

      await useWatchLaterStore.getState().remove("a");

      expect(setVideoWatchLater).toHaveBeenCalledWith("a", false, "set-a");
      expect(removeVideoFromWatchLater).toHaveBeenCalledWith("a");
      expect(useWatchLaterStore.getState().ids.has("a")).toBe(false);
      expect(useWatchLaterStore.getState().serverVersion).toBe(1);
    });

    it("refuses a remove when the server row has no entry id, and keeps the video", async () => {
      await useWatchLaterStore.getState().load();
      useWatchLaterStore.getState().setServerSetVideoIds({ a: "set-a", b: null });
      // The list carries the video but no entry id for it: the remove
      // cannot go through until the list is re-read.
      getWatchLater.mockResolvedValue({
        title: "Watch later",
        videos: [{ video: video("b"), setVideoId: null }],
        continuation: null,
      });

      await expect(useWatchLaterStore.getState().remove("b")).rejects.toBeInstanceOf(
        WatchLaterRemoveNeedsRefreshError,
      );
      expect(setVideoWatchLater).not.toHaveBeenCalled();
      expect(removeVideoFromWatchLater).not.toHaveBeenCalled();
      expect(useWatchLaterStore.getState().ids.has("b")).toBe(true);
    });

    it("removes locally only when the server list does not carry the video", async () => {
      await useWatchLaterStore.getState().load();
      useWatchLaterStore.getState().setServerSetVideoIds({ a: "set-a" });

      await useWatchLaterStore.getState().remove("b");

      expect(setVideoWatchLater).not.toHaveBeenCalled();
      expect(removeVideoFromWatchLater).toHaveBeenCalledWith("b");
      expect(useWatchLaterStore.getState().ids.has("b")).toBe(false);
    });

    it("replaces the published entry-id map wholesale", () => {
      useWatchLaterStore.getState().setServerSetVideoIds({ a: "set-a" });
      useWatchLaterStore.getState().setServerSetVideoIds({ c: "set-c" });

      expect(useWatchLaterStore.getState().serverSetVideoIds).toEqual({ c: "set-c" });
    });
  });
});
