import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { getSettingValue, setSettingValue } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";

export const DEEP_GLIDE_NEVER_EXPIRES_HOURS = 0;

export type DeepGlideDisableReason = "manual" | "timer";

export const DEEP_GLIDE_DURATION_OPTIONS = [
  DEEP_GLIDE_NEVER_EXPIRES_HOURS,
  1,
  2,
  4,
  6,
  8,
  12,
  24,
] as const;

export function getDeepGlideDurationLabel(hours: number): string {
  switch (hours) {
    case DEEP_GLIDE_NEVER_EXPIRES_HOURS:
      return getString("deep_glide_duration_never");
    case 1:
      return getString("deep_glide_duration_1h");
    case 2:
      return getString("deep_glide_duration_2h");
    case 4:
      return getString("deep_glide_duration_4h");
    case 6:
      return getString("deep_glide_duration_6h");
    case 8:
      return getString("deep_glide_duration_8h");
    case 12:
      return getString("deep_glide_duration_12h");
    case 24:
      return getString("deep_glide_duration_24h");
    default:
      return getString("deep_glide_duration_hours", hours);
  }
}

export function getDeepGlideRemainingMs(
  active = getSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE) === "true",
  activatedAt = Number(getSettingValue(SETTINGS.DEEP_GLIDE_ACTIVATED_AT)),
  expireHours = Number(getSettingValue(SETTINGS.DEEP_GLIDE_EXPIRE_HOURS)),
): number | null {
  if (!active) return null;
  if (!activatedAt) return 0;
  if (expireHours === DEEP_GLIDE_NEVER_EXPIRES_HOURS) return null;
  return activatedAt + expireHours * 3_600_000 - Date.now();
}

let healingCorruptState = false;

export function isDeepGlideCurrentlyActive(): boolean {
  const active = getSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE) === "true";
  if (!active) return false;

  const activatedAt = Number(getSettingValue(SETTINGS.DEEP_GLIDE_ACTIVATED_AT));
  if (!activatedAt) {
    if (!healingCorruptState) {
      healingCorruptState = true;
      void setSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE, "false").finally(() => {
        healingCorruptState = false;
      });
    }
    return false;
  }

  const remainingMs = getDeepGlideRemainingMs(active, activatedAt);
  return remainingMs === null || remainingMs > 0;
}

export function shouldSaveHistoryInDeepGlide(): boolean {
  return getSettingValue(SETTINGS.DEEP_GLIDE_SAVE_HISTORY) === "true";
}

/** The Deep Glide switch leads the search list until you start typing. */
export function shouldShowDeepGlideOnSearch(): boolean {
  return getSettingValue(SETTINGS.DEEP_GLIDE_SHOW_ON_SEARCH) === "true";
}

/** Deep Flow keeps a session out of every history unless it was told to save them. */
export function deepGlideAllowsHistory(): boolean {
  return !isDeepGlideCurrentlyActive() || shouldSaveHistoryInDeepGlide();
}

export function shouldRecordWatchHistory(): boolean {
  return getSettingValue(SETTINGS.PAUSE_WATCH_HISTORY) !== "true" && deepGlideAllowsHistory();
}

function showDeepGlideToast(active: boolean, reason: DeepGlideDisableReason) {
  const message = active
    ? getString("deep_glide_enabled_message")
    : reason === "timer"
      ? getString("deep_glide_expired_message")
      : getString("deep_glide_disabled_message");

  useUiStore.getState().showToast({
    message,
    variant: active ? "success" : "info",
  });
}

export async function setDeepGlideEnabled(
  enabled: boolean,
  reason: DeepGlideDisableReason = "manual",
): Promise<boolean> {
  const rawEnabled = getSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE) === "true";
  const effectivelyEnabled = isDeepGlideCurrentlyActive();
  if (rawEnabled === enabled && effectivelyEnabled === enabled) return enabled;

  if (enabled) {
    const timestampSaved = await setSettingValue(SETTINGS.DEEP_GLIDE_ACTIVATED_AT, String(Date.now()));
    if (!timestampSaved) return false;
    const activeSaved = await setSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE, "true");
    if (!activeSaved) return false;
  } else {
    const activeSaved = await setSettingValue(SETTINGS.DEEP_GLIDE_ACTIVE, "false");
    if (!activeSaved) return false;
    await setSettingValue(SETTINGS.DEEP_GLIDE_ACTIVATED_AT, "0");
  }

  showDeepGlideToast(enabled, reason);
  return enabled;
}

export async function toggleDeepGlide(): Promise<boolean> {
  return setDeepGlideEnabled(!isDeepGlideCurrentlyActive());
}
