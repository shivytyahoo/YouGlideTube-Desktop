import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSystemDarkMode } from "./useSystemDarkMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  return createElement("div", null, useSystemDarkMode() ? "dark" : "light");
}

describe("useSystemDarkMode", () => {
  let host: HTMLDivElement;
  let root: Root;
  let matches = false;
  let listeners: Array<() => void> = [];
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    matches = false;
    listeners = [];
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      get matches() {
        return matches;
      },
      addEventListener: (_event: string, cb: () => void) => {
        listeners.push(cb);
      },
      removeEventListener: (_event: string, cb: () => void) => {
        listeners = listeners.filter((listener) => listener !== cb);
      },
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.matchMedia = originalMatchMedia!;
  });

  it("reads the OS preference at first paint", () => {
    act(() => {
      root.render(createElement(Probe));
    });
    expect(host.textContent).toBe("light");
  });

  it("flips live when the OS switches between light and dark", () => {
    act(() => {
      root.render(createElement(Probe));
    });
    expect(host.textContent).toBe("light");

    act(() => {
      matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(host.textContent).toBe("dark");

    act(() => {
      matches = false;
      listeners.forEach((listener) => listener());
    });
    expect(host.textContent).toBe("light");
  });

  it("stops listening on unmount", () => {
    act(() => {
      root.render(createElement(Probe));
    });
    expect(listeners.length).toBe(1);
    act(() => root.unmount());
    expect(listeners.length).toBe(0);
  });
});
