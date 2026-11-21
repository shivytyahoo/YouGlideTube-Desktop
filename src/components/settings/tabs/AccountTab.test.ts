import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountTab } from "./AccountTab";
import type { AccountSummary } from "../../../lib/api/account";
import type { GoogleAccountInfo } from "../../../lib/useGoogleAccount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockUseGoogleAccount } = vi.hoisted(() => ({ mockUseGoogleAccount: vi.fn() }));

vi.mock("../../../lib/useGoogleAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/useGoogleAccount")>();
  return { ...actual, useGoogleAccount: mockUseGoogleAccount };
});

let host: HTMLDivElement;
let root: Root;

function renderTab() {
  act(() => {
    root.render(createElement(AccountTab));
  });
  return host;
}

function accountState(
  status: "signed-out" | "signing-in" | "signed-in",
  account: GoogleAccountInfo | null,
  accounts: AccountSummary[] = [],
) {
  return {
    status,
    account,
    accounts,
    error: null,
    startSignIn: vi.fn(),
    startAddAccount: vi.fn(),
    switchAccount: vi.fn(),
    removeAccount: vi.fn(),
    signOut: vi.fn(),
    signInWithCookie: vi.fn(),
    refreshAccount: vi.fn(),
    refreshAccounts: vi.fn(),
  };
}

describe("AccountTab", () => {
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

  it("shows the signed-out state with Android's wording", () => {
    mockUseGoogleAccount.mockReturnValue(accountState("signed-out", null));
    const el = renderTab();
    expect(el.textContent).toContain("Google account");
    expect(el.textContent).toContain("Not signed in");
    expect(el.textContent).toContain("Sign in with Google");
    expect(el.textContent).toContain("Personal feed, subscriptions and history");
    expect(el.textContent).toContain(
      "Your sign-in cookie stays on this device, is never backed up, and is only sent to YouTube.",
    );
    expect(el.textContent).not.toContain("Sign out");
  });

  it("shows the signed-in account with its handle and the sign-out row", () => {
    mockUseGoogleAccount.mockReturnValue(
      accountState("signed-in", { name: "Shivam", email: "shivam@example.com", channelHandle: "@shivyt" }),
    );
    const el = renderTab();
    expect(el.textContent).toContain("Signed in");
    expect(el.textContent).toContain("Shivam");
    expect(el.textContent).toContain("@shivyt");
    expect(el.textContent).toContain("Add account");
    expect(el.textContent).toContain("Sign out");
    expect(el.textContent).toContain("Go back to browsing anonymously");
    expect(el.textContent).toContain(
      "Your home feed and recommendations now use your Google account.",
    );
  });

  it("falls back to the email when the account has no name or handle", () => {
    mockUseGoogleAccount.mockReturnValue(
      accountState("signed-in", { email: "shivam@example.com" }),
    );
    const el = renderTab();
    expect(el.textContent).toContain("shivam@example.com");
  });

  it("signs out immediately from the Sign out row, with no confirmation", () => {
    const signOut = vi.fn();
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam" }),
      signOut,
    });
    const el = renderTab();
    const row = [...el.querySelectorAll("button, [role='button']")].find((node) =>
      node.textContent?.includes("Sign out"),
    );
    expect(row).toBeDefined();
    act(() => {
      (row as HTMLElement).click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("lists every saved account with the active one marked, and switches on tap", () => {
    const switchAccount = vi.fn().mockResolvedValue(true);
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
      switchAccount,
    });
    const el = renderTab();
    expect(el.textContent).toContain("Second");
    expect(el.textContent).toContain("@second");
    // The active account carries the check; the other row switches on tap.
    expect(el.querySelectorAll("[aria-label='Signed in']").length).toBeGreaterThan(0);
    const row = [...el.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Second"),
    );
    expect(row).toBeDefined();
    act(() => {
      (row as HTMLElement).click();
    });
    expect(switchAccount).toHaveBeenCalledWith("a2");
  });

  it("removes a non-active account from its row", () => {
    const removeAccount = vi.fn().mockResolvedValue(true);
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
      removeAccount,
    });
    const el = renderTab();
    const remove = el.querySelector("button[aria-label='Remove account']");
    expect(remove).toBeDefined();
    act(() => {
      (remove as HTMLElement).click();
    });
    expect(removeAccount).toHaveBeenCalledWith("a2");
    // The active row has the check instead of a remove button.
    expect(el.querySelectorAll("button[aria-label='Remove account']")).toHaveLength(1);
  });

  it("says sign-out switches to the next account when several are saved", () => {
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue(
      accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
    );
    const el = renderTab();
    expect(el.textContent).toContain("switch to the next saved account");
    expect(el.textContent).not.toContain("Go back to browsing anonymously");
  });
});
