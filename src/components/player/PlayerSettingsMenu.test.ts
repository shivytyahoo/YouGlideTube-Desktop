// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/audio/eq/useEqualizer", () => ({ useEqActive: () => false }));
vi.mock("../../lib/audio/mediaEqEngine", () => ({ videoEqAvailable: () => false }));

const { PlayerSettingsMenu } = await import("./PlayerSettingsMenu");
const { useAppSettingsStore } = await import("../../store/useAppSettingsStore");
const { SETTINGS } = await import("../../lib/settings/schema");
const { getString } = await import("../../lib/i18n/index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.AMBIENT_MODE_ENABLED]: "true" } }));
  host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(PlayerSettingsMenu, {
        open: true,
        pane: "root",
        onPaneChange: () => {},
        onClose: () => {},
        qualities: [],
        selectedQualityId: "auto",
        isDashPlayback: false,
        captions: [],
        selectedCaptionId: "off",
        setSelectedCaptionId: () => {},
        audioTracks: [],
        setSelectedAudioTrackId: () => {},
        speedOptions: [1],
        speedSliderEnabled: false,
        playbackRate: 1,
        onSelectPlaybackRate: () => {},
      }),
    ),
  );
});
afterEach(() => act(() => root.unmount()));

describe("player settings menu", () => {
  it("leaves autoplay and notes to the bar and the page", () => {
    const text = host.textContent ?? "";
    expect(text).not.toContain(getString("player_menu_autoplay"));
    expect(text).not.toContain("Note at");
  });

  it("holds the per-video loop and SponsorBlock-off switches", () => {
    const text = host.textContent ?? "";
    expect(text).toContain(getString("player_menu_loop"));
    expect(text).toContain(getString("player_sponsorblock_off_for_video"));
  });

  it("keeps its switches at the bottom, under the rows that open panes", () => {
    const rows = [...host.querySelector('[role="menu"]')!.querySelectorAll("button, [role='switch']")];
    const switches = rows.filter((row) => row.getAttribute("role") === "switch");
    expect(switches).toHaveLength(4);
    expect(rows.slice(-4)).toEqual(switches);
  });

  it("shows the playback method under Quality on the root pane", () => {
    const menu = host.querySelector('[role="menu"]')!;
    const rows = [...menu.querySelectorAll("button")];
    const qualityIndex = rows.findIndex((row) => row.textContent?.includes(getString("player_menu_quality")));
    const methodIndex = rows.findIndex((row) => row.textContent?.includes(getString("player_menu_playback_method")));
    expect(methodIndex).toBeGreaterThan(qualityIndex);
    expect(rows[methodIndex]?.textContent).toContain(getString("settings_playback_method_auto"));
  });

  it("lists the video's methods and reports the pick", () => {
    const onSelectSourceMode = vi.fn();
    act(() =>
      root.render(
        createElement(PlayerSettingsMenu, {
          open: true,
          pane: "method",
          onPaneChange: () => {},
          onClose: () => {},
          qualities: [],
          selectedQualityId: "auto",
          isDashPlayback: false,
          availableSourceModes: ["dash-native", "sabr-dash", "hls", "direct"],
          playbackMethod: "dash",
          onSelectSourceMode,
          captions: [],
          selectedCaptionId: "off",
          setSelectedCaptionId: () => {},
          audioTracks: [],
          setSelectedAudioTrackId: () => {},
          speedOptions: [1],
          speedSliderEnabled: false,
          playbackRate: 1,
          onSelectPlaybackRate: () => {},
        }),
      ),
    );
    const text = host.textContent ?? "";
    for (const label of ["Auto", "DASH", "SABR", "HLS", "Direct"]) expect(text).toContain(label);
    const sabr = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "SABR");
    act(() => sabr?.click());
    expect(onSelectSourceMode).toHaveBeenCalledWith("sabr");
  });
});
