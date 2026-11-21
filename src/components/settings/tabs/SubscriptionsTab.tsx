import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { useBoolPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';

export function SubscriptionsTab() {
  const [shortsContent] = useBoolPref(SETTINGS.SHORTS_CONTENT_ENABLED, true);
  const [subsRefresh, setSubsRefresh] = useBoolPref(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP, false);
  const [subsShowVideos, setSubsShowVideos] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS, true);
  const [subsShowShorts, setSubsShowShorts] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_SHORTS, true);
  const [subsShowLive, setSubsShowLive] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_LIVE, true);
  const [subsHideUnplayable, setSubsHideUnplayable] = useBoolPref(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS, false);
  const [subsCollaborations, setSubsCollaborations] = useBoolPref(SETTINGS.SUBSCRIPTION_COLLABORATIONS_ENABLED, true);
  const [subsCheckedCount, setSubsCheckedCount] = useBoolPref(SETTINGS.SUBS_SHOW_CHECKED_VIDEO_COUNT, true);
  const [postsChip, setPostsChip] = useBoolPref(SETTINGS.SUBS_POSTS_CHIP, true);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_subscriptions')}>
        <SettingItem title={getString('settings_refresh_startup')} description={getString('settings_refresh_startup_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)}><ToggleSwitch checked={subsRefresh} onChange={setSubsRefresh} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)} /></SettingItem>
        <SettingItem title={getString('settings_show_videos')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)}><ToggleSwitch checked={subsShowVideos} onChange={setSubsShowVideos} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_show_shorts')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)}><ToggleSwitch checked={subsShowShorts} onChange={setSubsShowShorts} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)} /></SettingItem>
        <SettingItem title={getString('settings_show_live')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)}><ToggleSwitch checked={subsShowLive} onChange={setSubsShowLive} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)} /></SettingItem>
        <SettingItem title={getString('settings_hide_unplayable')} description={getString('settings_hide_unplayable_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS)}><ToggleSwitch checked={subsHideUnplayable} onChange={setSubsHideUnplayable} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS)} /></SettingItem>
        <SettingItem title={getString('settings_subs_collaborations')} description={getString('settings_subs_collaborations_desc')}><ToggleSwitch checked={subsCollaborations} onChange={setSubsCollaborations} /></SettingItem>
        <SettingItem title={getString('settings_subs_checked_count')} description={getString('settings_subs_checked_count_desc')}><ToggleSwitch checked={subsCheckedCount} onChange={setSubsCheckedCount} /></SettingItem>
        <SettingItem title={getString('settings_subs_posts_chip')} description={getString('settings_subs_posts_chip_desc')}><ToggleSwitch checked={postsChip} onChange={setPostsChip} /></SettingItem>
      </SettingsGroup>
    </div>
  );
}
