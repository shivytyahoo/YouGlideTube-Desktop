import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ChevronRight, ExternalLink, FileText, Globe, History, Scale, Code2, Cpu, Monitor, Package, Fingerprint, Info, RefreshCw } from 'lucide-react';
import { SettingsGroup } from '../SettingsGroup';
import Logo from '../../common/Logo';
import { Button } from '../../ui/Button';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { getString } from '../../../lib/i18n/index';
import { openExternal } from '../../../lib/openExternal';
import { getAppMetadata, type AppMetadata } from '../../../lib/appMetadata';
import { getSystemMetadata, type SystemMetadata } from '../../../lib/systemMetadata';
import { formatGraphics, getGraphicsReport, type GraphicsReport } from '../../../lib/graphicsReport';
import { useUpdaterStore } from '../../../store/useUpdaterStore';
import { updateBlockedStringKey } from '../../../lib/updateSupport';
import { useUiStore } from '../../../store/useUiStore';
import { ChangelogDialog } from '../about/ChangelogDialog';
import { NoticesDialog } from '../about/NoticesDialog';

function LinkRow({ icon, label, value, href, onSelect }: { icon: ReactNode; label: string; value: string; href?: string; onSelect?: () => void }) {
  const select = onSelect ?? (href ? () => void openExternal(href) : undefined);
  // A row that opens something is a button, so it can be reached and opened from the keyboard.
  const Row = select ? 'button' : 'div';
  return (
    <Row
      {...(select ? { type: 'button' as const, onClick: select } : {})}
      className={`flex w-full items-center justify-between px-5 py-4 text-start hover:bg-surface-row-hover transition-colors duration-200 ease-out group ${select ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary' : ''}`}
    >
      <div className="flex items-center gap-3 shrink-0 pe-4">
        <span className="text-chrome-neutral-400">{icon}</span>
        <span className="text-sm font-medium text-chrome-neutral-200">{label}</span>
      </div>
      <div className="flex items-center justify-end gap-2 min-w-0 text-end">
        {value && <span className="text-sm text-chrome-neutral-400 break-all">{value}</span>}
        {href && <ExternalLink size={12} className="text-chrome-neutral-500 group-hover:text-chrome-neutral-300 transition-colors" />}
        {onSelect && <ChevronRight size={14} className="text-chrome-neutral-500 group-hover:text-chrome-neutral-300 transition-colors rtl:-scale-x-100" />}
      </div>
    </Row>
  );
}

const unknown = () => getString('settings_unknown');

const sourceLabel = (source?: AppMetadata['source'] | SystemMetadata['source']) => {
  if (source === 'tauri' || source === 'tauri-os') return getString('settings_source_tauri');
  if (source === 'fallback' || source === 'browser-fallback') return getString('settings_source_fallback');
  return unknown();
};

