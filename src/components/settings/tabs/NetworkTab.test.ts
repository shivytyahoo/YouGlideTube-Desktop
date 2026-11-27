import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NetworkTab } from "./NetworkTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../lib/usePreference", () => ({
  usePreference: (_key: string, fallback: string) => [fallback, vi.fn()],
  useBoolPref: (_key: string, fallback?: boolean) => [fallback ?? false, vi.fn()],
  useNumberPref: (_key: string, fallback?: number) => [fallback ?? 0, vi.fn()],
}));
vi.mock("../../../lib/cache/useCacheUsage", () => ({
  useCacheUsage: () => ({ usage: null, busy: null, clear: vi.fn(), changeLimit: vi.fn() }),
}));

describe("NetworkTab long read-ahead", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("offers reading further ahead next to the buffer profile rows", () => {
    act(() => root.render(createElement(NetworkTab)));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Read further ahead");
    expect(text).toContain("Buffer up to 2 minutes ahead at top quality");
    // It sits in the buffer group, beside the disk read-ahead row.
    expect(text.indexOf("Read further ahead")).toBeGreaterThan(text.indexOf("Disk read-ahead"));
  });
});
