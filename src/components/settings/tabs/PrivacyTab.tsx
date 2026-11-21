import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import {
  DEEP_GLIDE_DURATION_OPTIONS,
  DEEP_GLIDE_NEVER_EXPIRES_HOURS,
  getDeepGlideDurationLabel,
  setDeepGlideEnabled,
} from '../../../lib/deepGlide';
import { useAppSettingsStore } from '../../../store/useAppSettingsStore';
import { SearchHistoryGroup } from '../SearchHistoryGroup';

export function PrivacyTab() {
  const deepGlideActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_GLIDE_ACTIVE] === 'true');
  const [deepGlideExpireHours, setDeepGlideExpireHours] = usePreference(SETTINGS.DEEP_GLIDE_EXPIRE_HOURS, '4');
  const [deepGlideSaveHistory, setDeepGlideSaveHistory] = useBoolPref(SETTINGS.DEEP_GLIDE_SAVE_HISTORY, false);
  const [deepGlideShowOnSearch, setDeepGlideShowOnSearch] = useBoolPref(SETTINGS.DEEP_GLIDE_SHOW_ON_SEARCH, false);

  const deepGlideHours = Number(deepGlideExpireHours);
  const deepGlideDurationLabel = getDeepGlideDurationLabel(deepGlideHours);
  const deepGlideDescription = deepGlideActive
    ? deepGlideHours === DEEP_GLIDE_NEVER_EXPIRES_HOURS
      ? getString('deep_glide_active_until_disabled')
      : getString('deep_glide_learning_paused')
    : getString('deep_glide_mode_subtitle');

  return (
    <div className="space-y-6 pb-8">
      <SearchHistoryGroup />

      <SettingsGroup title={getString('deep_glide_mode_title')}>
        <SettingItem title={getString('deep_glide_mode_title')} description={deepGlideDescription} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_ACTIVE)}>
          <ToggleSwitch
            checked={deepGlideActive}
            onChange={(enabled) => {
              void setDeepGlideEnabled(enabled);
            }}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_ACTIVE)}
          />
        </SettingItem>
        <SettingItem
          title={getString('deep_glide_expire_duration_title')}
          description={getString('deep_glide_expire_duration_subtitle', deepGlideDurationLabel)}
          disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_EXPIRE_HOURS)}
        >
          <Select
            value={deepGlideExpireHours}
            onChange={setDeepGlideExpireHours}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_EXPIRE_HOURS)}
            options={DEEP_GLIDE_DURATION_OPTIONS.map((hours) => ({
              value: String(hours),
              label: getDeepGlideDurationLabel(hours),
            }))}
          />
        </SettingItem>
        <SettingItem title={getString('deep_glide_save_history_title')} description={getString('deep_glide_save_history_subtitle')} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SAVE_HISTORY)}>
          <ToggleSwitch checked={deepGlideSaveHistory} onChange={setDeepGlideSaveHistory} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SAVE_HISTORY)} />
        </SettingItem>
        <SettingItem title={getString('deep_glide_show_on_search_title')} description={getString('deep_glide_show_on_search_subtitle')} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SHOW_ON_SEARCH)}>
          <ToggleSwitch checked={deepGlideShowOnSearch} onChange={setDeepGlideShowOnSearch} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SHOW_ON_SEARCH)} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
