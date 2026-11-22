export const SHORTS_RESELECTED_EVENT = "youglidetube:shorts-reselected";

/** The Shorts rail button was clicked while Shorts is already open. */
export function announceShortsReselected(): void {
  window.dispatchEvent(new Event(SHORTS_RESELECTED_EVENT));
}

export type ShortsReselectAction = "scroll" | "refresh";

/** Down the reel a reselect only scrolls back to the top; at the top it reloads the feed. */
export function shortsReselectAction(activeIndex: number): ShortsReselectAction {
  return activeIndex > 0 ? "scroll" : "refresh";
}
