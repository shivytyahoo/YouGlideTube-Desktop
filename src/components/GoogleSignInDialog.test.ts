import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleSignInDialog } from "./GoogleSignInDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderDialog(onClose: () => void) {
  act(() => {
    root.render(createElement(GoogleSignInDialog, { onClose }));
  });
  return host;
}

describe("GoogleSignInDialog", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows the mobile app's two sign-in options", () => {
    const el = renderDialog(() => undefined);
    expect(el.textContent).toContain("Sign in");
    expect(el.textContent).toContain("Option 1 — Sign in with Google (WebView)");
    expect(el.textContent).toContain("Sign in with Google");
    expect(el.textContent).toContain("Option 2 — Cookie sign-in (advanced)");
    expect(el.textContent).toContain("Sign in with cookie");
    expect(el.querySelector("textarea")?.placeholder).toBe("SAPISID=...; LOGIN_INFO=...");
    expect(el.textContent).toContain("Your sign-in cookie stays on this device, is never backed up, and is only sent to YouTube.");
  });

  it("closes from the Close button", () => {
    const onClose = vi.fn();
    const el = renderDialog(onClose);
    const close = [...el.querySelectorAll("button")].find((button) => button.textContent === "Close");
    expect(close).toBeDefined();
    act(() => {
      close?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
