import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAccountSignedIn = vi.fn(async () => true);
const getServerPlaylists = vi.fn(async (_continuation?: string) => ({
  playlists: [
    { type: "playlist", id: "PLsrv", title: "Server list", thumbnailUrl: null, videoCountText: "2 videos" },
  ],
  continuation: null,
}));
const getWatchLater = vi.fn(async (..._args: unknown[]) => ({ title: "Watch later", videos: [], continuation: null }));
const setVideoWatchLater = vi.fn(async (..._args: unknown[]) => true);
const addVideoToServerPlaylist = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../../lib/api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  getServerPlaylists: (...args: [string | undefined]) => getServerPlaylists(...args),
  getWatchLater: (...args: unknown[]) => getWatchLater(...args),
  setVideoWatchLater: (...args: unknown[]) => setVideoWatchLater(...args),
  createServerPlaylist: vi.fn(),
  deleteServerPlaylist: vi.fn(),
  renameServerPlaylist: vi.fn(),
  addVideoToServerPlaylist: (...args: unknown[]) => addVideoToServerPlaylist(...args),
  removeVideoFromServerPlaylist: vi.fn(),
  addVideosToServerPlaylist: vi.fn(),
  removeVideosFromServerPlaylist: vi.fn(),
  isSignedOutError: () => false,
}));
vi.mock("../../lib/useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));
vi.mock("../../lib/recap/recapQueue", () => ({ recapVideoAction: () => undefined }));

const addVideoToStoredPlaylist = vi.fn(async (..._args: unknown[]) => ({ id: "PLlocal" }));
const addVideoToWatchLater = vi.fn(async (..._args: unknown[]) => undefined);
const localLibrary = () => [
  { id: "watch-later", name: "Watch later", source: "Owned", tracks: [], thumbnailUrl: null, videoCountText: "0 videos" },
  { id: "PLlocal", name: "Local list", source: "Owned", tracks: [], thumbnailUrl: null, videoCountText: "0 videos" },
];
vi.mock("../../lib/playlistLibrary", () => ({
  WATCH_LATER_PLAYLIST_ID: "watch-later",
  PLAYLIST_LIBRARY_UPDATED_EVENT: "youglidetube:playlist-library-updated",
  loadStoredPlaylists: async () => localLibrary(),
  addVideoToStoredPlaylist: (...args: unknown[]) => addVideoToStoredPlaylist(...args),
  addVideoToWatchLater: (...args: unknown[]) => addVideoToWatchLater(...args),
  removeVideoFromWatchLater: vi.fn(),
  createStoredPlaylist: vi.fn(),
  isProtectedPlaylistId: (playlistId: string) => playlistId === "watch-later",
  updateStoredPlaylistTracks: vi.fn(),
  serverPlaylistToStored: (playlist: { id: string; title: string; thumbnailUrl?: string | null; videoCountText?: string | null }) => ({
    id: playlist.id,
    name: playlist.title,
    sourceTitle: playlist.title,
    tracks: [],
    createdAt: new Date().toISOString(),
    source: "Owned",
    thumbnailUrl: playlist.thumbnailUrl ?? null,
    videoCount: 2,
    videoCountText: playlist.videoCountText ?? null,
  }),
  storedPlaylistToCardSummary: (playlist: { id: string; name: string; thumbnailUrl?: string | null; videoCountText?: string | null }) => ({
    type: "playlist",
    id: playlist.id,
    title: playlist.name,
    thumbnailUrl: playlist.thumbnailUrl ?? null,
    videoCountText: playlist.videoCountText ?? null,
  }),
  parseVideoCountFromText: (text?: string | null) => {
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1] ?? "", 10) : null;
  },
  formatVideoCountText: (count: number) => (count === 1 ? "1 video" : `${count} videos`),
}));

import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { usePlaylistModalStore } from "../../store/usePlaylistModalStore";
import { useServerPlaylistsStore } from "../../store/useServerPlaylistsStore";
import { useWatchLaterStore } from "../../store/useWatchLaterStore";
import type { VideoSummary } from "../../types/video";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = { id: "v1", title: "Video one", thumbnailUrl: null } as unknown as VideoSummary;

describe("AddToPlaylistModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    usePlaylistModalStore.setState({ addTarget: null });
    useServerPlaylistsStore.setState({ playlists: [], loaded: false, loading: false });
    useWatchLaterStore.setState({ ids: new Set(), loaded: true, serverSetVideoIds: {}, serverVersion: 0 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => usePlaylistModalStore.setState({ addTarget: video }));
    await act(async () => root.render(createElement(AddToPlaylistModal)));
    // The account's playlists arrive after the store's first read.
    await act(async () => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const card = (name: string) => [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(name),
  );

  it("saves Watch Later through the server path, not the local list", async () => {
    const watchLater = card("Watch later");
    expect(watchLater).toBeDefined();
    await act(async () => watchLater!.click());
    await vi.waitFor(() => expect(setVideoWatchLater).toHaveBeenCalledWith("v1", true));

    expect(addVideoToStoredPlaylist).not.toHaveBeenCalled();
    expect(useWatchLaterStore.getState().ids.has("v1")).toBe(true);
    expect(usePlaylistModalStore.getState().addTarget).toBeNull();
  });

  it("saves to an account playlist through the server, with no undo", async () => {
    const server = card("Server list");
    expect(server).toBeDefined();
    await act(async () => server!.click());
    await vi.waitFor(() => expect(addVideoToServerPlaylist).toHaveBeenCalledWith("PLsrv", "v1"));

    expect(setVideoWatchLater).not.toHaveBeenCalled();
    expect(addVideoToStoredPlaylist).not.toHaveBeenCalled();
    expect(usePlaylistModalStore.getState().addTarget).toBeNull();
  });

  it("still saves to a local playlist the old way", async () => {
    const local = card("Local list");
    expect(local).toBeDefined();
    await act(async () => local!.click());
    await vi.waitFor(() => expect(addVideoToStoredPlaylist).toHaveBeenCalledWith("PLlocal", video));

    expect(setVideoWatchLater).not.toHaveBeenCalled();
    expect(addVideoToServerPlaylist).not.toHaveBeenCalled();
    expect(usePlaylistModalStore.getState().addTarget).toBeNull();
  });
});
