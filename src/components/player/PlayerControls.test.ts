// @vitest-environment jsdom
import { createElement, act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./PlayerSettingsMenu", () => ({ PlayerSettingsMenu: () => null, qualityLabel: () => "Auto" }));
vi.mock("../../lib/useWheelVolume", () => ({ useWheelVolume: () => () => {} }));
vi.mock("../../lib/streamResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/streamResolution")>()),
  prefetchStreamInfo: vi.fn(),
}));

const { PlayerControls, elapsedOrRemaining, controlsTierForWidth } = await import("./PlayerControls");
const { useAppSettingsStore } = await import("../../store/useAppSettingsStore");
const { usePlayerStore } = await import("../../store/usePlayerStore");
const { PLAYER_BUTTON_ROWS } = await import("../../lib/playerButtons");
const { getString } = await import("../../lib/i18n/index");
const { SETTINGS } = await import("../../lib/settings/schema");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
let root: Root;

const render = (fullscreen = false, extra: { title?: string; showFullscreenTitle?: boolean; isPopOut?: boolean } = {}) =>
  act(() =>
    root.render(
      createElement(PlayerControls, {
        ...extra,
        containerRef: createRef<HTMLDivElement>(),
        controlsVisible: true,
        setControlsVisible: () => {},
        shouldShowControls: true,
        selectedCaptionId: "off",
        setSelectedCaptionId: () => {},
        setSelectedAudioTrackId: () => {},
        bufferedPct: 0,
        muted: false,
        setMuted: () => {},
        isFullscreen: fullscreen,
        toggleFullscreen: () => {},
        isPip: false,
        togglePictureInPicture: () => {},
        seekTo: () => {},
        togglePlay: () => {},
        stepFrame: () => {},
        settingsOpen: false,
        setSettingsOpen: () => {},
        isScrubbing: false,
        setIsScrubbing: () => {},
      }),
    ),
  );
const hasButton = (title: string) => !!host.querySelector(`button[title="${title}"]`);
const setButton = (id: string, shown: boolean) => {
  const row = PLAYER_BUTTON_ROWS.find((candidate) => candidate.id === id)!;
  useAppSettingsStore.setState((s) => ({ values: { ...s.values, [row.setting]: String(shown) } }));
};

const video = { id: "first", title: "First", channelName: "A channel" };

beforeEach(() => {
  useAppSettingsStore.setState((s) => ({
    values: { ...s.values, ...Object.fromEntries(PLAYER_BUTTON_ROWS.map((row) => [row.setting, "true"])) },
  }));
  usePlayerStore.setState({ isCommentsAvailable: true, queue: [video, { ...video, id: "second" }], playlistContext: null });
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe("player bar buttons", () => {
  it.each([
    ["nextPrevious", "next"],
    ["queue", "queue_title"],
    ["quality", "player_menu_quality"],
    ["captions", "player_menu_captions"],
    ["theater", "player_theater_mode"],
    ["fullscreen", "player_fullscreen"],
  ] as const)("hides %s when switched off", (id, titleKey) => {
    render();
    expect(hasButton(getString(titleKey))).toBe(true);
    act(() => setButton(id, false));
    render();
    expect(hasButton(getString(titleKey))).toBe(false);
  });

  it("hides the fullscreen comments button", () => {
    render(true);
    expect(hasButton(getString("watch_comments"))).toBe(true);
    act(() => {
      setButton("comments", false);
    });
    render(true);
    expect(hasButton(getString("watch_comments"))).toBe(false);
  });

  it("always keeps Settings", () => {
    act(() => PLAYER_BUTTON_ROWS.forEach((row) => setButton(row.id, false)));
    render();
    expect(hasButton(getString("player_menu_settings"))).toBe(true);
  });
});

describe("small controls", () => {
  const frameStep = (on: boolean) =>
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, frame_step_buttons_enabled: String(on) } }));

  it("shows frame buttons only while paused with the setting on, as the bar had none by default", () => {
    usePlayerStore.setState({ isPlaying: false });
    frameStep(false);
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(false);
    act(() => frameStep(true));
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(true);
    expect(hasButton(getString("player_previous_frame"))).toBe(true);
    act(() => usePlayerStore.setState({ isPlaying: true }));
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(false);
    act(() => frameStep(false));
  });

  it("leaves the idle strip out while the controls show", () => {
    render();
    expect(host.querySelector(".h-\\[3px\\]")).toBeNull();
  });

  it("reads the time pill as elapsed or what is left", () => {
    expect(elapsedOrRemaining(65, 300, false)).toBe("1:05");
    expect(elapsedOrRemaining(65, 300, true)).toBe("-3:55");
    expect(elapsedOrRemaining(400, 300, true)).toBe("-0:00");
    expect(elapsedOrRemaining(65, 0, true)).toBe("1:05");
  });
});

