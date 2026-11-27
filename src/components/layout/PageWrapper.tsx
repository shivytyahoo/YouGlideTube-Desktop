import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getString } from '../../lib/i18n/index';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { NavigationType, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { SETTINGS } from '../../lib/settings/schema';
import { ScrollContainerContext } from '../../lib/useScrollContainer';
import { isEditableTarget, scrollPageToTop } from '../../lib/scrollPageToTop';
import { usePageEnterMotion } from '../../lib/usePageEnterMotion';
import { SIDEBAR_MENU_BUTTON_ID } from './Topbar';
import { recalledScroll, rememberScroll, restoreScroll } from '../../lib/tabs/scrollMemory';
import { useSidebarDrawer } from '../../lib/useSidebarDrawer';

export function PageWrapper() {
  const location = useLocation();
  const navigationType = useNavigationType();
  // Per-field, not a bare `useUiStore()`: the store also carries `searchQuery`,
  // so a selectorless subscription re-rendered the whole routed page — feed and
  // every mounted card included — on each keystroke in the search box.
  const isWatchSidebarOpen = useUiStore((s) => s.isWatchSidebarOpen);
  const setWatchSidebarOpen = useUiStore((s) => s.setWatchSidebarOpen);
  // The top-bar refresh button bumps this; keying the outlet remounts the
  // current route, so its mount effects re-run and the view reloads. The
  // top bar and sidebar sit outside the outlet and stay put.
  const pageRefreshNonce = useUiStore((s) => s.pageRefreshNonce);
  const isWatchPage = location.pathname.startsWith('/watch/');
  // The rail renders nothing on Watch/Settings (the menu opens the drawer
  // there), so its wrapper must not keep 240px of empty space on the left —
  // it was squeezing the watch player for no reason.
  const railHidden = isWatchPage || location.pathname.startsWith('/settings');
  const usesDrawer = useSidebarDrawer();
  const isPlaylistDetailsPage =
    location.pathname.startsWith('/playlist/') ||
    location.pathname === '/watch-later';
  const isMusicCollectionPage =
    location.pathname.startsWith('/music/album/') ||
    location.pathname.startsWith('/music/playlist/');
  const isHistoryPage = location.pathname === '/history';

  const mainRef = useRef<HTMLElement>(null);
  // The watch page only fades: its player is a separate frame that follows the page's slot.
  usePageEnterMotion(mainRef, location.pathname, !isWatchPage);

  /*
    Set before paint: removing the outgoing page clamps the scroll and fires a
    scroll event, which must not overwrite the offset saved for that page.
  */
  const entryKeyRef = useRef(location.key);
  useLayoutEffect(() => {
    entryKeyRef.current = location.key;
  }, [location.key]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => rememberScroll(entryKeyRef.current, main.scrollTop);
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  // Back, Forward and tab switches return to where the page was left; anything new starts at the top.
  const pagePath = location.pathname + location.search;
  const previousPagePathRef = useRef(pagePath);
  useEffect(() => {
    const main = mainRef.current;
    const samePage = previousPagePathRef.current === pagePath;
    previousPagePathRef.current = pagePath;
    if (!main) return;
    // A replace that only swaps state (a filter, a resolved id) is still the same page.
    if (navigationType === NavigationType.Replace && samePage) {
      rememberScroll(location.key, main.scrollTop);
      return;
    }
    return restoreScroll(main, navigationType === NavigationType.Pop ? recalledScroll(location.key) : 0);
  }, [location.key, navigationType, pagePath]);

  // Leaving by Back, search or the mini player must not leave the drawer open for the next visit,
  // nor widening the window past the point where the rail shows again.
  useEffect(() => {
    setWatchSidebarOpen(false);
  }, [location.pathname, usesDrawer, setWatchSidebarOpen]);

  const drawerRef = useRef<HTMLDivElement>(null);
  // Hide the nav rail while scrolling down through a feed, and bring it back
  // on any upward scroll — only when the setting asks for it.
  const hideNavOnScroll = useAppSettingsStore((state) => state.values[SETTINGS.HIDE_NAV_ON_SCROLL] === 'true');
  // Mobile interface mode drops the sidebar rail, like the phone app: navigation
  // moves to the drawer behind the topbar menu button.
  const interfaceMobile = useAppSettingsStore((state) => state.values[SETTINGS.INTERFACE_MODE] === 'mobile');
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    if (!hideNavOnScroll) {
      setNavHidden(false);
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    let lastY = main.scrollTop;
    const onScroll = () => {
      const y = main.scrollTop;
      setNavHidden(y > 80 && y > lastY);
      lastY = y;
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [hideNavOnScroll]);
  useEffect(() => {
    if (!isWatchSidebarOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return;
      setWatchSidebarOpen(false);
      document.getElementById(SIDEBAR_MENU_BUTTON_ID)?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWatchSidebarOpen, setWatchSidebarOpen]);

  // Home takes the page back to the top without reloading it. The shell never scrolls, so the
  // browser's own Home has nowhere to go; text fields keep it, where it moves the caret.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Home' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      if (scrollPageToTop(mainRef.current)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-shell flex h-full flex-col bg-background text-chrome-zinc-100 overflow-hidden font-sans">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        {!interfaceMobile && !railHidden && (
          <div
            className={`hidden shrink-0 overflow-hidden transition-all duration-300 sm:flex sm:flex-col ${navHidden ? 'w-0 opacity-0' : 'w-60'}`}
          >
            <Sidebar />
          </div>
        )}
        <main
          ref={mainRef}
          className={
            isPlaylistDetailsPage
              || isMusicCollectionPage
              || isHistoryPage
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex-1 overflow-y-auto"
          }
        >
          {/*
            Pages cannot find this element on their own — they render inside it,
            and their own root is an auto-height block whose overflow never
            engages. Anything needing the real scrollport reads it from here.
          */}
          <ScrollContainerContext.Provider value={mainRef}>
            <Outlet key={pageRefreshNonce} />
          </ScrollContainerContext.Provider>
        </main>
      </div>
      {usesDrawer && (
        <div
          data-open={isWatchSidebarOpen}
          inert={!isWatchSidebarOpen}
          className={`fixed inset-x-0 bottom-0 top-[calc(var(--app-titlebar-height)+3.5rem)] z-50 flex ${
            isWatchSidebarOpen ? '' : 'pointer-events-none'
          }`}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={getString('sidebar_close')}
            className="sidebar-scrim absolute inset-0 bg-chrome-black/60"
            onClick={() => setWatchSidebarOpen(false)}
          />
          <div ref={drawerRef} className="sidebar-drawer relative h-full">
            <Sidebar mode="overlay" />
          </div>
        </div>
      )}
    </div>
  );
}
