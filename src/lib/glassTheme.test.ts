import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLASS_THEME_CLASS,
  applyGlassThemeClass,
  setWindowGlassTheme,
  useGlassThemeActive,
} from "./glassTheme";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

vi.mock("./api/db", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./api/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/errors")>();
  return { ...actual, invokeBackend: vi.fn().mockResolvedValue(undefined) };
});

import { invokeBackend } from "./api/errors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest = false;

function Harness() {
  latest = useGlassThemeActive();
  return null;
}

const setSettings = (glass: string, batterySaver: string) => {
  useAppSettingsStore.setState((state) => ({
    values: {
      ...state.values,
      [SETTINGS.THEME_GLASS]: glass,
      [SETTINGS.BATTERY_SAVER]: batterySaver,
    },
  }));
};

describe("glass theme", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    setSettings("false", "false");
    document.documentElement.classList.remove(GLASS_THEME_CLASS);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
    document.documentElement.classList.remove(GLASS_THEME_CLASS);
  });

  it("toggles the shell class", () => {
    applyGlassThemeClass(true);
    expect(document.documentElement.classList.contains(GLASS_THEME_CLASS)).toBe(true);
    applyGlassThemeClass(false);
    expect(document.documentElement.classList.contains(GLASS_THEME_CLASS)).toBe(false);
  });

  it("is active only when glass is on and battery saver is off", () => {
    const render = () => act(() => { root.render(createElement(Harness)); });
    render();
    expect(latest).toBe(false);
    setSettings("true", "false");
    render();
    expect(latest).toBe(true);
    // Battery saver turns glass solid, as on Android.
    setSettings("true", "true");
    render();
    expect(latest).toBe(false);
  });

  it("asks the backend for the native backdrop with the right args", async () => {
    await setWindowGlassTheme(true, true);
    expect(invokeBackend).toHaveBeenCalledWith("set_glass_theme", { enabled: true, dark: true });
    await setWindowGlassTheme(false, false);
    expect(invokeBackend).toHaveBeenCalledWith("set_glass_theme", { enabled: false, dark: false });
  });
});
