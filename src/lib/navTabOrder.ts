/** The order of the main sidebar tabs, as stored in SETTINGS.NAV_TAB_ORDER. */
export const NAV_TABS = ["home", "shorts", "explore", "music"] as const;
export type NavTabId = (typeof NAV_TABS)[number];

/**
 * Parses the stored order and returns every tab exactly once: stored tabs
 * first in stored order, then any tab missing from the stored list (a new
 * tab added in a later version, or a corrupt value) appended in default order.
 */
export function orderedNavTabs(stored: string | null | undefined): NavTabId[] {
  let parsed: unknown = [];
  try {
    parsed = stored ? JSON.parse(stored) : [];
  } catch {
    parsed = [];
  }
  const storedTabs = (Array.isArray(parsed) ? parsed : []).filter(
    (tab): tab is NavTabId => typeof tab === "string" && (NAV_TABS as readonly string[]).includes(tab),
  );
  const seen = new Set<NavTabId>(storedTabs);
  return [...storedTabs, ...NAV_TABS.filter((tab) => !seen.has(tab))];
}

/** Moves one tab one step in the stored order and returns the new stored value. */
export function moveNavTab(stored: string | null | undefined, tab: NavTabId, direction: -1 | 1): string {
  const order = orderedNavTabs(stored);
  const index = order.indexOf(tab);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return JSON.stringify(order);
  const moving = order[index]!;
  const displaced = order[target]!;
  order[index] = displaced;
  order[target] = moving;
  return JSON.stringify(order);
}
