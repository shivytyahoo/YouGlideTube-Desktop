import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadStorageGroup } from "./DownloadStorageGroup";
import type { DownloadStorageRow } from "../../../lib/api/downloadStorage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows: DownloadStorageRow[] = [
  { kind: "video", bytes: 2 * 1024 ** 3, files: 4, limitMb: 500 },
  { kind: "music", bytes: 512 * 1024 ** 2, files: 9, limitMb: 0 },
];

vi.mock("../../../lib/api/downloadStorage", () => ({
  getDownloadStorageUsage: async () => rows,
}));

vi.mock("../../../lib/usePreference", () => ({
  useNumberPref: (_key: string, fallback: number) => [fallback, vi.fn()],
}));

describe("DownloadStorageGroup", () => {
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
    vi.clearAllMocks();
  });

  it("meters downloads by type and shows each type's size against its limit", async () => {
    await act(async () => {
      root.render(createElement(DownloadStorageGroup));
    });
    const text = host.textContent ?? "";
    expect(text).toContain("2.5 GB in use");
    expect(text).toContain("2.0 GB of 500 MB");
    expect(text).toContain("512 MB, no limit");
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent ?? "");
    expect(buttons.some((label) => label.includes("500 MB"))).toBe(true);
    expect(buttons.some((label) => label.includes("Unlimited"))).toBe(true);
  });
});
