import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleUserRound, HatGlasses, LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { GoogleSignInDialog } from '../GoogleSignInDialog';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useGoogleAccount, googleAccountDisplayName, googleAccountInitial } from '../../lib/useGoogleAccount';
import Logo from '../common/Logo';
import { IconButton } from '../ui/IconButton';
import { TopbarSearch } from './TopbarSearch';
import { SETTINGS } from '../../lib/settings/schema';
import { getString } from '../../lib/i18n/index';
import { toggleDeepGlide } from '../../lib/deepGlide';
import { NotificationsBell } from '../notifications/NotificationsBell';
import { activeTab, useTabsStore } from '../../store/useTabsStore';
import { useSidebarDrawer } from '../../lib/useSidebarDrawer';
import { AccountMenu } from './AccountMenu';
import type { MenuAnchor } from '../ui/AnchoredPortalMenu';
import { alignToEnd } from '../../lib/direction';

/** PageWrapper returns focus here when Escape closes the drawer. */
export const SIDEBAR_MENU_BUTTON_ID = 'sidebar-menu-button';

export function Topbar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleWatchSidebar = useUiStore((s) => s.toggleWatchSidebar);
  const isSidebarExpanded = useUiStore((s) => s.isSidebarExpanded);
  const isWatchSidebarOpen = useUiStore((s) => s.isWatchSidebarOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const isWatchPage = location.pathname.startsWith('/watch/');
  const usesDrawer = useSidebarDrawer();
  // Lets the glow above the player through. Solid again the moment the video reaches the bar,
  // with no fade, so the picture never shows behind the search box.
  const seeThrough = usePlayerStore((s) => s.isAmbientSpreadShown && s.isPlayerBelowTopbar) && isWatchPage;
  const sidebarOpen = usesDrawer ? isWatchSidebarOpen : isSidebarExpanded;
  const showAppLogo = useAppSettingsStore((state) => state.values[SETTINGS.SHOW_APP_LOGO_ICON] !== 'false');
  const deepGlideActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_GLIDE_ACTIVE] === 'true');
  const canGoBack = useTabsStore((state) => activeTab(state).index > 0);
  const tabCount = useTabsStore((state) => state.tabs.length);
  const canGoForward = useTabsStore((state) => {
    const tab = activeTab(state);
    return tab.index < tab.entries.length - 1;
  });
  const googleAccount = useGoogleAccount();
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInMode, setSignInMode] = useState<"sign-in" | "add-account">("sign-in");
  const requestPageRefresh = useUiStore((s) => s.requestPageRefresh);
  // Brief spinner feedback while the page reloads; the store itself guards
  // against double-taps remounting the page twice.
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);
  const handleRefresh = useCallback(() => {
    requestPageRefresh();
    setRefreshing(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 900);
  }, [requestPageRefresh]);
  const signInDialogOpen = useUiStore((s) => s.signInDialogOpen);
  const closeSignInDialog = useUiStore((s) => s.closeSignInDialog);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const avatarWrapRef = useRef<HTMLDivElement>(null);

  /** The avatar opens the account menu; a second tap (or Escape/outside click) closes it. */
  const toggleAccountMenu = useCallback(() => {
    if (menuAnchor) {
      setMenuAnchor(null);
      return;
    }
    const rect = avatarWrapRef.current?.getBoundingClientRect();
    if (rect) setMenuAnchor({ top: rect.bottom + 8, ...alignToEnd(rect) });
  }, [menuAnchor]);

  const openSignIn = useCallback((mode: "sign-in" | "add-account") => {
    setMenuAnchor(null);
    setSignInMode(mode);
    setSignInOpen(true);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 flex h-14 items-center justify-between border-b px-3 ${
        seeThrough ? 'bg-transparent transition-colors duration-200 ease-out' : 'glass'
      }`}
    >
      {/* Left */}
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          id={SIDEBAR_MENU_BUTTON_ID}
          aria-label={getString('sidebar_menu')}
          aria-expanded={sidebarOpen}
          onClick={usesDrawer ? toggleWatchSidebar : toggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose className="rtl:-scale-x-100" /> : <PanelLeftOpen className="rtl:-scale-x-100" />}
        </IconButton>
        {usesDrawer && tabCount > 1 && (
          <IconButton
            aria-label={getString('tabs_show', tabCount)}
            title={getString('tabs_show', tabCount)}
            onClick={toggleWatchSidebar}
          >
            <span className="grid h-5 w-5 place-items-center rounded-md border-[1.5px] border-current font-mono text-[11px] font-semibold leading-none">
              {tabCount > 99 ? '99+' : tabCount}
            </span>
          </IconButton>
        )}
        {showAppLogo && (
          <div className="cursor-pointer" onClick={() => navigate('/')}>
            <Logo size={36} showText={true} />
          </div>
        )}
        <div className="hidden ms-1 items-center sm:flex">
          <IconButton
            title={getString('topbar_back')}
            aria-label={getString('topbar_back')}
            onClick={() => navigate(-1)}
            disabled={!canGoBack}
            className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
          >
            <ArrowLeft className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton
            title={getString('topbar_forward')}
            aria-label={getString('topbar_forward')}
            onClick={() => navigate(1)}
            disabled={!canGoForward}
            className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
          >
            <ArrowRight className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton
            title={getString('refresh')}
            aria-label={getString('refresh')}
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </div>

      {/* Center - Search */}
      <div className="flex max-w-[720px] flex-1 items-center justify-center px-4 md:px-8">
        <TopbarSearch />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <NotificationsBell />
        <IconButton
          onClick={() => {
            void toggleDeepGlide();
          }}
          title={getString(deepGlideActive ? 'deep_glide_topbar_disable' : 'deep_glide_topbar_enable')}
          aria-pressed={deepGlideActive}
          className={deepGlideActive ? 'deep-glide-topbar-active' : undefined}
        >
          <HatGlasses />
        </IconButton>
        <IconButton onClick={() => navigate('/settings')} title={getString('settings_title')} aria-label={getString('settings_title')}>
          <Settings />
        </IconButton>
        {/* Sign-in follows the mobile app: a "Sign in" button up here, and
            once signed in an avatar chip plus a logout button. The avatar
            opens the account menu (account info, switch/add account,
            Google account settings, sign out); it shows the account photo
            from `account_menu` when present, else the first letter of the
            real display name — a plain user icon until the name is known,
            never a placeholder initial. (Android itself shows no top-bar
            avatar; the chip exists because the desktop top bar is where
            sign-in lives.) */}
        {googleAccount.status === 'signed-in' ? (
          <>
            <div className="relative shrink-0" ref={avatarWrapRef}>
              <button
                type="button"
                onClick={toggleAccountMenu}
                aria-haspopup="menu"
                aria-expanded={menuAnchor !== null}
                aria-label={googleAccountDisplayName(googleAccount.account) ?? getString('sign_in_signed_in')}
                title={googleAccountDisplayName(googleAccount.account) ?? undefined}
                className="flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {googleAccount.account?.thumbnailUrl ? (
                  <img
                    src={googleAccount.account.thumbnailUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : googleAccountDisplayName(googleAccount.account) ? (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-[var(--color-on-primary)]">
                    {googleAccountInitial(googleAccount.account)}
                  </span>
                ) : (
                  <CircleUserRound className="h-9 w-9 text-chrome-neutral-400" />
                )}
              </button>
            </div>
            {menuAnchor && (
              <AccountMenu
                anchor={menuAnchor}
                onClose={() => setMenuAnchor(null)}
                onAddAccount={() => openSignIn("add-account")}
              />
            )}
            <IconButton
              onClick={() => void googleAccount.signOut()}
              title={getString('sign_out')}
              aria-label={getString('sign_out')}
            >
              <LogOut />
            </IconButton>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => openSignIn("sign-in")}
            disabled={googleAccount.status === 'signing-in'}
          >
            {getString(googleAccount.status === 'signing-in' ? 'sign_in_waiting' : 'sign_in')}
          </Button>
        )}
        {(signInOpen || signInDialogOpen) && (
          <GoogleSignInDialog
            // The local opener picks the mode; a store opener never does, so it
            // signs in (the default) rather than inheriting a stale mode.
            mode={signInOpen ? signInMode : "sign-in"}
            onClose={() => {
              setSignInOpen(false);
              closeSignInDialog();
            }}
          />
        )}
      </div>
    </header>
  );
}
