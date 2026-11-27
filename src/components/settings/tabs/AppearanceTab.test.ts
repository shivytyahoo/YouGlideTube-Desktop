import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceTab } from "./AppearanceTab";
import { SETTINGS } from "../../../lib/settings/schema";
import { getString } from "../../../lib/i18n/index";
import { useAppSettingsStore } from "../../../store/useAppSettingsStore";

vi.mock("../../../lib/api/db", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const renderTab = () => {
  act(() => {
    root.render(createElement(AppearanceTab));
  });
};

const buttonNamed = (text: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);

describe("AppearanceTab system theme mode", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // The store is a singleton: put the theme settings back to defaults between tests.
    useAppSettingsStore.setState((state) => ({
      values: {
        ...state.values,
        [SETTINGS.THEME_FOLLOW_SYSTEM]: "false",
        [SETTINGS.THEME_VARIANT]: "dark",
      },
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("is off by default, as the desktop default stays", () => {
    expect(useAppSettingsStore.getState().values[SETTINGS.THEME_FOLLOW_SYSTEM]).toBe("false");
  });

  it("offers System next to the palettes, and picking it follows the OS", async () => {
    renderTab();
    const systemButton = buttonNamed(getString("theme_variant_system"));
    expect(systemButton).toBeDefined();

    await act(async () => {
      systemButton!.click();
    });

    expect(useAppSettingsStore.getState().values[SETTINGS.THEME_FOLLOW_SYSTEM]).toBe("true");
    // The light/dark theme pickers appear once following is on.
    expect(host.textContent).toContain(getString("settings_theme_light_mode"));
    expect(host.textContent).toContain(getString("settings_theme_dark_mode"));
  });

  it("picking a palette turns following the OS back off", async () => {
    useAppSettingsStore.setState((state) => ({
      values: { ...state.values, [SETTINGS.THEME_FOLLOW_SYSTEM]: "true" },
    }));
    renderTab();

    await act(async () => {
      buttonNamed(getString("theme_variant_dark"))!.click();
    });

    expect(useAppSettingsStore.getState().values[SETTINGS.THEME_FOLLOW_SYSTEM]).toBe("false");
    expect(useAppSettingsStore.getState().values[SETTINGS.THEME_VARIANT]).toBe("dark");
  });
});

describe("AppearanceTab card feedback row", () => {
  const feedbackSwitch = () =>
    host.querySelector(
      `[data-setting-title="${getString("settings_card_feedback_row")}"] button[role="switch"]`,
    );

  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // The store is a singleton: put the feedback setting back to its default between tests.
    useAppSettingsStore.setState((state) => ({
      values: { ...state.values, [SETTINGS.CARD_FEEDBACK_ROW]: "false" },
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("is off by default", () => {
    expect(useAppSettingsStore.getState().values[SETTINGS.CARD_FEEDBACK_ROW]).toBe("false");
    renderTab();
    expect(feedbackSwitch()?.getAttribute("aria-checked")).toBe("false");
  });

  it("turning it on persists the setting", async () => {
    renderTab();
    await act(async () => {
      feedbackSwitch()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useAppSettingsStore.getState().values[SETTINGS.CARD_FEEDBACK_ROW]).toBe("true");
  });
});
