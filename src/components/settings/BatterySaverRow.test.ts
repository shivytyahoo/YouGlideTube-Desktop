import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatterySaverRow } from "./BatterySaverRow";
import { LaunchIntro } from "../LaunchIntro";
import { applyBatterySaverClass, BATTERY_SAVER_CLASS } from "../../lib/batterySaver";
import { hoverPreviewMode } from "../../lib/hoverPreviewMode";
import { SETTINGS } from "../../lib/settings/schema";
import { getSettingDefinition } from "../../lib/settings/values";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

vi.mock("../../lib/api/db", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/useTheme", () => ({ useTheme: () => ({ variant: "dark" as const }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const renderRow = () => {
  act(() => {
    root.render(createElement(BatterySaverRow));
  });
};

const switchEl = (): HTMLButtonElement => {
  const el = host.querySelector('[role="switch"]');
  if (!el) throw new Error("no battery saver switch");
  return el as HTMLButtonElement;
};

describe("battery saver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // The store is a singleton: put the setting back to its default between tests.
    useAppSettingsStore.setState((state) => ({
      values: { ...state.values, [SETTINGS.BATTERY_SAVER]: "false" },
    }));
    document.documentElement.classList.remove(BATTERY_SAVER_CLASS);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.documentElement.classList.remove(BATTERY_SAVER_CLASS);
  });

  it("is off by default, as on Android", () => {
    expect(getSettingDefinition(SETTINGS.BATTERY_SAVER).defaultValue).toBe("false");
    expect(SETTINGS.BATTERY_SAVER).toBe("battery_saver_enabled");
  });

  it("shows the row first, with Android's title and subtitle", () => {
    renderRow();
    expect(host.textContent).toContain("Battery saver");
    expect(host.textContent).toContain("Animations, glass and previews off — the fastest, lightest app");
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });

  it("flips the stored setting when toggled", async () => {
    renderRow();
    await act(async () => {
      switchEl().click();
    });
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(useAppSettingsStore.getState().values[SETTINGS.BATTERY_SAVER]).toBe("true");
  });

  it("skips the launch intro when on", () => {
    const onDone = vi.fn();
    act(() => {
      root.render(createElement(LaunchIntro, { onDone, batterySaver: true }));
    });
    expect(host.querySelector('[data-testid="launch-intro"]')).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });

  it("forces the glass surfaces solid when on", () => {
    // The switch: the `battery-saver` class on <html>. The rule itself lives
    // in App.css (`html.battery-saver .glass`, solid surface, no backdrop
    // filter) — this test runner stubs CSS imports to '', so the rule is
    // verified by reading App.css, not from inside this test.
    applyBatterySaverClass(true);
    expect(document.documentElement.classList.contains(BATTERY_SAVER_CLASS)).toBe(true);
    applyBatterySaverClass(true);
    expect(document.documentElement.classList.contains(BATTERY_SAVER_CLASS)).toBe(true);
    applyBatterySaverClass(false);
    expect(document.documentElement.classList.contains(BATTERY_SAVER_CLASS)).toBe(false);
  });

  it("turns card hover previews off, as on Android", () => {
    expect(
      hoverPreviewMode({
        [SETTINGS.BATTERY_SAVER]: "true",
        [SETTINGS.VIDEO_HOVER_PREVIEW_MODE]: "video",
      }),
    ).toBe("off");
    expect(
      hoverPreviewMode({
        [SETTINGS.BATTERY_SAVER]: "false",
        [SETTINGS.VIDEO_HOVER_PREVIEW_MODE]: "video",
      }),
    ).toBe("video");
  });
});