describe("queue button", () => {
  const queueButton = () => hasButton(getString("queue_title"));

  it("is hidden for a single video with nothing queued", () => {
    usePlayerStore.setState({ queue: [video], playlistContext: null });
    render();
    expect(queueButton()).toBe(false);
  });

  it("shows once there is a queue", () => {
    render();
    expect(queueButton()).toBe(true);
  });

  it("shows for a playlist, however short", () => {
    usePlayerStore.setState({ queue: [video], playlistContext: { id: "list", title: "A list" } as never });
    render();
    expect(queueButton()).toBe(true);
  });
});

describe("next button", () => {
  it("advances to a related video when the queue holds only the current one", () => {
    // A video opened from a feed or search has a one-item queue; Next must fall
    // back to the related videos, as on Android, instead of doing nothing.
    const candidate = { id: "next-one", title: "Next", channelName: "Another channel" };
    act(() => {
      usePlayerStore.setState({ queue: [video], currentIndex: 0, currentVideo: video, isPlaying: true });
      usePlayerStore.getState().setAutoplayCandidates([candidate]);
    });
    render();
    const nextButton = host.querySelector<HTMLButtonElement>(`button[title="${getString("next")}"]`);
    expect(nextButton).not.toBeNull();
    act(() => nextButton!.click());
    expect(usePlayerStore.getState().currentVideo?.id).toBe("next-one");
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it("still advances within a queue", () => {
    act(() => {
      usePlayerStore.setState({ queue: [video, { ...video, id: "second" }], currentIndex: 0, currentVideo: video, isPlaying: true });
    });
    render();
    const nextButton = host.querySelector<HTMLButtonElement>(`button[title="${getString("next")}"]`);
    act(() => nextButton!.click());
    expect(usePlayerStore.getState().currentVideo?.id).toBe("second");
  });
});

describe("autoplay switch", () => {
  const autoplay = () => host.querySelector<HTMLButtonElement>('button[role="switch"]');

  it("turns autoplay off and on from the bar", () => {
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.AUTOPLAY_ENABLED]: "true" } }));
    render();
    expect(autoplay()?.getAttribute("aria-checked")).toBe("true");
    act(() => autoplay()!.click());
    expect(useAppSettingsStore.getState().values[SETTINGS.AUTOPLAY_ENABLED]).toBe("false");
    expect(autoplay()?.getAttribute("aria-checked")).toBe("false");
  });

  it("can be taken off the bar", () => {
    setButton("autoplay", false);
    render();
    expect(autoplay()).toBeNull();
  });
});

