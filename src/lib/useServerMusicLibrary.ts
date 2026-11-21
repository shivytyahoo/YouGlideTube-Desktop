import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAccountSignedIn } from "./api/account";
import {
  getMusicLibrary,
  setMusicPlaylistSaved,
} from "./api/music";
import { normalizeBackendError } from "./api/errors";
import { GOOGLE_ACCOUNT_SWITCHED_EVENT, GOOGLE_SIGN_IN_COMPLETED_EVENT } from "./useGoogleAccount";
import type { ServerAccountStatus } from "./useServerSubscriptions";
import type { PlaylistItem, YTItem } from "../types/music";

/**
 * The id a library collection saves under: a playlist's id, an album's
 * browse id — the same id Android's `setCollectionSaved` is handed.
 */
export function libraryCollectionId(item: YTItem): string {
  return item.type === "album" ? item.browseId : item.id;
}

/**
 * The account's YouTube Music library (`FEmusic_library_landing`) while
 * signed in, as Android's `MusicSessionLibrary` seeds it: the saved
 * playlists and albums, once per account. The landing page lists exactly
 * what the account saved, so its ids are the saved-collections set.
 *
 * Saving or unsaving a collection writes through to the account like API
 * (Android's `setCollectionSaved`): the local set updates first, and a
 * refused save puts it back. Signed out, the hook is empty and the
 * library falls back to the local albums, as before.
 */
export function useServerMusicLibrary() {
  const [status, setStatus] = useState<ServerAccountStatus>("unknown");
  const [items, setItems] = useState<YTItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const requestRef = useRef(0);

  const load = useCallback(async (reset: boolean) => {
    const request = ++requestRef.current;
    if (reset) {
      setLoading(true);
      setError(null);
    }
    let signedIn = false;
    try {
      signedIn = await getAccountSignedIn();
    } catch {
      signedIn = false;
    }
    if (request !== requestRef.current) return;
    if (!signedIn) {
      setStatus("signed-out");
      setItems([]);
      setSavedIds(new Set());
      setContinuation(null);
      setLoading(false);
      return;
    }
    setStatus("signed-in");
    try {
      const page = await getMusicLibrary();
      if (request !== requestRef.current) return;
      setItems(page.items);
      setContinuation(page.continuation);
      setSavedIds(new Set(page.items.map((item) => libraryCollectionId(item))));
      setError(null);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError(normalizeBackendError(caught).message);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!continuation || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await getMusicLibrary(continuation);
      if (request !== requestRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => libraryCollectionId(item)));
        return [
          ...current,
          ...page.items.filter((item) => !seen.has(libraryCollectionId(item))),
        ];
      });
      setSavedIds((current) => {
        const next = new Set(current);
        for (const item of page.items) next.add(libraryCollectionId(item));
        return next;
      });
      setContinuation(page.continuation);
    } catch (caught) {
      setError(normalizeBackendError(caught).message);
    } finally {
      if (request === requestRef.current) setLoadingMore(false);
    }
  }, [continuation, loadingMore]);

  // A new account re-seeds the library, as Android's `resetAccountData` does.
  useEffect(() => {
    void load(true);
    const unlistenSignedIn = listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, () => void load(true));
    const unlistenSwitched = listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, () => void load(true));
    return () => {
      requestRef.current += 1;
      void unlistenSignedIn.then((off) => off());
      void unlistenSwitched.then((off) => off());
    };
  }, [load]);

  const setCollectionSaved = useCallback(
    async (collectionId: string, saved: boolean): Promise<boolean> => {
      const previous = savedIds;
      const next = new Set(previous);
      if (saved) next.add(collectionId);
      else next.delete(collectionId);
      setSavedIds(next);
      try {
        await setMusicPlaylistSaved(collectionId, saved);
        return true;
      } catch {
        // A refused save used to leave the local state lying about the
        // library; put it back when the server says no.
        setSavedIds(previous);
        return false;
      }
    },
    [savedIds],
  );

  const playlists = useMemo(
    () =>
      items.filter(
        (item): item is { type: "playlist" } & PlaylistItem => item.type === "playlist",
      ),
    [items],
  );

  return {
    status,
    items,
    playlists,
    savedIds,
    setCollectionSaved,
    continuation,
    loading,
    loadingMore,
    loadMore,
    error,
    reload: useCallback(() => void load(true), [load]),
  };
}
