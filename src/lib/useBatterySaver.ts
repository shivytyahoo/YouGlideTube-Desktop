import { SETTINGS } from "./settings/schema";
import { useBoolPref } from "./usePreference";

/**
 * Android's battery saver (`battery_saver_enabled`, default off): animations,
 * glass, previews and prefetch off. Every surface that honours it reads this
 * one hook, so the toggle flips them all together.
 */
export function useBatterySaver(): boolean {
  const [enabled] = useBoolPref(SETTINGS.BATTERY_SAVER);
  return enabled;
}
