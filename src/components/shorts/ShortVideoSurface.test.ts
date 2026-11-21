// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";

vi.mock("dashjs", () => ({ MediaPlayer: vi.fn() }));
vi.mock("../../lib/audio/useVideoEq", () => ({ useVideoEq: vi.fn() }));
vi.mock("../../lib/useSubtitleSettingsSync", () => ({ useSubtitleSettingsSync: vi.fn() }));

const { ShortVideoSurface } = await import("./ShortVideoSurface");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = {
  videoId: "s",
  dashUrl: null,
  videoUrl: "http://127.0.0.1/video",
  audioUrl: "http://127.0.0.1/english",
  audioTracks: [],
  selectedAudioTrackId: null,
  onSelectAudioTrack: () => {},
  onDoubleClickLike: () => {},
  qualities: [],
  captions: [],
  selectedQualityId: "auto",
  onSelectQuality: () => {},
  active: true,
  muted: false,
  volume: 1,
  playbackMode: "loop",
  autoScrollSeconds: 10,
} satisfies ComponentProps<typeof ShortVideoSurface>;

let host: HTMLElement;
let root: Root;
let paused: WeakMap<HTMLMediaElement, boolean>;
let mediaReadyState = 0;
const load = vi.fn();
const play = vi.fn();

const render = (extra: Partial<Record<"videoUrl" | "audioUrl" | "videoId", string>>) =>
  act(async () => root.render(createElement(ShortVideoSurface, { ...props, ...extra })));
const video = () => host.querySelector("video")!;
const audio = () => host.querySelector("audio")!;

beforeEach(() => {
  paused = new WeakMap();
  mediaReadyState = 0;
  load.mockReset();
  play.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    return Promise.resolve();
  });
  // A real browser resets the position when the source changes; jsdom does not.
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) {
    load.call(this);
    this.currentTime = 0;
  });
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => mediaReadyState);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
  });
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

async function startPlayingAt(seconds: number) {
  await render({});
  await act(async () => void video().dispatchEvent(new Event("canplay")));
  video().currentTime = seconds;
  load.mockClear();
  play.mockClear();
}

describe("changing the audio language of a Short", () => {
  it("swaps only the audio and keeps the position", async () => {
    await startPlayingAt(7);
    await render({ audioUrl: "http://127.0.0.1/spanish" });
    expect(audio().getAttribute("src")).toBe("http://127.0.0.1/spanish");
    expect(video().getAttribute("src")).toBe(props.videoUrl);
    expect(video().currentTime).toBe(7);
    expect(audio().currentTime).toBe(7);
    expect(load.mock.contexts).not.toContain(video());
    expect(play.mock.contexts).toContain(audio());
  });

  it("keeps a pause", async () => {
    await startPlayingAt(7);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" })));
    expect(video().paused).toBe(true);
    play.mockClear();
    await render({ audioUrl: "http://127.0.0.1/spanish" });
    expect(audio().currentTime).toBe(7);
    expect(play.mock.contexts).not.toContain(audio());
  });

  it("still loads both from the start when the video changes", async () => {
    await startPlayingAt(7);
    await render({ videoId: "other", videoUrl: "http://127.0.0.1/other", audioUrl: "http://127.0.0.1/spanish" });
    expect(video().getAttribute("src")).toBe("http://127.0.0.1/other");
    expect(audio().getAttribute("src")).toBe("http://127.0.0.1/spanish");
    expect(load.mock.contexts).toContain(video());
    // A new short never restores the previous one's position.
    mediaReadyState = 4;
    await act(async () => void video().dispatchEvent(new Event("loadedmetadata")));
    expect(video().currentTime).toBe(0);
  });
});

describe("changing the quality of a Short", () => {
  it("keeps the position instead of restarting from 0:00", async () => {
    await startPlayingAt(7);
    await render({ videoUrl: "http://127.0.0.1/hd" });
    expect(video().getAttribute("src")).toBe("http://127.0.0.1/hd");
    expect(video().currentTime).toBe(0);
    mediaReadyState = 4;
    await act(async () => void video().dispatchEvent(new Event("loadedmetadata")));
    expect(video().currentTime).toBe(7);
    await act(async () => void video().dispatchEvent(new Event("canplay")));
    expect(audio().currentTime).toBe(7);
  });

  it("keeps a pause across the change", async () => {
    await startPlayingAt(7);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" })));
    expect(video().paused).toBe(true);
    play.mockClear();
    await render({ videoUrl: "http://127.0.0.1/hd" });
    mediaReadyState = 4;
    await act(async () => void video().dispatchEvent(new Event("loadedmetadata")));
    await act(async () => void video().dispatchEvent(new Event("canplay")));
    expect(video().currentTime).toBe(7);
    expect(video().paused).toBe(true);
    expect(play.mock.contexts).not.toContain(video());
  });
});

describe("Shorts playback speed", () => {
  afterEach(() => {
    act(() => {
      useAppSettingsStore.setState((state) => ({
        values: { ...state.values, [SETTINGS.SHORTS_PLAYBACK_SPEED]: "1.0" },
      }));
      usePlayerStore.getState().setPlaybackRate(1);
    });
  });

  it("uses its own persisted speed and leaves the Watch page's speed alone", async () => {
    useAppSettingsStore.setState((state) => ({
      values: { ...state.values, [SETTINGS.SHORTS_PLAYBACK_SPEED]: "1.5" },
    }));
    usePlayerStore.getState().setPlaybackRate(2);

    await render({});
    await act(async () => void video().dispatchEvent(new Event("canplay")));
    expect(video().playbackRate).toBe(1.5);
    expect(usePlayerStore.getState().playbackRate).toBe(2);

    // Neither a quality change nor a new short resets it.
    await render({ videoUrl: "http://127.0.0.1/hd" });
    expect(video().playbackRate).toBe(1.5);
    await render({ videoId: "next", videoUrl: "http://127.0.0.1/next" });
    expect(video().playbackRate).toBe(1.5);
    expect(usePlayerStore.getState().playbackRate).toBe(2);
  });
});
