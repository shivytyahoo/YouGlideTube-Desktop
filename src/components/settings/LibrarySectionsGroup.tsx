import { getString } from "../../lib/i18n/index";
import { LIBRARY_SECTIONS, toggledHiddenSections, useHiddenLibrarySections } from "../../lib/librarySections";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref, usePreference } from "../../lib/usePreference";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingItem } from "./SettingItem";
import { SettingsGroup } from "./SettingsGroup";

/** A switch for each shelf of the Library page. */
export function LibrarySectionsGroup() {
  const hidden = useHiddenLibrarySections();
  const [, setRaw] = usePreference(SETTINGS.HIDDEN_LIBRARY_SECTIONS);
  const [libraryPreviews, setLibraryPreviews] = useBoolPref(SETTINGS.LIBRARY_PREVIEWS, true);
  const [separatePlaylists, setSeparatePlaylists] = useBoolPref(SETTINGS.SEPARATE_PLAYLISTS, false);

  return (
    <SettingsGroup title={getString("settings_group_library_sections")}>
      <SettingItem title={getString("settings_library_previews")} description={getString("settings_library_previews_desc")}>
        <ToggleSwitch checked={libraryPreviews} onChange={setLibraryPreviews} />
      </SettingItem>
      <SettingItem title={getString("settings_separate_playlists")} description={getString("settings_separate_playlists_desc")}>
        <ToggleSwitch checked={separatePlaylists} onChange={setSeparatePlaylists} />
      </SettingItem>
      {LIBRARY_SECTIONS.map((section) => (
        <SettingItem key={section.id} title={getString(section.title)}>
          <ToggleSwitch
            checked={!hidden.has(section.id)}
            onChange={(shown) => setRaw(toggledHiddenSections(hidden, section.id, !shown))}
          />
        </SettingItem>
      ))}
    </SettingsGroup>
  );
}
