import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { useUpdaterStore } from '../../../store/useUpdaterStore';

// Android's Notification Preferences page (NotificationSettingsScreen.kt): the
// background feed check, which kinds of alert the app may post. The system
// notification settings row is Android-only and omitted. There is no General
// row: the desktop inbox only ever holds new videos, Shorts and reminders,
// so a general toggle would have nothing to gate.
export function NotificationsTab() {
  const [shortsContent] = useBoolPref(SETTINGS.SHORTS_CONTENT_ENABLED, true);
  const [notificationsEnabled, setNotificationsEnabled] = useBoolPref(SETTINGS.NOTIFICATIONS_ENABLED, true);
  const [notifNewVideos, setNotifNewVideos] = useBoolPref(SETTINGS.NOTIF_NEW_VIDEOS_ENABLED, true);
  const [notifShorts, setNotifShorts] = useBoolPref(SETTINGS.NOTIF_SHORTS_ENABLED, true);
  const [notifDownloads, setNotifDownloads] = useBoolPref(SETTINGS.DOWNLOAD_NOTIFICATIONS, true);
  const [notifReminders, setNotifReminders] = useBoolPref(SETTINGS.NOTIF_REMINDERS_ENABLED, true);
  const autoCheckUpdates = useUpdaterStore((state) => state.autoCheck);
  const setAutoCheckUpdates = useUpdaterStore((state) => state.setAutoCheck);
  const [notificationInterval, setNotificationInterval] = usePreference(SETTINGS.NOTIFICATION_CHECK_INTERVAL, '360');

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_notif_schedule')}>
        <SettingItem title={getString('settings_notifications_enabled')} description={getString('settings_notifications_enabled_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)}>
          <ToggleSwitch checked={notificationsEnabled} onChange={setNotificationsEnabled} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)} />
        </SettingItem>
        <SettingItem title={getString('settings_notification_interval')} description={getString('settings_notification_interval_desc')} disabled={!notificationsEnabled || !notifNewVideos || isSettingDisabledUntilWired(SETTINGS.NOTIFICATION_CHECK_INTERVAL)}>
          <Select
            value={notificationInterval}
            onChange={setNotificationInterval}
            disabled={!notificationsEnabled || !notifNewVideos || isSettingDisabledUntilWired(SETTINGS.NOTIFICATION_CHECK_INTERVAL)}
            options={[
              { value: '15', label: getString('settings_notification_interval_15m') },
              { value: '30', label: getString('settings_notification_interval_30m') },
              { value: '60', label: getString('settings_notification_interval_1h') },
              { value: '120', label: getString('settings_notification_interval_2h') },
              { value: '180', label: getString('settings_notification_interval_3h') },
              { value: '360', label: getString('settings_notification_interval_6h') },
              { value: '720', label: getString('settings_notification_interval_12h') },
              { value: '1440', label: getString('settings_notification_interval_24h') },
            ]}
          />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_notif_types')}>
        <SettingItem title={getString('settings_notif_new_videos')} description={getString('settings_notif_new_videos_desc')} disabled={!notificationsEnabled}>
          <ToggleSwitch checked={notifNewVideos} onChange={setNotifNewVideos} disabled={!notificationsEnabled} />
        </SettingItem>
        <SettingItem title={getString('settings_notif_shorts')} description={getString('settings_notif_shorts_desc')} disabled={!notificationsEnabled || !notifNewVideos || !shortsContent}><ToggleSwitch checked={notifShorts} onChange={setNotifShorts} disabled={!notificationsEnabled || !notifNewVideos || !shortsContent} /></SettingItem>
        <SettingItem title={getString('settings_notif_downloads')} description={getString('settings_notif_downloads_desc')} disabled={!notificationsEnabled}>
          <ToggleSwitch checked={notifDownloads} onChange={setNotifDownloads} disabled={!notificationsEnabled} />
        </SettingItem>
        <SettingItem title={getString('settings_notif_reminders')} description={getString('settings_notif_reminders_desc')} disabled={!notificationsEnabled}>
          <ToggleSwitch checked={notifReminders} onChange={setNotifReminders} disabled={!notificationsEnabled} />
        </SettingItem>
        <SettingItem title={getString('settings_notif_updates')} description={getString('settings_notif_updates_desc')} disabled={!notificationsEnabled}>
          <ToggleSwitch checked={autoCheckUpdates} onChange={(value) => void setAutoCheckUpdates(value)} disabled={!notificationsEnabled} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
