import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendApiError } from "./api/errors";
import { mergedEntryToRecord, useServerHistory } from "./useServerHistory";
import type {
  MergedHistoryEntry,
  ServerHistoryEntry,
  ServerHistoryPage,
} from "./api/account";

const getAccountSignedIn = vi.fn();
const getServerHistory = vi.fn();
const mergeWatchHistory = vi.fn();
const clearServerHistory = vi.fn();
const listen = vi.fn();
const unlisten = vi.fn();
const deleteWatchRecord = vi.fn();
const deleteShortWatchRecords = vi.fn();
const clearHistoryStore = vi.fn();

vi.mock("./api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/account")>()),
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
  getServerHistory: (...args: unknown[]) => getServerHistory(...args),
  mergeWatchHistory: (...args: unknown[]) => mergeWatchHistory(...args),
  clearServerHistory: (...args: unknown[]) => clearServerHistory(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("./useGoogleAccount", () => ({
  GOOGLE_SIGN_IN_COMPLETED_EVENT: "google-sign-in-completed",
  GOOGLE_ACCOUNT_SWITCHED_EVENT: "google-account-switched",
}));
vi.mock("./api/db", () => ({
  deleteWatchRecord: (...args: unknown[]) => deleteWatchRecord(...args),
  deleteShortWatchRecords: (...args: unknown[]) => deleteShortWatchRecords(...args),
}));
vi.mock("../store/useHistoryStore", () => ({
  useHistoryStore: { getState: () => ({ clear: clearHistoryStore }) },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const serverEntry = (
  videoId: string,
  overrides: Partial<ServerHistoryEntry> = {},
): ServerHistoryEntry => ({
  videoId,
  title: videoId,
  channelName: "Channel",
  isShort: false,
  timestampMs: 1_700_000_000_000,
  ...overrides,
});

function historyPage(overrides: Partial<ServerHistoryPage>): ServerHistoryPage {
  return { entries: [], continuation: null, ...overrides };
}

let latest: ReturnType<typeof useServerHistory>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useServerHistory();
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
  listen.mockResolvedValue(unlisten);
  deleteWatchRecord.mockResolvedValue(undefined);
  deleteShortWatchRecords.mockResolvedValue(undefined);
  clearHistoryStore.mockResolvedValue(undefined);
  clearServerHistory.mockResolvedValue(true);
  // The merge keeps server order and appends this device's own plays.
  mergeWatchHistory.mockImplementation(async (entries: ServerHistoryEntry[]) => [
    ...entries.map(
      (entry): MergedHistoryEntry => ({
        ...entry,
        positionSeconds: 0,
        source: "server",
      }),
    ),
    {
      videoId: "local-1",
      title: "Local",
      channelName: "Channel",
      positionSeconds: 42,
      isShort: false,
      timestampMs: 1_700_000_000_001,
      source: "local",
    },
  ]);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe("useServerHistory", () => {
  it("stays signed-out and never calls history while signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.entries).toEqual([]);
    expect(getServerHistory).not.toHaveBeenCalled();
  });

  it("merges server entries with local plays and maps them to records", async () => {
    getServerHistory.mockResolvedValueOnce(
      historyPage({ entries: [serverEntry("v1", { removeFeedbackToken: "tok-v1" })] }),
    );

    await renderHarness();

    expect(mergeWatchHistory).toHaveBeenCalledWith([
      expect.objectContaining({ videoId: "v1" }),
    ]);
    expect(latest.entries.map((entry) => entry.videoId)).toEqual(["v1", "local-1"]);
    expect(latest.records[0]).toMatchObject({
      videoId: "v1",
      watchDurationSeconds: 0,
      isShort: false,
    });
    expect(latest.records[1]?.videoId).toBe("local-1");
  });

  it("reloads when the active account switches after mount", async () => {
    getServerHistory
      .mockResolvedValueOnce(historyPage({ entries: [serverEntry("v1")] }))
      .mockResolvedValueOnce(historyPage({ entries: [serverEntry("v2")] }));

    await renderHarness();
    expect(latest.entries.map((entry) => entry.videoId)).toEqual(["v1", "local-1"]);

    // The second listener is the account-switched one.
    expect(listen.mock.calls[1]?.[0]).toBe("google-account-switched");
    const handler = listen.mock.calls[1]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });
    await vi.waitFor(() => expect(getServerHistory).toHaveBeenCalledTimes(2));
    expect(latest.entries.map((entry) => entry.videoId)).toEqual(["v2", "local-1"]);
  });

  it("dedupes repeated videos across continuation pages", async () => {
    getServerHistory
      .mockResolvedValueOnce(
        historyPage({ entries: [serverEntry("v1")], continuation: "page-2" }),
      )
      .mockResolvedValueOnce(
        historyPage({ entries: [serverEntry("v1"), serverEntry("v2")] }),
      );

    await renderHarness();
    await act(async () => {
      await latest.loadMore();
    });
    await vi.waitFor(() => expect(getServerHistory).toHaveBeenCalledTimes(2));

    const calls = mergeWatchHistory.mock.calls;
    const lastMerge = calls[calls.length - 1]?.[0] as ServerHistoryEntry[];
    expect(lastMerge.map((entry) => entry.videoId)).toEqual(["v1", "v2"]);
  });

  it("removes a server row with its own token, then drops the local row", async () => {
    getServerHistory.mockResolvedValueOnce(
      historyPage({ entries: [serverEntry("v1", { removeFeedbackToken: "tok-v1" })] }),
    );

    await renderHarness();
    let removed = false;
    await act(async () => {
      removed = await latest.remove("v1");
    });

    expect(removed).toBe(true);
    expect(clearServerHistory).toHaveBeenCalledWith(null, ["tok-v1"]);
    expect(deleteWatchRecord).toHaveBeenCalledWith("v1");
  });

  it("refuses to remove a server row that carries no token", async () => {
    getServerHistory.mockResolvedValueOnce(historyPage({ entries: [serverEntry("v1")] }));

    await renderHarness();
    let removed = true;
    await act(async () => {
      removed = await latest.remove("v1");
    });

    expect(removed).toBe(false);
    expect(clearServerHistory).not.toHaveBeenCalled();
    expect(deleteWatchRecord).not.toHaveBeenCalled();
  });

  it("removes a local-only row without touching the server", async () => {
    getServerHistory.mockResolvedValueOnce(historyPage({ entries: [] }));

    await renderHarness();
    let removed = false;
    await act(async () => {
      removed = await latest.remove("local-1");
    });

    expect(removed).toBe(true);
    expect(clearServerHistory).not.toHaveBeenCalled();
    expect(deleteWatchRecord).toHaveBeenCalledWith("local-1");
  });

  it("clears with the clear token plus every row's token", async () => {
    getServerHistory.mockResolvedValueOnce(
      historyPage({
        entries: [
          serverEntry("v1", { removeFeedbackToken: "tok-v1" }),
          serverEntry("v2", { removeFeedbackToken: "tok-v2" }),
        ],
        clearHistoryToken: "clear-tok",
      }),
    );

    await renderHarness();
    let cleared = false;
    await act(async () => {
      cleared = await latest.clear();
    });

    expect(cleared).toBe(true);
    expect(clearServerHistory).toHaveBeenCalledWith("clear-tok", ["tok-v1", "tok-v2"]);
    expect(clearHistoryStore).toHaveBeenCalledTimes(1);
    expect(latest.entries).toEqual([]);
  });

  it("keeps the list when the server refuses to clear", async () => {
    clearServerHistory.mockResolvedValue(false);
    getServerHistory.mockResolvedValueOnce(
      historyPage({ entries: [serverEntry("v1", { removeFeedbackToken: "tok-v1" })] }),
    );

    await renderHarness();
    let cleared = true;
    await act(async () => {
      cleared = await latest.clear();
    });

    expect(cleared).toBe(false);
    expect(latest.entries.map((entry) => entry.videoId)).toContain("v1");
    expect(clearHistoryStore).not.toHaveBeenCalled();
  });

  it("removes token-bearing Shorts and leaves token-less ones listed", async () => {
    getServerHistory.mockResolvedValueOnce(
      historyPage({
        entries: [
          serverEntry("short-1", { isShort: true, removeFeedbackToken: "tok-short-1" }),
          serverEntry("short-2", { isShort: true }),
          serverEntry("v1"),
        ],
      }),
    );

    await renderHarness();
    let removed = false;
    await act(async () => {
      removed = await latest.removeShorts();
    });

    expect(removed).toBe(true);
    expect(clearServerHistory).toHaveBeenCalledWith(null, ["tok-short-1"]);
    expect(deleteShortWatchRecords).toHaveBeenCalledTimes(1);
    expect(latest.entries.map((entry) => entry.videoId)).toEqual([
      "short-2",
      "v1",
      "local-1",
    ]);
  });

  it("drops to signed-out on a Validation error", async () => {
    getServerHistory.mockRejectedValueOnce(
      new BackendApiError("not signed in", "validation", null),
    );

    await renderHarness();

    expect(latest.status).toBe("signed-out");
    expect(latest.entries).toEqual([]);
  });
});

describe("mergedEntryToRecord", () => {
  it("reads the watch date from the server timestamp", () => {
    const record = mergedEntryToRecord({
      videoId: "v1",
      title: "V1",
      channelName: "Channel",
      positionSeconds: 30,
      durationSeconds: 120,
      isShort: false,
      timestampMs: 1_700_000_000_000,
      source: "server",
    });
    expect(record.watchDate).toBe(new Date(1_700_000_000_000).toISOString());
    expect(record.watchDurationSeconds).toBe(30);
    expect(record.totalDurationSeconds).toBe(120);
    expect(record.isMusic).toBe(false);
  });
});
