import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { Button } from '../../ui/Button';
import { useBoolPref, useNumberPref, usePreference } from '../../../lib/usePreference';
import { getString, type StringKey } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { confirmAction } from '../../../lib/dialogs';
import { useHistoryStore } from '../../../store/useHistoryStore';
import {
  DEEP_GLIDE_DURATION_OPTIONS,
  DEEP_GLIDE_NEVER_EXPIRES_HOURS,
  getDeepGlideDurationLabel,
  setDeepGlideEnabled,
} from '../../../lib/deepGlide';
import { useAppSettingsStore } from '../../../store/useAppSettingsStore';
import { SearchHistoryGroup } from '../SearchHistoryGroup';

const WATCH_RETENTION_PERIODS: readonly (readonly [number, StringKey])[] = [
  [7, 'settings_retention_one_week'],
  [30, 'settings_retention_one_month'],
  [90, 'settings_retention_three_months'],
  [180, 'settings_retention_six_months'],
  [365, 'settings_retention_one_year'],
] as const;
const WATCH_HISTORY_SIZES = [50, 100, 200, 500, 1000] as const;

export function PrivacyTab() {
  const deepGlideActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_GLIDE_ACTIVE] === 'true');
  const [deepGlideExpireHours, setDeepGlideExpireHours] = usePreference(SETTINGS.DEEP_GLIDE_EXPIRE_HOURS, '4');
  const [deepGlideSaveHistory, setDeepGlideSaveHistory] = useBoolPref(SETTINGS.DEEP_GLIDE_SAVE_HISTORY, false);
  const [deepGlideShowOnSearch, setDeepGlideShowOnSearch] = useBoolPref(SETTINGS.DEEP_GLIDE_SHOW_ON_SEARCH, false);
  const [deepGlideScrobble, setDeepGlideScrobble] = useBoolPref(SETTINGS.DEEP_GLIDE_SCROBBLE, false);
  const [watchAutoDelete, setWatchAutoDelete] = useBoolPref(SETTINGS.WATCH_HISTORY_AUTO_DELETE, false);
  const [watchRetention, setWatchRetention] = useNumberPref(SETTINGS.WATCH_HISTORY_RETENTION_DAYS, 90);
  const [watchMaxSize, setWatchMaxSize] = useNumberPref(SETTINGS.WATCH_HISTORY_MAX_SIZE, 500);
  const pruneWatchHistory = useHistoryStore((state) => state.prune);
  const clearWatchHistory = useHistoryStore((state) => state.clear);

  const handleWatchAutoDelete = (enabled: boolean) => {
    setWatchAutoDelete(enabled);
    if (enabled) void pruneWatchHistory();
  };
  const handleWatchRetention = (value: string) => {
    setWatchRetention(Number(value));
    void pruneWatchHistory();
  };
  const handleWatchMaxSize = (value: string) => {
    setWatchMaxSize(Number(value));
    void pruneWatchHistory();
  };
  const handleClearWatchHistory = async () => {
    const confirmed = await confirmAction({
      title: getString('clear_watch_history_alert_title'),
      message: getString('clear_watch_history_alert_body'),
      confirmLabel: getString('clear'),
      destructive: true,
    });
    if (confirmed) await clearWatchHistory();
  };

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

      <SettingsGroup title={getString('settings_group_watch_history')}>
        <SettingItem title={getString('settings_watch_history_auto_delete')} description={getString('settings_watch_history_auto_delete_desc')}>
          <ToggleSwitch checked={watchAutoDelete} onChange={handleWatchAutoDelete} />
        </SettingItem>
        <SettingItem title={getString('settings_watch_history_retention')} description={getString('settings_watch_history_retention_desc')} disabled={!watchAutoDelete}>
          <Select
            value={String(watchRetention)}
            onChange={handleWatchRetention}
            disabled={!watchAutoDelete}
            options={WATCH_RETENTION_PERIODS.map(([days, label]) => ({ value: String(days), label: getString(label) }))}
          />
        </SettingItem>
        <SettingItem title={getString('settings_watch_history_max_size')} description={getString('settings_watch_history_max_size_desc')}>
          <Select
            value={String(watchMaxSize)}
            onChange={handleWatchMaxSize}
            options={WATCH_HISTORY_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          />
        </SettingItem>
        <SettingItem title={getString('settings_clear_watch_history')} description={getString('settings_clear_watch_history_desc')}>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleClearWatchHistory()}>
            {getString('clear')}
          </Button>
        </SettingItem>
      </SettingsGroup>

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
        <SettingItem title={getString('scrobbling_deep_glide')} description={getString('scrobbling_deep_glide_summary')} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SCROBBLE)}>
          <ToggleSwitch checked={deepGlideScrobble} onChange={setDeepGlideScrobble} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_GLIDE_SCROBBLE)} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
