import { describe, expect, it } from "vitest";

import strings from "./strings.json";

const base = strings as Record<string, string>;

describe("subscriptions strings", () => {
  it("has no Import-subscriptions option anywhere", () => {
    // Subscriptions come from the Google server; there is no import.
    // (Unrelated imports — playlist files, themes, fonts, backups — keep
    // their own keys; only the subscriptions import is gone.)
    expect(Object.keys(base).filter((key) => key.startsWith("subscriptions_import_"))).toEqual([]);
    expect(base.subscriptions_empty_latest_hint).toBeDefined();
    expect(base.subscriptions_empty_manage_hint).toBeDefined();
  });

  it("never points an empty subscriptions state at an import", () => {
    expect(base.subscriptions_empty_latest_hint).not.toMatch(/import/i);
    expect(base.subscriptions_empty_manage_hint).not.toMatch(/import/i);
  });
});
