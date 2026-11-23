import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Topbar } from "./Topbar";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import type { AccountSummary } from "../../lib/api/account";
import type { GoogleAccountInfo } from "../../lib/useGoogleAccount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockUseGoogleAccount } = vi.hoisted(() => ({ mockUseGoogleAccount: vi.fn() }));

vi.mock("../../lib/useGoogleAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/useGoogleAccount")>();
  return { ...actual, useGoogleAccount: mockUseGoogleAccount };
});

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

let host: HTMLDivElement;
let root: Root;

function barAt(path: string, flags: { spread: boolean; below: boolean }) {
  usePlayerStore.setState({ isAmbientSpreadShown: flags.spread, isPlayerBelowTopbar: flags.below });
  act(() => {
    root.render(createElement(MemoryRouter, { key: path, initialEntries: [path] }, createElement(Topbar)));
  });
  const header = host.querySelector("header");
  if (!header) throw new Error("no top bar");
  return header.className;
}

describe("Topbar", () => {
  beforeEach(() => {
    // A wide window: the side rail shows, so only Watch and Settings use the drawer.
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    mockUseGoogleAccount.mockReturnValue(accountState("signed-out", null));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    usePlayerStore.setState({ isAmbientSpreadShown: false, isPlayerBelowTopbar: false });
    useUiStore.setState({ pageRefreshNonce: 0 });
  });

  it("lets the glow through while the player sits below it", () => {
    expect(barAt("/watch/abc", { spread: true, below: true })).toContain("bg-transparent");
  });

  it("turns solid at once when the video reaches it", () => {
    const className = barAt("/watch/abc", { spread: true, below: false });
    expect(className).toContain("glass");
    expect(className).not.toContain("transition-colors");
  });

  it("stays solid without the spread glow or off the watch page", () => {
    expect(barAt("/watch/abc", { spread: false, below: true })).toContain("glass");
    expect(barAt("/feed", { spread: true, below: true })).toContain("glass");
  });

  it("opens the account menu when the avatar is clicked", () => {
    mockUseGoogleAccount.mockReturnValue(
      accountState(
        "signed-in",
        { name: "Shivam", email: "a@example.com", channelHandle: "@shivyt" },
        [
          { id: "a1", name: "Shivam", email: "a@example.com", channelHandle: "@shivyt", thumbnailUrl: null, isActive: true },
        ],
      ),
    );
    barAt("/feed", { spread: false, below: false });
    // The notifications bell also has aria-haspopup="menu", so find the
    // avatar by its account-name label.
    const avatar = host.querySelector("button[aria-label='Shivam']");
    expect(avatar).toBeDefined();
    act(() => {
      (avatar as HTMLElement).click();
    });
    // The menu is a portal on document.body: account info, switch list,
    // Add account, settings, and sign out.
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("Shivam");
    expect(menu).toContain("Switch account");
    expect(menu).toContain("Add account");
    expect(menu).toContain("Google account settings");
    expect(menu).toContain("Sign out");
  });

  it("shows a plain user icon, not a placeholder initial, while the name is unknown", () => {
    mockUseGoogleAccount.mockReturnValue(accountState("signed-in", null, []));
    barAt("/feed", { spread: false, below: false });
    const avatar = host.querySelector("button[aria-haspopup='menu'][aria-label='Signed in']");
    expect(avatar).toBeDefined();
    expect(avatar?.textContent).not.toContain("Y");
  });

  it("reloads the current page from the refresh button", () => {
    useUiStore.setState({ pageRefreshNonce: 0 });
    barAt("/feed", { spread: false, below: false });
    const refresh = host.querySelector("button[aria-label='Refresh']");
    expect(refresh).toBeDefined();
    act(() => {
      (refresh as HTMLElement).click();
    });
    expect(useUiStore.getState().pageRefreshNonce).toBe(1);
    expect(refresh?.querySelector("svg")?.getAttribute("class") ?? "").toContain("animate-spin");
  });

  it("ignores a second refresh pressed within the guard window", () => {
    vi.useFakeTimers();
    try {
      useUiStore.setState({ pageRefreshNonce: 0 });
      // Move past any refresh the previous test triggered.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const requestPageRefresh = useUiStore.getState().requestPageRefresh;
      requestPageRefresh();
      requestPageRefresh();
      expect(useUiStore.getState().pageRefreshNonce).toBe(1);
      act(() => {
        vi.advanceTimersByTime(800);
      });
      requestPageRefresh();
      expect(useUiStore.getState().pageRefreshNonce).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
