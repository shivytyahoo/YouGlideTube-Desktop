import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  clearServerHistory,
  getAccountSignedIn,
  getServerHistory,
  isSignedOutError,
  mergeWatchHistory,
  type MergedHistoryEntry,
  type ServerHistoryEntry,
} from "./api/account";
import { normalizeBackendError } from "./api/errors";
import { deleteShortWatchRecords, deleteWatchRecord } from "./api/db";
import { GOOGLE_ACCOUNT_SWITCHED_EVENT, GOOGLE_SIGN_IN_COMPLETED_EVENT } from "./useGoogleAccount";
import { useHistoryStore } from "../store/useHistoryStore";
import type { WatchHistoryRecord } from "../types/db";
import type { ServerAccountStatus } from "./useServerSubscriptions";

/**
 * A merged history row as the local history pipeline reads it. The
 * server sends no per-item watch time and no music flag, so a server
 * row reads as a plain video with its server timestamp; the resume
 * position comes from this device when it has one.
 */
export function mergedEntryToRecord(entry: MergedHistoryEntry): WatchHistoryRecord {
  return {
    videoId: entry.videoId,
    title: entry.title,
    channelName: entry.channelName,
    channelId: entry.channelId ?? null,
    watchDate: new Date(entry.timestampMs).toISOString(),
    watchDurationSeconds: entry.positionSeconds,
    totalDurationSeconds: entry.durationSeconds ?? null,
    isMusic: false,
    isShort: entry.isShort,
  };
}

/**
 * The account's watch history (`FEhistory`) merged with this device's
 * session plays, while signed in. Removing a row sends its own remove
 * token; clearing all sends the Clear-all token, else every row's own
 * token. A server-confirmed removal also drops the local row, so it
 * can't resurface as a local-only play.
 */
export function useServerHistory() {
  const [status, setStatus] = useState<ServerAccountStatus>("unknown");
  const [entries, setEntries] = useState<MergedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverEntriesRef = useRef<ServerHistoryEntry[]>([]);
  const entriesRef = useRef<MergedHistoryEntry[]>([]);
  const continuationRef = useRef<string | null>(null);
  const clearTokenRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const records = useMemo(() => entries.map(mergedEntryToRecord), [entries]);

  const applyMerged = useCallback((merged: MergedHistoryEntry[]) => {
    entriesRef.current = merged;
    setEntries(merged);
  }, []);

  const loadPage = useCallback(
    async (token: string | null, append: boolean) => {
      const request = ++requestRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadMoreFailed(false);
      try {
        const page = await getServerHistory(token ?? undefined);
        if (request !== requestRef.current) return;
        if (!append) {
          serverEntriesRef.current = [];
          clearTokenRef.current = null;
        }
        // Continuation pages repeat videos; the merge keeps server order
        // but does not dedupe server rows, so the accumulation does.
        const known = new Set(serverEntriesRef.current.map((entry) => entry.videoId));
        for (const entry of page.entries) {
          if (!known.has(entry.videoId)) {
            known.add(entry.videoId);
            serverEntriesRef.current.push(entry);
          }
        }
        if (page.clearHistoryToken) clearTokenRef.current = page.clearHistoryToken;
        continuationRef.current = page.continuation ?? null;
        setHasMore(page.continuation != null);
        applyMerged(await mergeWatchHistory(serverEntriesRef.current));
        setError(null);
      } catch (caught) {
        if (request !== requestRef.current) return;
        if (isSignedOutError(caught)) {
          setStatus("signed-out");
          serverEntriesRef.current = [];
          continuationRef.current = null;
          clearTokenRef.current = null;
          applyMerged([]);
          setHasMore(false);
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
    [applyMerged],
  );

  const refresh = useCallback(() => loadPage(null, false), [loadPage]);

  /** Re-runs the merge over the loaded server entries (after a local row changed behind the list). */
  const remerge = useCallback(async () => {
    applyMerged(await mergeWatchHistory(serverEntriesRef.current));
  }, [applyMerged]);

  const loadMore = useCallback(() => {
    if (continuationRef.current && !loadingMore) void loadPage(continuationRef.current, true);
  }, [loadingMore, loadPage]);

  /** True when the row is gone from the server (or was local-only). */
  const remove = useCallback(
    async (videoId: string): Promise<boolean> => {
      const entry = entriesRef.current.find((item) => item.videoId === videoId);
      if (!entry) return false;
      if (entry.source === "server" && !entry.removeFeedbackToken) {
        // The server keeps the row without a token to remove it by.
        return false;
      }
      if (entry.removeFeedbackToken) {
        let confirmed = false;
        try {
          confirmed = await clearServerHistory(null, [entry.removeFeedbackToken]);
        } catch (caught) {
          if (isSignedOutError(caught)) setStatus("signed-out");
          return false;
        }
        if (!confirmed) return false;
      }
      try {
        await deleteWatchRecord(videoId);
      } catch {
        // The local row may not exist; the server removal already went through.
      }
      serverEntriesRef.current = serverEntriesRef.current.filter((item) => item.videoId !== videoId);
      applyMerged(await mergeWatchHistory(serverEntriesRef.current));
      return true;
    },
    [applyMerged],
  );

  /** True when the server confirmed the clear and the lists are empty. */
  const clear = useCallback(async (): Promise<boolean> => {
    const tokens = entriesRef.current
      .map((entry) => entry.removeFeedbackToken)
      .filter((token): token is string => Boolean(token));
    let confirmed = false;
    try {
      confirmed = await clearServerHistory(clearTokenRef.current, tokens);
    } catch (caught) {
      if (isSignedOutError(caught)) setStatus("signed-out");
      return false;
    }
    if (!confirmed) return false;
    serverEntriesRef.current = [];
    continuationRef.current = null;
    clearTokenRef.current = null;
    setHasMore(false);
    applyMerged([]);
    // The backend already wiped the local rows; this resets the store.
    await useHistoryStore.getState().clear();
    return true;
  }, [applyMerged]);

  /** Removes the Shorts rows; rows without a remove token stay on the server and stay listed. */
  const removeShorts = useCallback(async (): Promise<boolean> => {
    const shorts = entriesRef.current.filter((entry) => entry.isShort);
    if (shorts.length === 0) return true;
    const tokens = shorts
      .map((entry) => entry.removeFeedbackToken)
      .filter((token): token is string => Boolean(token));
    if (tokens.length > 0) {
      let confirmed = false;
      try {
        confirmed = await clearServerHistory(null, tokens);
      } catch (caught) {
        if (isSignedOutError(caught)) setStatus("signed-out");
        return false;
      }
      if (!confirmed) return false;
    }
    try {
      await deleteShortWatchRecords();
    } catch {
      // Local Shorts rows may not exist; the server removal already went through.
    }
    const removedIds = new Set(
      shorts
        .filter((entry) => entry.source === "local" || entry.removeFeedbackToken)
        .map((entry) => entry.videoId),
    );
    serverEntriesRef.current = serverEntriesRef.current.filter((entry) => !removedIds.has(entry.videoId));
    applyMerged(await mergeWatchHistory(serverEntriesRef.current));
    return true;
  }, [applyMerged]);

  useEffect(() => {
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
    // The active account changed: the history belongs to the new account now.
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
    };
  }, [loadPage]);

  return {
    status,
    entries,
    records,
    loading,
    loadingMore,
    loadMoreFailed,
    hasMore,
    error,
    refresh,
    remerge,
    loadMore,
    remove,
    clear,
    removeShorts,
  };
}
