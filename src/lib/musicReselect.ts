/** The music tab was tapped while Music home is already open — scroll up, or refresh. */
export const MUSIC_RESELECTED_EVENT = "youglidetube:music-reselected";

export function announceMusicReselected(): void {
  window.dispatchEvent(new Event(MUSIC_RESELECTED_EVENT));
}
