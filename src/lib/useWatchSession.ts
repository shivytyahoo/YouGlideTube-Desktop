/** What the player is showing, for the recap ledger and the watch session. */
export interface WatchSubject {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  description: string | null;
  isLive: boolean;
  isMusic: boolean;
  category: string | null;
}

/**
 * The watch session used to report playback to the recommendation engine; the
 * engine is gone, so this is now a no-op. Watch history is written separately
 * (see `addWatchRecord`), and the recap ledger reads its own session.
 */
export function useWatchSession(_subject: WatchSubject | null) {
  return {
    onTime: (_position: number, _duration: number) => {},
    onEnded: () => {},
  };
}
