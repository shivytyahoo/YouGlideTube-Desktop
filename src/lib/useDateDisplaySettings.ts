import { usePreference } from "./usePreference";
import { SETTINGS } from "./settings/schema";
import { dateDisplaySettingsFromValues, type DateDisplaySettings } from "./publishedDate";

/** The Date & time settings (Appearance), as Android's DateDisplaySettings. */
export function useDateDisplaySettings(): DateDisplaySettings {
  const [mode] = usePreference(SETTINGS.DATE_DISPLAY_MODE, "relative");
  const [formatStyle] = usePreference(SETTINGS.DATE_FORMAT_STYLE, "system");
  const [listsMode] = usePreference(SETTINGS.DATE_MODE_LISTS, "default");
  const [watchMode] = usePreference(SETTINGS.DATE_MODE_WATCH, "default");
  const [descriptionMode] = usePreference(SETTINGS.DATE_MODE_DESCRIPTION, "default");
  return dateDisplaySettingsFromValues({ mode, formatStyle, listsMode, watchMode, descriptionMode });
}
