import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountTab } from "./AccountTab";
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
) {
  return {
    status,
    account,
    error: null,
    startSignIn: vi.fn(),
    signOut: vi.fn(),
    signInWithCookie: vi.fn(),
    refreshAccount: vi.fn(),
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
});
