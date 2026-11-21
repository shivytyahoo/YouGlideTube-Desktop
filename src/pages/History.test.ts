// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { History } from "./History";
import { useHistoryStore } from "../store/useHistoryStore";

const serverHook = vi.hoisted(() => ({
  status: "signed-in",
  entries: [] as unknown[],
  records: [] as unknown[],
  loading: false,
  loadingMore: false,
  loadMoreFailed: false,
  hasMore: false,
  error: "boom" as string | null,
  refresh: vi.fn(),
  remerge: vi.fn(),
  loadMore: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  removeShorts: vi.fn(),
}));
vi.mock("../lib/useServerHistory", () => ({
  useServerHistory: () => serverHook,
}));
vi.mock("../lib/api/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api/db")>()),
  getWatchHistory: async () => [],
  getWatchHistoryYears: async () => [],
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderHistory() {
  act(() => {
    root.render(createElement(History));
  });
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

beforeEach(() => {
  vi.clearAllMocks();
  serverHook.status = "signed-in";
  serverHook.error = "boom";
  serverHook.entries = [];
  serverHook.records = [];
  serverHook.loading = false;
  useHistoryStore.setState({
    records: [],
    loaded: true,
    loading: false,
    loadingMore: false,
    hasMore: false,
    offset: 0,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

describe("History server error", () => {
  it("shows the server failure instead of an empty history", () => {
    renderHistory();
    expect(host.textContent).toContain("Couldn't load your history from your Google account.");
    expect(button("Retry")).toBeDefined();
  });

  it("retries the server load from the error box", async () => {
    renderHistory();
    await act(async () => {
      button("Retry")!.click();
    });
    expect(serverHook.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows no error box when the server load succeeded", () => {
    serverHook.error = null;
    renderHistory();
    expect(host.textContent).not.toContain("Couldn't load your history from your Google account.");
  });

  it("shows no error box when signed out", () => {
    serverHook.status = "signed-out";
    renderHistory();
    expect(host.textContent).not.toContain("Couldn't load your history from your Google account.");
  });
});
