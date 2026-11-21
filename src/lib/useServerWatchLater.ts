import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getAccountSignedIn,
  getWatchLater,
  isSignedOutError,
  setVideoWatchLater,
  type WatchLaterItem,
} from "./api/account";
import { normalizeBackendError } from "./api/errors";
import { removeVideoFromWatchLater } from "./playlistLibrary";
import { GOOGLE_ACCOUNT_SWITCHED_EVENT, GOOGLE_SIGN_IN_COMPLETED_EVENT } from "./useGoogleAccount";
import { useWatchLaterStore } from "../store/useWatchLaterStore";
import type { VideoSummary } from "../types/video";
import type { ServerAccountStatus } from "./useServerSubscriptions";

export type WatchLaterRemoveResult = "removed" | "needs-refresh" | "failed";

function appendUniqueItems(current: WatchLaterItem[], fresh: WatchLaterItem[]): WatchLaterItem[] {
  if (fresh.length === 0) return current;
  const seen = new Set(current.map((item) => item.video.id));
  const next = [...current];
  for (const item of fresh) {
    if (!seen.has(item.video.id)) {
      seen.add(item.video.id);
      next.push(item);
    }
  }
  return next;
}

/**
 * The account's Watch Later playlist (`VLWL`) while signed in. The page
 * owns the entry ids: they are published to the Watch Later store, so a
 * card menu anywhere can remove through the server, and cleared when the
 * page leaves. A row without an entry id can't be removed from the
 * server — `remove` says so instead of failing the call.
 */
export function useServerWatchLater(enabled: boolean) {
  const [status, setStatus] = useState<ServerAccountStatus>("unknown");
  const [title, setTitle] = useState("Watch Later");
  const [items, setItems] = useState<WatchLaterItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverVersion = useWatchLaterStore((s) => s.serverVersion);
  const itemsRef = useRef<WatchLaterItem[]>([]);
  const continuationRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const loadedOnceRef = useRef(false);

  const videos = useMemo(() => items.map((item) => item.video), [items]);

  const applyItems = useCallback((next: WatchLaterItem[]) => {
    itemsRef.current = next;
    setItems(next);
    const map: Record<string, string | null> = {};
    for (const item of next) map[item.video.id] = item.setVideoId ?? null;
    useWatchLaterStore.getState().setServerSetVideoIds(map);
  }, []);

  const loadPage = useCallback(
    async (token: string | null, append: boolean) => {
      const request = ++requestRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadMoreFailed(false);
      try {
        const page = await getWatchLater(token ?? undefined);
        if (request !== requestRef.current) return;
        applyItems(append ? appendUniqueItems(itemsRef.current, page.videos) : page.videos);
        setTitle(page.title);
        continuationRef.current = page.continuation ?? null;
        setContinuation(page.continuation ?? null);
        setError(null);
        if (!append) loadedOnceRef.current = true;
      } catch (caught) {
        if (request !== requestRef.current) return;
        if (isSignedOutError(caught)) {
          setStatus("signed-out");
          applyItems([]);
          continuationRef.current = null;
          setContinuation(null);
          setError(null);
        } else if (append) {
          setLoadMoreFailed(true);
        } else {
          setError(normalizeBackendError(caught).message);
        }
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [applyItems],
  );

  const refresh = useCallback(() => loadPage(null, false), [loadPage]);

  const loadMore = useCallback(() => {
    if (continuationRef.current && !loadingMore) void loadPage(continuationRef.current, true);
  }, [loadingMore, loadPage]);

  /** Every video of the list, reading the pages not loaded yet. */
  const loadAll = useCallback(async (): Promise<VideoSummary[]> => {
    const all = [...itemsRef.current];
    const seen = new Set(all.map((item) => item.video.id));
    let token = continuationRef.current;
    while (token) {
      const page = await getWatchLater(token);
      for (const item of page.videos) {
        if (!seen.has(item.video.id)) {
          seen.add(item.video.id);
          all.push(item);
        }
      }
      token = page.continuation ?? null;
    }
    applyItems(all);
    continuationRef.current = null;
    setContinuation(null);
    return all.map((item) => item.video);
  }, [applyItems]);

  const remove = useCallback(
    async (videoId: string): Promise<WatchLaterRemoveResult> => {
      const item = itemsRef.current.find((entry) => entry.video.id === videoId);
      if (!item) return "failed";
      if (!item.setVideoId) return "needs-refresh";
      try {
        await setVideoWatchLater(videoId, false, item.setVideoId);
      } catch (caught) {
        if (isSignedOutError(caught)) setStatus("signed-out");
        return "failed";
      }
      applyItems(itemsRef.current.filter((entry) => entry.video.id !== videoId));
      // Keep the local Watch Later copy in step without another server call.
      try {
        await removeVideoFromWatchLater(videoId);
      } catch {
        // The local copy may not exist.
      }
      return "removed";
    },
    [applyItems],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      const signedIn = await getAccountSignedIn();
      if (!active) return;
      if (!signedIn) {
        setStatus("signed-out");
        setLoading(false);
        return;
      }
      setStatus("signed-in");
      void loadPage(null, false);
    })();
    let stop: (() => void) | undefined;
    let stopSwitched: (() => void) | undefined;
    listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, () => {
      if (!active) return;
      setStatus("signed-in");
      void loadPage(null, false);
    })
      .then((unlisten) => {
        stop = unlisten;
      })
      .catch(() => undefined);
    // The active account changed: Watch Later belongs to the new account now.
    listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, () => {
      if (!active) return;
      setStatus("signed-in");
      void loadPage(null, false);
    })
      .then((unlisten) => {
        stopSwitched = unlisten;
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
      stopSwitched?.();
      // The entry ids belong to this visit; a later visit reads them fresh.
      useWatchLaterStore.getState().setServerSetVideoIds({});
    };
  }, [enabled, loadPage]);

  // A card menu somewhere removed through the store; the list reloads.
  // The initial load is the mount effect's job, so this one only answers
  // serverVersion bumps: a fast first page must not double-load.
  useEffect(() => {
    if (!enabled || !loadedOnceRef.current) return;
    void loadPage(null, false);
  }, [enabled, serverVersion, loadPage]);

  return {
    status,
    title,
    items,
    videos,
    hasMore: continuation !== null,
    loading,
    loadingMore,
    loadMoreFailed,
    error,
    refresh,
    loadMore,
    loadAll,
    remove,
  };
}
