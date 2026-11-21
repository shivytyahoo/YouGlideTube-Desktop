import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const lookups = vi.hoisted(() => ({ answers: [] as Array<() => Promise<string | null>> }));
const prefs = vi.hoisted(() => ({ batterySaver: false }));
vi.mock("./animatedArtwork", () => ({
  artworkLoopFor: () => (lookups.answers.shift() ?? (() => Promise.resolve(null)))(),
  forgetArtworkLoop: () => {},
}));
vi.mock("./api/images", () => ({ proxyArtworkLoop: async (url: string) => `proxied:${url}` }));
// Key-aware: the artwork switch is on; battery saver follows the test's flag.
vi.mock("./usePreference", () => ({
  useBoolPref: (key: string) => [
    key === "animated_artwork" || (key === "battery_saver_enabled" && prefs.batterySaver),
    () => {},
  ],
}));

const { useAnimatedArtwork } = await import("./useAnimatedArtwork");
import type { SongItem } from "../types/music";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = { id: "s", videoId: "s", title: "Yellow", artists: [{ name: "Coldplay", id: null }] } as unknown as SongItem;
let shown: string | null = null;
function Probe() {
  shown = useAnimatedArtwork(song).loopUrl;
  return null;
}

describe("animated cover lookups", () => {
  afterEach(() => {
    vi.useRealTimers();
    prefs.batterySaver = false;
  });

  it("asks again 20 s and 60 s after a failure while the song stays on screen", async () => {
    vi.useFakeTimers();
    const busy = () => Promise.reject(new Error("Artwork service answered 503"));
    lookups.answers = [busy, busy, () => Promise.resolve("loop")];
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(shown).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(shown).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(40_000)));
    expect(shown).toBe("proxied:loop");
    await act(async () => root.unmount());
  });

  it("asks for nothing while battery saver is on", async () => {
    prefs.batterySaver = true;
    vi.useFakeTimers();
    lookups.answers = [() => Promise.resolve("loop")];
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(shown).toBeNull();
    expect(lookups.answers).toHaveLength(1);
    await act(async () => root.unmount());
  });
});
