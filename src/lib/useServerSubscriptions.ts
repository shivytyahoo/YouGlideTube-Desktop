import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getAccountSignedIn,
  getGuideSubscriptions,
  getServerSubscriptions,
  isSignedOutError,
  type ServerChannelSummary,
} from "./api/account";
import { normalizeBackendError } from "./api/errors";
import { GOOGLE_ACCOUNT_SWITCHED_EVENT, GOOGLE_SIGN_IN_COMPLETED_EVENT } from "./useGoogleAccount";
import type { SubscribedChannel } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";

/** Unknown until the first auth check answers; signed-out is a real state, not an error. */
export type ServerAccountStatus = "unknown" | "signed-in" | "signed-out";

/** A feed channel as the local subscriptions list reads it. */
function toSubscribedChannel(channel: ServerChannelSummary): SubscribedChannel {
  return {
    id: channel.channelId,
    name: channel.name,
    avatarUrl: channel.avatarUrl ?? undefined,
    subscriberCountText: channel.subscriberCountText ?? undefined,
  };
}

/**
 * The channel rail: the feed's own channels, else the channels of its
 * videos, as Android builds it when the feed carries no rail.
 */
export function serverFeedChannels(
  feedChannels: ServerChannelSummary[],
  videos: VideoSummary[],
): SubscribedChannel[] {
  if (feedChannels.length > 0) return feedChannels.map(toSubscribedChannel);
  const seen = new Map<string, SubscribedChannel>();
  for (const video of videos) {
    const channelId = video.channelId;
    if (!channelId || seen.has(channelId)) continue;
    seen.set(channelId, {
      id: channelId,
      name: video.channelName,
      avatarUrl: video.channelAvatarUrl ?? undefined,
    });
  }
  return [...seen.values()];
}

function appendUnique<T extends { id: string }>(current: T[], fresh: T[]): T[] {
  if (fresh.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of fresh) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      next.push(item);
    }
  }
  return next;
}

/**
 * The account's subscriptions feed (`FEsubscriptions`) while signed in.
 * Continuation pages repeat videos, so every page is deduped by id.
 * A Validation error (signed out mid-session) drops back to the
 * signed-out state instead of failing the page. The channel rail comes
 * from the guide — the complete membership list the feed only ever
 * samples — with the feed's own channels as the fallback.
 */
export function useServerSubscriptions() {
  const [status, setStatus] = useState<ServerAccountStatus>("unknown");
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [shorts, setShorts] = useState<VideoSummary[]>([]);
  const [feedChannels, setFeedChannels] = useState<ServerChannelSummary[]>([]);
  const [guideChannels, setGuideChannels] = useState<SubscribedChannel[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const requestRef = useRef(0);
  const guideRequestRef = useRef(0);

  const channels = useMemo(
    () => serverFeedChannels(feedChannels, videos),
    [feedChannels, videos],
  );

  /**
   * The guide's channel list. A failed guide load leaves the rail to the
   * feed's channels instead of failing the page.
   */
  const loadGuide = useCallback(async () => {
    const request = ++guideRequestRef.current;
    try {
      const channels = await getGuideSubscriptions();
      if (request !== guideRequestRef.current) return;
      setGuideChannels(channels.map(toSubscribedChannel));
    } catch {
      if (request !== guideRequestRef.current) return;
      setGuideChannels([]);
    }
  }, []);

  const loadPage = useCallback(async (token: string | null, append: boolean) => {
    const request = ++requestRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setLoadMoreFailed(false);
    try {
      const page = await getServerSubscriptions(token ?? undefined);
      if (request !== requestRef.current) return;
      setVideos((current) => (append ? appendUnique(current, page.videos) : page.videos));
      setShorts((current) => (append ? appendUnique(current, page.shorts) : page.shorts));
      setFeedChannels((current) =>
        append
          ? [
              ...current,
              ...page.channels.filter(
                (channel) => !current.some((known) => known.channelId === channel.channelId),
              ),
            ]
          : page.channels,
      );
      setContinuation(page.continuation ?? null);
      setError(null);
      setLastLoadedAt(Date.now());
    } catch (caught) {
      if (request !== requestRef.current) return;
      if (isSignedOutError(caught)) {
        setStatus("signed-out");
        setVideos([]);
        setShorts([]);
        setFeedChannels([]);
        setGuideChannels([]);
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
  }, []);

  const refresh = useCallback(() => {
    void loadGuide();
    void loadPage(null, false);
  }, [loadGuide, loadPage]);

  const loadMore = useCallback(() => {
    if (continuation && !loadingMore) void loadPage(continuation, true);
  }, [continuation, loadingMore, loadPage]);

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
      void loadGuide();
      void loadPage(null, false);
    })();
    let stop: (() => void) | undefined;
    let stopSwitched: (() => void) | undefined;
    listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, () => {
      if (!active) return;
      setStatus("signed-in");
      void loadGuide();
      void loadPage(null, false);
    })
      .then((unlisten) => {
        stop = unlisten;
      })
      .catch(() => undefined);
    // The active account changed (switch, sign-out to another account, or
    // removal): the feed belongs to the new account now, so reload it
    // instead of showing the old account's videos.
    listen(GOOGLE_ACCOUNT_SWITCHED_EVENT, () => {
      if (!active) return;
      setStatus("signed-in");
      void loadGuide();
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
  }, [loadGuide, loadPage]);

  return {
    status,
    videos,
    shorts,
    channels,
    guideChannels,
    continuation,
    hasMore: continuation !== null,
    loading,
    loadingMore,
    loadMoreFailed,
    error,
    lastLoadedAt,
    refresh,
    loadMore,
  };
}
