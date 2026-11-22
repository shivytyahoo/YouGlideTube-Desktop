import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PlayCircle,
  LayoutGrid,
  Gauge,
  Wifi,
  Download,
  Database,
  Info,
  Palette,
  Music2,
  UserRound,
  Keyboard,
  MicVocal,
  Bell,
  BellRing,
  ShieldCheck,
  Hourglass,
  Languages,
  Puzzle,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { getString, type StringKey } from '../../lib/i18n/index';
import { SETTINGS_CATEGORY_LABELS, SETTINGS_INDEX, type SettingEntry, type SettingsCategory } from '../../lib/settings/settingsIndex';
import { searchSettings } from '../../lib/settings/settingsSearch';
import { useDebounce } from '../../lib/useDebounce';
import { usePageEnterMotion } from '../../lib/usePageEnterMotion';
import { SETTINGS } from '../../lib/settings/schema';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useNewSettingsStore } from '../../store/useNewSettingsStore';
import { useSettingsSearchStore } from '../../store/useSettingsSearchStore';
import { SettingsSearchResults } from './SettingsSearchResults';

export type { SettingsCategory };

const HIGHLIGHT_MS = 1600;

interface CategoryDef {
  id: SettingsCategory;
  icon: ReactNode;
}

interface CategoryGroup {
  labelKey: StringKey;
  categories: CategoryDef[];
}

// Android's settings home, in its group order: Google account first, then
// Watch & listen, Interface, Library & data, System, YouGlideTube. Battery
// saver is pinned above every tab (Settings.tsx), as on Android. The
// desktop-only tabs sit in the group they belong to: music, lyrics and the
// subscriptions feed under Watch & listen; keyboard shortcuts under
// Interface; the database tab under Library & data. Two Android groups have
// no tab of their own here: Widgets (no desktop widgets) and the Engine
// group, whose Deep Glide rows live inside the History & privacy tab.
const categoryGroups: CategoryGroup[] = [
  { labelKey: 'account_title', categories: [{ id: 'account', icon: <UserRound size={18} /> }] },
  {
    labelKey: 'settings_group_watching',
    categories: [
      { id: 'content', icon: <LayoutGrid size={18} /> },
      { id: 'player', icon: <PlayCircle size={18} /> },
      { id: 'quality', icon: <Gauge size={18} /> },
      { id: 'music', icon: <Music2 size={18} /> },
      { id: 'lyrics', icon: <MicVocal size={18} /> },
      { id: 'integrations', icon: <Puzzle size={18} /> },
      { id: 'subscriptions', icon: <Bell size={18} /> },
    ],
  },
  {
    labelKey: 'settings_group_look',
    categories: [
      { id: 'appearance', icon: <Palette size={18} /> },
      { id: 'language', icon: <Languages size={18} /> },
      { id: 'keyboard', icon: <Keyboard size={18} /> },
    ],
  },
  {
    labelKey: 'settings_group_data',
    categories: [
      { id: 'downloads', icon: <Download size={18} /> },
      { id: 'privacy', icon: <ShieldCheck size={18} /> },
      { id: 'data', icon: <Database size={18} /> },
    ],
  },
  {
    labelKey: 'settings_group_system',
    categories: [
      { id: 'notifications', icon: <BellRing size={18} /> },
      { id: 'network', icon: <Wifi size={18} /> },
      { id: 'wellbeing', icon: <Hourglass size={18} /> },
    ],
  },
  { labelKey: 'settings_header_about', categories: [{ id: 'about', icon: <Info size={18} /> }] },
];

const categories: CategoryDef[] = categoryGroups.flatMap((group) => group.categories);

interface SettingsLayoutProps {
  children: (activeTab: SettingsCategory) => ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  // Other screens can open a section directly, such as the subscribe menu opening Content.
  const requested = (useLocation().state as { settingsCategory?: SettingsCategory } | null)?.settingsCategory;
  const [activeTab, setActiveTab] = useState<SettingsCategory>(
    requested && categories.some((cat) => cat.id === requested) ? requested : 'appearance',
  );
  // A link inside Settings can ask for another tab while already on the page;
  // the initial state above only runs on mount, so follow later requests too.
  useEffect(() => {
    if (requested && categories.some((cat) => cat.id === requested)) setActiveTab(requested);
  }, [requested]);
  const query = useSettingsSearchStore((state) => state.query);
  const clearQuery = useSettingsSearchStore((state) => state.clearQuery);
  const [highlight, setHighlight] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 120);
  const results = useMemo(() => searchSettings(debouncedQuery, SETTINGS_INDEX), [debouncedQuery]);
  const searching = debouncedQuery.trim().length > 0;
  const paneRef = useRef<HTMLDivElement>(null);
  usePageEnterMotion(paneRef, activeTab, true);

  const newCategories = useNewSettingsStore((state) => state.categories);
  const highlightNew = useAppSettingsStore((state) => state.values[SETTINGS.HIGHLIGHT_NEW_SETTINGS] === 'true');
  const highlightDays = Number(useAppSettingsStore((state) => state.values[SETTINGS.HIGHLIGHT_NEW_SETTINGS_DAYS]) || 7);
  useEffect(() => {
    useNewSettingsStore.getState().refresh(highlightNew, highlightDays);
  }, [highlightNew, highlightDays]);

  useEffect(() => {
    return () => {
      useSettingsSearchStore.getState().clearQuery();
    };
  }, []);

  const openResult = (entry: SettingEntry) => {
    setActiveTab(entry.category);
    clearQuery();
    setHighlight(getString(entry.title));
  };

  useEffect(() => {
    if (!highlight || searching) return;
    const row = paneRef.current?.querySelector<HTMLElement>(`[data-setting-title="${CSS.escape(highlight)}"]`);
    row?.scrollIntoView({ block: 'center' });
    row?.classList.add('setting-row-highlight');
    const timer = window.setTimeout(() => {
      row?.classList.remove('setting-row-highlight');
      setHighlight(null);
    }, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight, searching]);

  return (
    <div className="mx-auto w-full h-[calc(100vh-64px)] flex">
      <nav className="w-56 shrink-0 border-e border-chrome-neutral-800 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        <h2 className="text-lg font-bold text-chrome-neutral-100 px-3 mb-4">{getString('settings_title')}</h2>
        {categoryGroups.map((group) => (
          <div key={group.labelKey} className="flex flex-col gap-1 pt-3 first:pt-0">
            <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-chrome-neutral-500">
              {getString(group.labelKey)}
            </p>
            {group.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveTab(cat.id);
                  clearQuery();
                }}
                className={`px-4 py-2.5 rounded-full flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer ${
                  !searching && activeTab === cat.id
                    ? 'bg-surface-container-high text-[var(--color-primary)]'
                    : 'text-chrome-neutral-400 hover:bg-surface-container-low hover:text-chrome-neutral-200'
                }`}
              >
                <span className="shrink-0">{cat.icon}</span>
                <span className="min-w-0 truncate text-start">{getString(SETTINGS_CATEGORY_LABELS[cat.id])}</span>
                {newCategories.has(cat.id) && (
                  <span role="img" aria-label={getString('settings_new_badge')} className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div ref={paneRef} className="flex-1 overflow-y-auto py-6 ps-10 pe-4">
        {searching ? <SettingsSearchResults results={results} onOpen={openResult} /> : children(activeTab)}
      </div>
    </div>
  );
}
