/**
 * Battery saver turns the glass surfaces solid. The `.glass` rule in
 * `src/App.css` already falls back to solid under
 * `prefers-reduced-transparency`; this class gives the setting the same
 * treatment on demand, so the effect follows the toggle, not just the OS.
 */
export const BATTERY_SAVER_CLASS = "battery-saver";

export function applyBatterySaverClass(enabled: boolean): void {
  document.documentElement.classList.toggle(BATTERY_SAVER_CLASS, enabled);
}
