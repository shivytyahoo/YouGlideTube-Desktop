import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchIntro, LAUNCH_INTRO_FADE_START_MS, LAUNCH_INTRO_TOTAL_MS } from "./LaunchIntro";

vi.mock("../lib/useTheme", () => ({ useTheme: () => ({ variant: "dark" as const }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderIntro(props: { batterySaver?: boolean } = {}) {
  const onDone = vi.fn();
  act(() => {
    root.render(createElement(LaunchIntro, { onDone, batterySaver: props.batterySaver }));
  });
  return { onDone };
}

function overlay(): HTMLElement {
  const el = host.querySelector('[data-testid="launch-intro"]');
  if (!el) throw new Error("no launch intro overlay");
  return el as HTMLElement;
}

describe("LaunchIntro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the badge, the wordmark letter by letter and the tagline on the dark splash", () => {
    renderIntro();
    expect(host.querySelector('img[alt="YouGlideTube"]')).not.toBeNull();
    expect(host.textContent).toContain("YouGlideTube");
    expect(host.textContent).toContain("Buttery smooth. Truly yours.");
    // Android dark splash: background #0F0F0F (jsdom serialises it as rgb).
    expect(overlay().style.background).toBe("rgb(15, 15, 15)");
    // One span per letter, each with its own staggered delay.
    const letters = overlay().querySelectorAll("span");
    expect(letters.length).toBe("YouGlideTube".length);
    expect(letters[0]?.style.transition).toContain("140ms");
    expect(letters[letters.length - 1]?.style.transition).toContain("602ms");
  });

  it("fades out at 1330ms and reports done at 1670ms, not before", () => {
    const { onDone } = renderIntro();
    expect(overlay().style.opacity).toBe("1");
    act(() => {
      vi.advanceTimersByTime(LAUNCH_INTRO_FADE_START_MS - 1);
    });
    expect(overlay().style.opacity).toBe("1");
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(overlay().style.opacity).toBe("0");
    act(() => {
      vi.advanceTimersByTime(LAUNCH_INTRO_TOTAL_MS - LAUNCH_INTRO_FADE_START_MS - 1);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when battery saver is on, and reports done at once", () => {
    const { onDone } = renderIntro({ batterySaver: true });
    expect(host.querySelector('[data-testid="launch-intro"]')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the user prefers reduced motion, and reports done at once", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { onDone } = renderIntro();
    expect(host.querySelector('[data-testid="launch-intro"]')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
