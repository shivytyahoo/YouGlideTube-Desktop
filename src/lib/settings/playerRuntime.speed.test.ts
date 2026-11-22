import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAYBACK_RATES,
  DEFAULT_SLIDER_SPEED_PRESETS,
  parseCustomSpeedPresets,
  playbackSpeedSliderPresets,
} from "./playerRuntime";

describe("DEFAULT_PLAYBACK_RATES", () => {
  it("runs to 4x, as Android's picker does", () => {
    expect(DEFAULT_PLAYBACK_RATES).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]);
  });
});

describe("parseCustomSpeedPresets", () => {
  it("keeps custom speeds above 2x, clamped to 4x", () => {
    expect(parseCustomSpeedPresets("0.5, 2.5, 3, 10", true)).toEqual([0.5, 2.5, 3, 4]);
  });

  it("falls back to the defaults when custom speeds are off or empty", () => {
    expect(parseCustomSpeedPresets("2.5, 3", false)).toEqual(DEFAULT_PLAYBACK_RATES);
    expect(parseCustomSpeedPresets("", true)).toEqual(DEFAULT_PLAYBACK_RATES);
  });
});

describe("playbackSpeedSliderPresets", () => {
  it("offers Android's fixed chips when custom speeds are off", () => {
    expect(playbackSpeedSliderPresets("", false)).toEqual(DEFAULT_SLIDER_SPEED_PRESETS);
    expect(DEFAULT_SLIDER_SPEED_PRESETS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it("offers the custom presets up to 4x when they are on", () => {
    expect(playbackSpeedSliderPresets("0.5, 1.5, 2.5, 4, 8", true)).toEqual([0.5, 1.5, 2.5, 4]);
  });

  it("falls back to the default list capped at 4x when the custom presets are unusable", () => {
    expect(playbackSpeedSliderPresets("not-a-speed", true)).toEqual([
      0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4,
    ]);
  });
});
