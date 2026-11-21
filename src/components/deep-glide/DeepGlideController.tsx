import { useEffect } from "react";
import { getDeepGlideRemainingMs, setDeepGlideEnabled } from "../../lib/deepGlide";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

export function DeepGlideController() {
  const active = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_GLIDE_ACTIVE] === "true");
  const activatedAt = useAppSettingsStore((state) => Number(state.values[SETTINGS.DEEP_GLIDE_ACTIVATED_AT] ?? "0"));
  const expireHours = useAppSettingsStore((state) => Number(state.values[SETTINGS.DEEP_GLIDE_EXPIRE_HOURS] ?? "4"));

  useEffect(() => {
    const remainingMs = getDeepGlideRemainingMs(active, activatedAt, expireHours);
    if (!active || remainingMs === null) return;

    if (remainingMs <= 0) {
      void setDeepGlideEnabled(false, "timer");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void setDeepGlideEnabled(false, "timer");
    }, remainingMs);

    return () => window.clearTimeout(timeoutId);
  }, [active, activatedAt, expireHours]);

  return null;
}
