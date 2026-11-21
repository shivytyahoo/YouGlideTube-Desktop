import { isDeepGlideCurrentlyActive } from "../deepGlide";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeBackend } from "./errors";
import { isTauriEnv } from "./env";
import type { VideoSummary } from "../../types/video";

export type HomeOriginKind = "subscription" | "related" | "search" | "channelMemory" | "neighbour" | "server";

/** Why a card is on Home. A neighbour's detail holds up to two channel names joined by "|". */
export interface HomeOrigin {
  kind: HomeOriginKind;
  detail?: string;
}

export interface HomeCard extends VideoSummary {
  publishedAtMs: number;
}

export interface HomeSnapshot {
  generation: number;
  cards: HomeCard[];
  origins: Record<string, HomeOrigin>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreFailed: boolean;
  error: string | null;
}

export const EMPTY_HOME_SNAPSHOT: HomeSnapshot = {
  generation: 0,
  cards: [],
  origins: {},
  loading: false,
  loadingMore: false,
  hasMore: false,
  loadMoreFailed: false,
  error: null,
};

export async function openHomeFeed(): Promise<HomeSnapshot> {
  if (!(await isTauriEnv())) return EMPTY_HOME_SNAPSHOT;
  return invokeBackend<HomeSnapshot>("home_feed_open");
}

export async function refreshHomeFeed(): Promise<HomeSnapshot> {
  if (!(await isTauriEnv())) return EMPTY_HOME_SNAPSHOT;
  return invokeBackend<HomeSnapshot>("home_feed_refresh");
}

export async function reportHomeViewport(lastVisible: number): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_viewport", { lastVisible });
}

export async function setHomeFeedVisible(visible: boolean): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_visible", { visible });
}

export async function retryHomeLoadMore(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_retry_more");
}

/** Forgets Home's feed and caches, so the next visit is ranked by the brain as it is now. */
export async function clearHomeFeed(): Promise<void> {
  if (!(await isTauriEnv())) return;
  await invokeBackend<void>("home_feed_clear");
}

export async function onHomeFeedChanged(handler: (snapshot: HomeSnapshot) => void): Promise<UnlistenFn> {
  if (!(await isTauriEnv())) return () => {};
  return listen<HomeSnapshot>("home-feed", (event) => handler(event.payload));
}

/** A mix: the seed video, then what plays well after it. Played as a queue. */
export interface HomeMix {
  seed: VideoSummary;
  videos: VideoSummary[];
}

export interface ChipFeed {
  cards: HomeCard[];
  mixes: HomeMix[];
  failed: boolean;
}

/** One of the server home feed's own topic chips: tapping it browses the feed with `params`. */
export interface ServerChip {
  label: string;
  params: string | null;
}

/** The chips to offer, and which fixed ones have something to show. */
export interface HomeChips {
  hasMixes: boolean;
  hasWatched: boolean;
  /** Chips whose latest result was empty, left out until it expires. */
  empty: string[];
  /** The server home feed's topic chips, from its latest page. */
  serverChips: ServerChip[];
}

export const NO_HOME_CHIPS: HomeChips = { hasMixes: false, hasWatched: false, empty: [], serverChips: [] };

export async function getHomeChips(): Promise<HomeChips> {
  if (!(await isTauriEnv())) return NO_HOME_CHIPS;
  return invokeBackend<HomeChips>("home_feed_chips");
}

/** A chip's own content: `new`, `recent`, `mixes`, `live`, `watched`, or `server:<label>`. */
export async function getHomeChipFeed(key: string, refresh: boolean): Promise<ChipFeed> {
  if (!(await isTauriEnv())) return { cards: [], mixes: [], failed: false };
  return invokeBackend<ChipFeed>("home_chip_feed", { key, refresh });
}

/** Counts cards the viewer actually saw, once per app session, so the Home
 * feed can note neighbour impressions and the seen-set stays accurate. */
export async function recordFeedImpressions(videos: VideoSummary[]): Promise<void> {
  if (isDeepGlideCurrentlyActive()) return;
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("record_feed_impressions", { videos });
}
