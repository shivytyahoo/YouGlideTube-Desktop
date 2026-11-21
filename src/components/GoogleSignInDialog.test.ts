import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleSignInDialog } from "./GoogleSignInDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockUseGoogleAccount } = vi.hoisted(() => ({ mockUseGoogleAccount: vi.fn() }));

vi.mock("../lib/useGoogleAccount", () => ({ useGoogleAccount: mockUseGoogleAccount }));

let host: HTMLDivElement;
let root: Root;

function accountState(overrides: Record<string, unknown> = {}) {
  return {
    status: "signed-out",
    error: null,
    startSignIn: vi.fn(),
    startAddAccount: vi.fn(),
    cancelSignIn: vi.fn(),
    ...overrides,
  };
}

// The dialog portals into document.body, so its content lives outside the
// render host; query the body instead.
function renderDialog(onClose: () => void) {
  act(() => {
    root.render(createElement(GoogleSignInDialog, { onClose }));
  });
  return document.body;
}

function closeButton(el: HTMLElement) {
  return [...el.querySelectorAll("button")].find((button) => button.textContent === "Close");
}

describe("GoogleSignInDialog", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mockUseGoogleAccount.mockReturnValue(accountState());
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows only the WebView sign-in option, no cookie sign-in", () => {
    const el = renderDialog(() => undefined);
    expect(el.textContent).toContain("Sign in");
    expect(el.textContent).toContain("Sign in with Google (WebView)");
    expect(el.textContent).toContain("Sign in with Google");
    expect(el.textContent).not.toContain("Sign in with cookie");
    expect(el.textContent).not.toContain("Cookie sign-in");
    expect(el.querySelector("textarea")).toBeNull();
    expect(el.textContent).toContain("Your sign-in cookie stays on this device, is never backed up, and is only sent to YouTube.");
  });

  it("closes from the Close button", () => {
    const onClose = vi.fn();
    const el = renderDialog(onClose);
    const close = closeButton(el);
    expect(close).toBeDefined();
    act(() => {
      close?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the login window when closed from the Close button while signing in", () => {
    const cancelSignIn = vi.fn();
    const onClose = vi.fn();
    mockUseGoogleAccount.mockReturnValue(accountState({ status: "signing-in", cancelSignIn }));
    const el = renderDialog(onClose);
    const close = closeButton(el);
    act(() => {
      close?.click();
    });
    expect(cancelSignIn).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the login window on Escape while signing in", () => {
    const cancelSignIn = vi.fn();
    const onClose = vi.fn();
    mockUseGoogleAccount.mockReturnValue(accountState({ status: "signing-in", cancelSignIn }));
    renderDialog(onClose);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(cancelSignIn).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels the login window when the backdrop is clicked while signing in", () => {
    const cancelSignIn = vi.fn();
    const onClose = vi.fn();
    mockUseGoogleAccount.mockReturnValue(accountState({ status: "signing-in", cancelSignIn }));
    renderDialog(onClose);
    const backdrop = document.body.querySelector('[role="presentation"]') as HTMLElement | null;
    expect(backdrop).toBeDefined();
    act(() => {
      backdrop?.click();
    });
    expect(cancelSignIn).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not cancel anything when closed without a sign-in in progress", () => {
    const cancelSignIn = vi.fn();
    const onClose = vi.fn();
    mockUseGoogleAccount.mockReturnValue(accountState({ cancelSignIn }));
    const el = renderDialog(onClose);
    const close = closeButton(el);
    act(() => {
      close?.click();
    });
    expect(cancelSignIn).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
