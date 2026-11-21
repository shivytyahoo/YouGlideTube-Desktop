import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusicLibraryShelves } from "./useMusicLibraryShelves";
import { useAlbumLibraryStore, type StoredAlbum } from "../store/useAlbumLibraryStore";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import type { YTItem } from "../types/music";

const useServerMusicLibrary = vi.fn();

vi.mock("./useServerMusicLibrary", () => ({
  useServerMusicLibrary: (...args: unknown[]) => useServerMusicLibrary(...args),
  libraryCollectionId: (item: YTItem) => (item.type === "album" ? item.browseId : item.id),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playlist = (id: string): YTItem => ({
  type: "playlist",
  id,
  title: id,
  author: null,
  songCountText: null,
  thumbnail: null,
});

const serverAlbum = (browseId: string): YTItem => ({
  type: "album",
  browseId,
  playlistId: "",
  title: browseId,
  artists: null,
  year: null,
  thumbnail: "",
  explicit: false,
});

const storedAlbum = (id: string, source: "Owned" | "Saved"): StoredAlbum => ({
  id,
  title: id,
  source,
  description: "",
  artists: null,
  year: null,
  thumbnail: null,
  explicit: false,
  browseId: id,
  playlistId: "",
});

let latest: ReturnType<typeof useMusicLibraryShelves>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useMusicLibraryShelves();
  return null;
}

function renderHarness() {
  act(() => {
    root.render(createElement(Harness));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useServerMusicLibrary.mockReturnValue({
    status: "signed-out",
    items: [],
    playlists: [],
  });
  root = createRoot(document.createElement("div"));
  act(() => {
    useAlbumLibraryStore.setState({ albums: [], loaded: true, load: vi.fn() });
    useSubscriptionStore.setState({ subscriptions: [] });
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

describe("useMusicLibraryShelves", () => {
  it("stays local when signed out", () => {
    act(() => {
      useAlbumLibraryStore.setState({ albums: [storedAlbum("local-1", "Owned")] });
    });
    renderHarness();
    const section = latest.find((s) => s.id === "your-playlists");
    expect(section).toBeDefined();
    expect(section!.items).toHaveLength(1);
    expect(section!.items[0]!.type).toBe("album");
  });

  it("puts the account's saved playlists first when signed in", () => {
    useServerMusicLibrary.mockReturnValue({
      status: "signed-in",
      items: [playlist("PL1")],
      playlists: [playlist("PL1")],
    });
    act(() => {
      useAlbumLibraryStore.setState({ albums: [storedAlbum("local-1", "Owned")] });
    });
    renderHarness();
    const section = latest.find((s) => s.id === "your-playlists");
    expect(section).toBeDefined();
    expect(section!.items.map((item) => (item.type === "album" ? item.browseId : item.id))).toEqual([
      "PL1",
      "local-1",
    ]);
  });

  it("shows a saved album once, from the local store, even when the server lists it too", () => {
    useServerMusicLibrary.mockReturnValue({
      status: "signed-in",
      items: [serverAlbum("MPREb_dup")],
      playlists: [],
    });
    act(() => {
      useAlbumLibraryStore.setState({
        albums: [storedAlbum("MPREb_dup", "Saved"), storedAlbum("local-1", "Owned")],
      });
    });
    renderHarness();
    const section = latest.find((s) => s.id === "your-playlists");
    // The server's album is not a playlist, so it never enters this shelf;
    // the saved album still shows once, from the local store, after owned.
    expect(section!.items).toHaveLength(2);
    expect(section!.items[0]!.type).toBe("album");
    expect((section!.items[0]! as { browseId: string }).browseId).toBe("local-1");
    expect((section!.items[1]! as { browseId: string }).browseId).toBe("MPREb_dup");
  });
});
