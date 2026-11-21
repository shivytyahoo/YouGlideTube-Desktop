import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createPlaylistWithVideos = vi.fn();
const addVideosToPlaylistWithToast = vi.fn(async (..._args: unknown[]) => true);
vi.mock("../../lib/addVideosToPlaylist", () => ({
  addVideosToPlaylistWithToast: (...args: unknown[]) => addVideosToPlaylistWithToast(...args),
  createPlaylistWithVideos: (...args: unknown[]) => createPlaylistWithVideos(...args),
}));
const getAccountSignedIn = vi.fn(async () => true);
const getServerPlaylists = vi.fn(async (_continuation?: string) => ({
  playlists: [
    { type: "playlist", id: "PLsrv", title: "Server list", thumbnailUrl: null, videoCountText: "2 videos" },
  ],
  continuation: null,
}));
vi.mock("../../lib/api/account", () => ({
  getAccountSignedIn: () => getAccountSignedIn(),
  getServerPlaylists: (...args: [string | undefined]) => getServerPlaylists(...args),
  createServerPlaylist: vi.fn(),
  deleteServerPlaylist: vi.fn(),
  renameServerPlaylist: vi.fn(),
  addVideoToServerPlaylist: vi.fn(),
  removeVideoFromServerPlaylist: vi.fn(),
  addVideosToServerPlaylist: vi.fn(),
  removeVideosFromServerPlaylist: vi.fn(),
  isSignedOutError: () => false,
}));
vi.mock("../../lib/useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));
vi.mock("../../lib/playlistLibrary", () => ({
  WATCH_LATER_PLAYLIST_ID: "watch-later",
  loadStoredPlaylists: async () => [],
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
}));

import { getString } from "../../lib/i18n/index";
import type { VideoSummary } from "../../types/video";
import { AddAllToPlaylistDialog } from "./AddAllToPlaylistDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AddAllToPlaylistDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    createPlaylistWithVideos.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("makes one playlist however many times Create is pressed", async () => {
    let finish!: (made: boolean) => void;
    createPlaylistWithVideos.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    const loadVideos = async () => [];
    await act(async () => root.render(createElement(AddAllToPlaylistDialog, { loadVideos, onClose: () => undefined })));

    const open = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(getString("playlist_add_modal_create")))!;
    await act(async () => open.click());
    const name = host.querySelector<HTMLInputElement>("#playlist-form-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "New");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = host.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(createPlaylistWithVideos).toHaveBeenCalledTimes(1);
    await act(async () => finish(false));
  });

  it("lists an account playlist and adds the videos to it on the server", async () => {
    const loadVideos = async () => [{ id: "v1", title: "v1" } as unknown as VideoSummary];
    const onClose = vi.fn();
    await act(async () => root.render(createElement(AddAllToPlaylistDialog, { loadVideos, onClose })));
    // The account's playlists arrive after the store's first read.
    await act(async () => {});

    const card = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Server list"),
    );
    expect(card).toBeDefined();
    await act(async () => card!.click());

    expect(addVideosToPlaylistWithToast).toHaveBeenCalledTimes(1);
    const [target, videos] = addVideosToPlaylistWithToast.mock.calls[0] as unknown as [
      { id: string },
      { id: string }[],
    ];
    expect(target.id).toBe("PLsrv");
    expect(videos.map((video) => video.id)).toEqual(["v1"]);
    expect(onClose).toHaveBeenCalled();
  });
});
