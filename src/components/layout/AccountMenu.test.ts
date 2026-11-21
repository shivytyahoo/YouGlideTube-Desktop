import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./AccountMenu";
import type { AccountSummary } from "../../lib/api/account";
import type { GoogleAccountInfo } from "../../lib/useGoogleAccount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockUseGoogleAccount } = vi.hoisted(() => ({ mockUseGoogleAccount: vi.fn() }));

vi.mock("../../lib/useGoogleAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/useGoogleAccount")>();
  return { ...actual, useGoogleAccount: mockUseGoogleAccount };
});

let host: HTMLDivElement;
let root: Root;

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
    cancelSignIn: vi.fn(),
    switchAccount: vi.fn().mockResolvedValue(true),
    removeAccount: vi.fn(),
    signOut: vi.fn(),
    refreshAccount: vi.fn(),
    refreshAccounts: vi.fn(),
  };
}

function PathProbe() {
  const location = useLocation();
  return createElement("div", {
    "data-path": location.pathname,
    "data-state": JSON.stringify(location.state ?? null),
  });
}

function renderMenu(callbacks: { onClose?: () => void; onAddAccount?: () => void } = {}) {
  const onClose = callbacks.onClose ?? vi.fn();
  const onAddAccount = callbacks.onAddAccount ?? vi.fn();
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "*",
            element: createElement(
              "div",
              null,
              createElement(PathProbe),
              createElement(AccountMenu, {
                anchor: { top: 60, right: 200 },
                onClose,
                onAddAccount,
              }),
            ),
          }),
        ),
      ),
    );
  });
  return { onClose, onAddAccount };
}

describe("AccountMenu", () => {
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

  it("shows the current account's real name and handle, plus the switch list", () => {
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue(
      accountState("signed-in", { name: "Shivam", email: "a@example.com", channelHandle: "@shivyt" }, accounts),
    );
    renderMenu();
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("Shivam");
    expect(menu).toContain("@shivyt");
    expect(menu).toContain("Switch account");
    expect(menu).toContain("Second");
    expect(menu).toContain("@second");
    expect(menu).toContain("Add account");
    expect(menu).toContain("Google account settings");
    expect(menu).toContain("Sign out");
  });

  it("switches to a tapped account and closes the menu", async () => {
    const switchAccount = vi.fn().mockResolvedValue(true);
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
      switchAccount,
    });
    const { onClose } = renderMenu();
    const row = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Second"),
    );
    expect(row).toBeDefined();
    await act(async () => {
      (row as HTMLElement).click();
    });
    expect(switchAccount).toHaveBeenCalledWith("a2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu open when a switch fails, so the user can retry", async () => {
    const switchAccount = vi.fn().mockResolvedValue(false);
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
      switchAccount,
    });
    const { onClose } = renderMenu();
    const row = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Second"),
    );
    await act(async () => {
      (row as HTMLElement).click();
    });
    expect(switchAccount).toHaveBeenCalledWith("a2");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the hook error in the menu when a switch fails", async () => {
    const switchAccount = vi.fn().mockResolvedValue(false);
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      { id: "a2", name: "Second", email: "b@example.com", channelHandle: "@second", thumbnailUrl: null, isActive: false },
    ];
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
      error: "That account's session expired",
      switchAccount,
    });
    const { onClose } = renderMenu();
    const row = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Second"),
    );
    await act(async () => {
      (row as HTMLElement).click();
    });
    expect(switchAccount).toHaveBeenCalledWith("a2");
    expect(onClose).not.toHaveBeenCalled();
    // The menu is portaled to document.body, not the render host.
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "That account's session expired",
    );
  });

  it("asks the top bar to open Add account, and opens the Google account settings page", async () => {
    const accounts: AccountSummary[] = [
      { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
    ];
    mockUseGoogleAccount.mockReturnValue(
      accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, accounts),
    );
    const { onAddAccount } = renderMenu();
    const add = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Add account"),
    );
    expect(add).toBeDefined();
    await act(async () => {
      (add as HTMLElement).click();
    });
    expect(onAddAccount).toHaveBeenCalledTimes(1);

    const settings = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Google account settings"),
    );
    expect(settings).toBeDefined();
    await act(async () => {
      (settings as HTMLElement).click();
    });
    const probe = host.querySelector("[data-path]");
    expect(probe?.getAttribute("data-path")).toBe("/settings");
    expect(probe?.getAttribute("data-state")).toContain("account");
  });

  it("signs out from the menu", async () => {
    const signOut = vi.fn().mockResolvedValue(true);
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, [
        { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      ]),
      signOut,
    });
    const { onClose } = renderMenu();
    const row = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Sign out"),
    );
    expect(row).toBeDefined();
    await act(async () => {
      (row as HTMLElement).click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu open and shows the error when sign-out fails", async () => {
    const signOut = vi.fn().mockResolvedValue(false);
    mockUseGoogleAccount.mockReturnValue({
      ...accountState("signed-in", { name: "Shivam", channelHandle: "@shivyt" }, [
        { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
      ]),
      error: "Could not sign out — try again",
      signOut,
    });
    const { onClose } = renderMenu();
    const row = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Sign out"),
    );
    await act(async () => {
      (row as HTMLElement).click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not sign out — try again",
    );
  });

  it("never shows a generic label as an account's name", () => {
    const accounts: AccountSummary[] = [
      { id: "abcdef1234567890", name: null, email: null, channelHandle: null, thumbnailUrl: null, isActive: true },
    ];
    mockUseGoogleAccount.mockReturnValue(accountState("signed-in", null, accounts));
    renderMenu();
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("Account abcdef12");
  });
});
