import { useNavigate } from 'react-router-dom';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { Button } from '../../ui/Button';
import { getString } from '../../../lib/i18n/index';

/**
 * Android's Integrations settings page, as links: the SponsorBlock, DeArrow
 * and Return YouTube Dislike controls live on the Integrations page, and
 * scrobbling lives in the Music tab. This tab is the signpost to both, so a
 * user looking in Settings finds them.
 */
export function IntegrationsTab() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_integrations')}>
        <SettingItem title={getString('settings_integrations_open')} description={getString('settings_integrations_desc')}>
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/sponsorblock')}>
            {getString('open')}
          </Button>
        </SettingItem>
        <SettingItem title={getString('settings_integrations_scrobbling')} description={getString('settings_integrations_scrobbling_desc')}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate('/settings', { state: { settingsCategory: 'music' } })}
          >
            {getString('open')}
          </Button>
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
