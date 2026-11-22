import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Pull-to-refresh for the routed pages' scroll container, as on Android.
 *
 * Touch only: a mouse drag at the top of a feed is text selection, and the
 * refresh button stays the mouse path. The gesture arms only while the
 * container sits at the very top, and the touchmove handler is non-passive so
 * preventDefault lands before the webview starts its own scroll — without
 * that the pull never registers and the page just overscrolls.
 *
 * The indicator trails the finger at half speed and the refresh fires once
 * the pull passes the threshold, on release.
 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 72;
const MAX_PULL_PX = 120;

/** Resistance: the indicator trails the finger so a long drag doesn't shove the page down. */
export function resistedPull(dy: number): number {
  return Math.min(MAX_PULL_PX, Math.round(dy * 0.5));
}

export function pullTriggersRefresh(pullPx: number): boolean {
  return pullPx >= PULL_TO_REFRESH_THRESHOLD_PX;
}

interface UsePullToRefreshOptions {
  onRefresh: () => void;
  /** The caller's in-flight refresh; the indicator spins until it clears. */
  refreshing: boolean;
  disabled?: boolean;
}

export function usePullToRefresh(
  scrollContainer: RefObject<HTMLElement | null> | null,
  { onRefresh, refreshing, disabled = false }: UsePullToRefreshOptions,
): { pullPx: number; refreshing: boolean } {
  const [pullPx, setPullPx] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  useEffect(() => {
    if (triggered && !refreshing) setTriggered(false);
  }, [triggered, refreshing]);

  useEffect(() => {
    const el = scrollContainer?.current;
    if (!el || disabled) return;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || el.scrollTop > 0) return;
      startYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const startY = startYRef.current;
      if (startY === null) return;
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      const dy = y - startY;
      // An upward drag, or a scroll that started below the top, hands control back.
      if (dy <= 0 || el.scrollTop > 0) {
        startYRef.current = null;
        pullRef.current = 0;
        setPullPx(0);
        return;
      }
      event.preventDefault();
      pullRef.current = resistedPull(dy);
      setPullPx(pullRef.current);
    };
    const onTouchEnd = () => {
      startYRef.current = null;
      if (pullTriggersRefresh(pullRef.current) && !refreshingRef.current) {
        setTriggered(true);
        onRefreshRef.current();
      }
      pullRef.current = 0;
      setPullPx(0);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollContainer, disabled]);

  return { pullPx, refreshing: triggered };
}
