import { BatteryCharging } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";
import { SettingsGroup } from "./SettingsGroup";
import { SettingItem } from "./SettingItem";
import { ToggleSwitch } from "../ui/ToggleSwitch";

/**
 * Battery saver, first in Settings — as on Android (SettingsHomeContent.kt:
 * the `home.battery` group sits first, "so it is one tap away"). The row is
 * pinned at the top of the settings pane on every tab, which is the desktop
 * equivalent of Android's first group: title, subtitle and switch, verbatim
 * from Android's strings.
 */
export function BatterySaverRow() {
  const [batterySaver, setBatterySaver] = useBoolPref(SETTINGS.BATTERY_SAVER);

  return (
    <SettingsGroup title={getString("settings_battery_saver_title")}>
      <SettingItem
        title={getString("settings_battery_saver_title")}
        description={getString("settings_battery_saver_subtitle")}
        icon={<BatteryCharging size={18} />}
      >
        <ToggleSwitch checked={batterySaver} onChange={setBatterySaver} />
      </SettingItem>
    </SettingsGroup>
  );
}

export default BatterySaverRow;
