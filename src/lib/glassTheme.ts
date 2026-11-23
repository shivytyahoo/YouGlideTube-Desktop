import { invokeBackend } from "./api/errors";
import { SETTINGS } from "./settings/schema";
import { useBatterySaver } from "./useBatterySaver";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

/** The class that makes the app shell transparent so the native backdrop shows through. */
export const GLASS_THEME_CLASS = "glass-theme";

/**
 * The glass theme is on, and battery saver — which turns glass solid, as on
 * Android — is off. Both settings load from SQLite with the rest, so before
 * they arrive the glass stays off.
 */
export function useGlassThemeActive(): boolean {
  const glass = useAppSettingsStore((state) => state.values[SETTINGS.THEME_GLASS] === "true");
  const batterySaver = useBatterySaver();
  return glass && !batterySaver;
}

export function applyGlassThemeClass(active: boolean): void {
  document.documentElement.classList.toggle(GLASS_THEME_CLASS, active);
}

/**
 * Native window backdrop: Mica on Windows, system vibrancy on macOS, no-op
 * elsewhere (the transparent shell still shows the desktop there, unblurred).
 */
export function setWindowGlassTheme(active: boolean, dark: boolean): Promise<void> {
  return invokeBackend<void>("set_glass_theme", { enabled: active, dark });
}