export function AboutTab() {
  const [appMetadata, setAppMetadata] = useState<AppMetadata | null>(null);
  const [systemMetadata, setSystemMetadata] = useState<SystemMetadata | null>(null);
  const [graphics, setGraphics] = useState<GraphicsReport | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [openDialog, setOpenDialog] = useState<'changelog' | 'notices' | null>(null);
  const autoCheck = useUpdaterStore((s) => s.autoCheck);
  const setAutoCheck = useUpdaterStore((s) => s.setAutoCheck);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const updateSupport = useUpdaterStore((s) => s.support);
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    let active = true;
    Promise.all([getAppMetadata(), getSystemMetadata(), getGraphicsReport()])
      .then(([app, system, graphicsReport]) => {
        if (!active) return;
        setAppMetadata(app);
        setSystemMetadata(system);
        setGraphics(graphicsReport);
      })
      .catch(() => {
        if (!active) return;
        setAppMetadata(null);
        setSystemMetadata(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const store = useUpdaterStore.getState();
    void store.loadPreferences();
    void store.loadSupport();
  }, []);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdates({ silent: false });
      if (result === 'uptodate') {
        showToast({ variant: 'success', message: getString('updater_up_to_date') });
      } else if (result === 'error') {
        showToast({ variant: 'error', message: getString('updater_check_failed') });
      }
      // 'available' opens the global UpdateDialog automatically.
    } finally {
      setCheckingUpdate(false);
    }
  };

  const appName = appMetadata?.name ?? getString('settings_loading_metadata');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col items-center py-8">
        <Logo size={72} />
        <h2 className="text-2xl font-bold text-chrome-neutral-100 mt-4">{appName}</h2>
        <p className="text-sm text-chrome-neutral-400 mt-1">{getString('settings_about_subtitle')}</p>
      </div>

      <SettingsGroup title={getString('settings_group_app')}>
        <LinkRow icon={<Code2 size={16} />} label={getString('settings_version')} value={appMetadata?.version ?? unknown()} />
        <LinkRow icon={<History size={16} />} label={getString('about_changelog')} value={getString('about_changelog_summary')} onSelect={() => setOpenDialog('changelog')} />
        <LinkRow icon={<Fingerprint size={16} />} label={getString('settings_identifier')} value={appMetadata?.identifier ?? unknown()} />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_tauri_version')} value={appMetadata?.tauriVersion ?? unknown()} />
        <LinkRow icon={<Package size={16} />} label={getString('settings_bundle_type')} value={appMetadata?.bundleType ?? unknown()} />
        <LinkRow icon={<Info size={16} />} label={getString('settings_metadata_source')} value={sourceLabel(appMetadata?.source)} />
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_updates')}>
        {updateSupport && !updateSupport.supported && updateSupport.reason ? (
          <div className="px-5 py-4">
            <div className="text-sm font-medium text-chrome-neutral-200">
              {getString(updateBlockedStringKey(updateSupport.reason))}
            </div>
            <div className="text-xs text-chrome-neutral-400 mt-0.5">
              {getString('settings_check_for_updates_desc', appMetadata?.version ?? unknown())}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex-1 min-w-0 me-4">
                <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_check_for_updates')}</div>
                <div className="text-xs text-chrome-neutral-400 mt-0.5">
                  {getString('settings_check_for_updates_desc', appMetadata?.version ?? unknown())}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={handleCheckForUpdates} disabled={checkingUpdate}>
                <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : undefined} />
                {checkingUpdate ? getString('settings_checking') : getString('settings_check_for_updates')}
              </Button>
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex-1 min-w-0 me-4">
                <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_auto_update')}</div>
                <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_auto_update_desc')}</div>
              </div>
              <ToggleSwitch checked={autoCheck} onChange={(value) => void setAutoCheck(value)} />
            </div>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_legal')}>
        <LinkRow icon={<Scale size={16} />} label={getString('settings_license')} value="GPL-3.0" />
        <LinkRow icon={<FileText size={16} />} label={getString('about_notices')} value={getString('about_notices_summary')} onSelect={() => setOpenDialog('notices')} />
        <div className="px-5 py-4">
          <p className="text-xs text-chrome-neutral-400 leading-relaxed">{getString('settings_license_text')}</p>
        </div>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_device')}>
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_platform')} value={systemMetadata?.platform ?? unknown()} />
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_os')} value={systemMetadata ? `${systemMetadata.osType} ${systemMetadata.osVersion}` : unknown()} />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_os_family')} value={systemMetadata?.family ?? unknown()} />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_architecture')} value={systemMetadata?.arch ?? unknown()} />
        <LinkRow icon={<Globe size={16} />} label={getString('settings_locale')} value={systemMetadata?.locale ?? unknown()} />
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_display')} value={systemMetadata?.display ?? unknown()} />
        <LinkRow icon={<Info size={16} />} label={getString('settings_metadata_source')} value={sourceLabel(systemMetadata?.source)} />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_user_agent')} value={systemMetadata?.userAgent ?? unknown()} />
        {graphics ? (
          <>
            <LinkRow icon={<Monitor size={16} />} label={getString('settings_graphics')} value={formatGraphics(graphics)} />
            <LinkRow icon={<Cpu size={16} />} label={getString('settings_video_decoders')} value={graphics.decoders ?? getString('settings_video_decoders_checking')} />
          </>
        ) : null}
      </SettingsGroup>

      <AnimatePresence>
        {openDialog === 'changelog' && <ChangelogDialog key="changelog" installedVersion={appMetadata?.version ?? null} onClose={() => setOpenDialog(null)} />}
        {openDialog === 'notices' && <NoticesDialog key="notices" onClose={() => setOpenDialog(null)} />}
      </AnimatePresence>
    </div>
  );
}
