import { useLocation } from "react-router-dom";
import { useMediaQuery } from "./useMediaQuery";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

/** Below Tailwind's `sm` the side rail is hidden, so the menu opens the drawer instead. */
export const NARROW_WINDOW_QUERY = "(max-width: 639px)";

/** Whether the side menu opens as a drawer over the page: on Watch and Settings, in a narrow window, and in mobile interface mode (where the rail is hidden). */
export function useSidebarDrawer(): boolean {
  const { pathname } = useLocation();
  const narrow = useMediaQuery(NARROW_WINDOW_QUERY);
  const interfaceMobile = useAppSettingsStore((state) => state.values[SETTINGS.INTERFACE_MODE] === "mobile");
  return narrow || interfaceMobile || pathname.startsWith("/watch/") || pathname.startsWith("/settings");
}