describe("narrow player widths", () => {
  // jsdom lays nothing out, so the bar's width is faked: a ResizeObserver
  // stand-in plus a clientWidth getter the test drives.
  let mockGlassWidth = 0;
  let observerCallback: (() => void) | null = null;
  let clientWidthDescriptor: PropertyDescriptor | undefined;

  class MockResizeObserver {
    constructor(callback: () => void) {
      observerCallback = callback;
    }
    observe() {
      observerCallback?.();
    }
    unobserve() {}
    disconnect() {}
  }

  beforeEach(() => {
    mockGlassWidth = 0;
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => mockGlassWidth,
    });
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
    observerCallback = null;
  });

  const setGlassWidth = (width: number) => {
    mockGlassWidth = width;
    observerCallback?.();
  };

  it("maps panel widths to tiers", () => {
    expect(controlsTierForWidth(1200)).toBe(0);
    expect(controlsTierForWidth(960)).toBe(0);
    expect(controlsTierForWidth(959)).toBe(1);
    expect(controlsTierForWidth(690)).toBe(1);
    expect(controlsTierForWidth(689)).toBe(2);
  });

  it("sheds the least-used buttons on a narrow panel but keeps play, settings and fullscreen", () => {
    mockGlassWidth = 800;
    render();
    expect(hasButton(getString("sleep_timer"))).toBe(false);
    expect(hasButton(getString("player_menu_captions"))).toBe(false);
    expect(hasButton(getString("settings_button_speed_indicator"))).toBe(false);
    expect(hasButton(getString("player_picture_in_picture"))).toBe(false);
    expect(hasButton(getString("player_menu_quality"))).toBe(true);
    expect(hasButton(getString("player_theater_mode"))).toBe(true);
    expect(hasButton(getString("next"))).toBe(true);
    expect(hasButton(getString("player_menu_settings"))).toBe(true);
    expect(hasButton(getString("player_fullscreen"))).toBe(true);
    expect(host.querySelector('button[title="Play"], button[title="Pause"]')).not.toBeNull();
  });

  it("also drops quality, theater and prev/next on a very narrow panel, and brings them back when widened", () => {
    mockGlassWidth = 500;
    render();
    expect(hasButton(getString("player_menu_quality"))).toBe(false);
    expect(hasButton(getString("player_theater_mode"))).toBe(false);
    expect(hasButton(getString("next"))).toBe(false);
    expect(hasButton(getString("previous"))).toBe(false);
    expect(hasButton(getString("player_menu_settings"))).toBe(true);
    expect(hasButton(getString("player_fullscreen"))).toBe(true);
    act(() => setGlassWidth(1200));
    expect(hasButton(getString("player_menu_quality"))).toBe(true);
    expect(hasButton(getString("player_theater_mode"))).toBe(true);
    expect(hasButton(getString("next"))).toBe(true);
  });

  it("never lets the row's groups paint over each other", () => {
    render();
    const row = host.querySelector(".justify-between");
    expect(row?.className).toContain("overflow-hidden");
    // The time pill sits in the left group; that group clips instead of
    // sliding under the right-hand buttons when the row runs out of room.
    const leftGroup = row?.querySelector(":scope > div");
    expect(leftGroup?.className).toContain("overflow-hidden");
    expect(leftGroup?.className).toContain("min-w-0");
  });
});

describe("video title above the seek bar", () => {
  const titleShown = () => [...host.querySelectorAll("div")].some((el) => el.textContent === "A video title" && el.children.length === 0);

  it("stays off the windowed player, where the page already shows it", () => {
    render(false, { title: "A video title", showFullscreenTitle: true });
    expect(titleShown()).toBe(false);
  });

  it("shows in fullscreen with the switch on, and not with it off", () => {
    render(true, { title: "A video title", showFullscreenTitle: true });
    expect(titleShown()).toBe(true);
    render(true, { title: "A video title", showFullscreenTitle: false });
    expect(titleShown()).toBe(false);
  });

  it("stays in the pop-out window, which has no page under the video", () => {
    render(false, { title: "A video title", isPopOut: true });
    expect(titleShown()).toBe(true);
  });

  it("defaults the fullscreen switch to on", async () => {
    const { getSettingDefinition } = await import("../../lib/settings/values");
    expect(getSettingDefinition(SETTINGS.SHOW_FULLSCREEN_TITLE).defaultValue).toBe("true");
  });
});
