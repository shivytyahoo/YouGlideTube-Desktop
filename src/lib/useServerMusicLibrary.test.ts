import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  libraryCollectionId,
  useServerMusicLibrary,
} from "./useServerMusicLibrary";
import type { MusicLibraryPage } from "../types/music";
import type { PlaylistItem, YTItem } from "../types/music";

const getAccountSignedIn = vi.fn();
const getMusicLibrary = vi.fn();
const setMusicPlaylistSaved = vi.fn();
const listen = vi.fn();

vi.mock("./api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/account")>()),
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
}));
vi.mock("./api/music", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/music")>()),
  getMusicLibrary: (...args: unknown[]) => getMusicLibrary(...args),
  setMusicPlaylistSaved: (...args: unknown[]) =>
    setMusicPlaylistSaved(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));
vi.mock("./useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playlist = (id: string, title = id): YTItem =>
  ({
    type: "playlist",
    id,
    title,
    author: null,
    songCountText: null,
    thumbnail: null,
  }) as PlaylistItem & { type: "playlist" };

function page(items: YTItem[], continuation: string | null = null): MusicLibraryPage {
  return { items, continuation };
}

let latest: ReturnType<typeof useServerMusicLibrary>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useServerMusicLibrary();
  return null;
}

async function renderHarness() {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await vi.waitFor(() => expect(latest.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccountSignedIn.mockResolvedValue(true);
  getMusicLibrary.mockResolvedValue(page([playlist("PL1"), playlist("PL2")], "tok-1"));
  setMusicPlaylistSaved.mockResolvedValue(true);
  listen.mockResolvedValue(() => {});
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
});

describe("libraryCollectionId", () => {
  it("uses the browse id for albums and the id for playlists", () => {
    expect(
      libraryCollectionId({
        type: "album",
        browseId: "MPREb_abc",
        playlistId: "",
        title: "A",
        artists: null,
        year: null,
        thumbnail: "",
        explicit: false,
      }),
    ).toBe("MPREb_abc");
    expect(libraryCollectionId(playlist("PL9"))).toBe("PL9");
  });
});

describe("useServerMusicLibrary", () => {
  it("loads the server library and seeds the saved set from it", async () => {
    await renderHarness();
    expect(latest.status).toBe("signed-in");
    expect(latest.playlists.map((p) => p.id)).toEqual(["PL1", "PL2"]);
    expect(latest.savedIds.has("PL1")).toBe(true);
    expect(latest.savedIds.has("PL2")).toBe(true);
    expect(getMusicLibrary).toHaveBeenCalledTimes(1);
  });

  it("stays local when signed out and never calls the server", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    await renderHarness();
    expect(latest.status).toBe("signed-out");
    expect(latest.items).toEqual([]);
    expect(getMusicLibrary).not.toHaveBeenCalled();
  });

  it("rolls the saved set back when the server refuses the save", async () => {
    await renderHarness();
    setMusicPlaylistSaved.mockRejectedValueOnce(new Error("nope"));
    let saved: boolean | undefined;
    await act(async () => {
      saved = await latest.setCollectionSaved("PL9", true);
    });
    expect(saved).toBe(false);
    expect(latest.savedIds.has("PL9")).toBe(false);
    expect(setMusicPlaylistSaved).toHaveBeenCalledWith("PL9", true);
  });

  it("pages the library and dedupes by collection id", async () => {
    await renderHarness();
    getMusicLibrary.mockResolvedValueOnce(
      page([playlist("PL2"), playlist("PL3")], null),
    );
    await act(async () => {
      await latest.loadMore();
    });
    expect(latest.playlists.map((p) => p.id)).toEqual(["PL1", "PL2", "PL3"]);
  });
});
