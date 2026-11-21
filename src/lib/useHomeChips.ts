import { useCallback, useEffect, useRef, useState } from "react";
import {
  NO_HOME_CHIPS,
  getHomeChipFeed,
  getHomeChips,
  onHomeFeedChanged,
  type HomeCard,
  type HomeChips,
  type HomeMix,
} from "./api/homeFeed";
import type { VideoSummary } from "../types/video";

export const ALL_CHIP = "all";
export const NEW_TO_YOU_CHIP = "new";
export const RECENT_CHIP = "recent";
export const MIXES_CHIP = "mixes";
export const LIVE_CHIP = "live";
export const WATCHED_CHIP = "watched";

/** A server home-feed chip, by label: the backend browses the feed with the chip's params. */
export const serverChipKey = (label: string) => `server:${label}`;

/** The backend's shortest mix, which a hidden video can take a mix below. */
const MIX_MIN_VIDEOS = 5;

/** Mixes come from a backend cache that doesn't hear about what was hidden since. */
export function visibleHomeMixes(mixes: HomeMix[], isHidden: (video: VideoSummary) => boolean): HomeMix[] {
  return mixes.flatMap((mix) => {
    if (isHidden(mix.seed)) return [];
    const videos = mix.videos.filter((video) => !isHidden(video));
    return videos.length >= MIX_MIN_VIDEOS ? [{ ...mix, videos }] : [];
  });
}

export type ChipFeedState =
  | { status: "loading" }
  | { status: "ready"; cards: HomeCard[]; mixes: HomeMix[] }
  | { status: "failed" };

/** The order chips appear in, which never changes. Chips with nothing to show stay out, unless chosen. */
export function visibleChipKeys(chips: HomeChips, selected: string): string[] {
  const empty = new Set(chips.empty);
  const offered = (key: string, available = true) => key === selected || (available && !empty.has(key));
  return [
    ALL_CHIP,
    ...chips.serverChips
      .filter((chip) => chip.label.trim().toLowerCase() !== "all")
      .map((chip) => serverChipKey(chip.label))
      .filter((key) => offered(key)),
    ...[NEW_TO_YOU_CHIP, RECENT_CHIP].filter((key) => offered(key)),
    ...(offered(MIXES_CHIP, chips.hasMixes) ? [MIXES_CHIP] : []),
    ...(offered(LIVE_CHIP) ? [LIVE_CHIP] : []),
    ...(offered(WATCHED_CHIP, chips.hasWatched) ? [WATCHED_CHIP] : []),
  ];
}

/** The chip to show again: the one chosen before, unless it has left the chips. */
export function chipToRestore(remembered: string, chips: HomeChips): string {
  return visibleChipKeys(chips, ALL_CHIP).includes(remembered) ? remembered : ALL_CHIP;
}

// The chosen chip outlives the page, as Home itself does, so coming back finds it still chosen.
let rememberedChip = ALL_CHIP;

/** Home's chips: the chosen one and its videos. */
export function useHomeChips(enabled: boolean) {
  const [chips, setChips] = useState<HomeChips>(NO_HOME_CHIPS);
  const [selected, setSelected] = useState(rememberedChip);
  const [feed, setFeed] = useState<ChipFeedState | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (key: string, refresh: boolean) => {
    const request = ++requestRef.current;
    if (key === ALL_CHIP) {
      setFeed(null);
      return;
    }
    setFeed((current) => (refresh && current?.status === "ready" ? current : { status: "loading" }));
    try {
      const result = await getHomeChipFeed(key, refresh);
      if (request !== requestRef.current) return;
      setFeed(result.failed ? { status: "failed" } : { status: "ready", cards: result.cards, mixes: result.mixes });
    } catch (error) {
      console.error("Home chip failed to load", error);
      if (request === requestRef.current) setFeed({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void getHomeChips()
      .then((next) => {
        if (disposed) return;
        // A settled feed may already have brought newer server chips; keep those.
        setChips((current) => (current.serverChips.length > 0 ? { ...next, serverChips: current.serverChips } : next));
        const key = chipToRestore(rememberedChip, next);
        rememberedChip = key;
        setSelected(key);
        void load(key, false);
      })
      .catch((error) => console.error("Home chips failed to load", error));
    return () => {
      disposed = true;
    };
  }, [enabled, load]);

  // The server chips arrive with the first feed page, after the chips
  // above were fetched: refresh the row when a feed settles, and fall
  // back to All when the chosen chip has left the row.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void onHomeFeedChanged((snapshot) => {
      if (disposed || snapshot.loading) return;
      void getHomeChips()
        .then((next) => {
          if (disposed) return;
          setChips(next);
          const key = chipToRestore(rememberedChip, next);
          if (key === rememberedChip) return;
          rememberedChip = key;
          setSelected(key);
          void load(key, false);
        })
        .catch((error) => console.error("Home chips failed to load", error));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [enabled, load]);

  const select = useCallback(
    (key: string) => {
      rememberedChip = key;
      setSelected(key);
      void load(key, false);
    },
    [load],
  );

  const reload = useCallback(() => {
    void load(rememberedChip, true);
  }, [load]);

  return { chips, selected, feed, select, reload };
}
