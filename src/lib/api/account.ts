import { invoke } from "@tauri-apps/api/core";
import { invokeBackend, type BackendApiError } from "./errors";
import type { PlaylistSummary, VideoSummary } from "../../types/video";

/** One channel of the server subscriptions feed's channel rail. */
export interface ServerChannelSummary {
  channelId: string;
  name: string;
  avatarUrl?: string | null;
  subscriberCountText?: string | null;
}

/** A topic chip exactly as the server feed offers it. */
export interface ServerChip {
  label: string;
  params?: string | null;
}

/** One page of a server-driven feed — subscriptions or history. */
export interface ServerFeedPage {
  videos: VideoSummary[];
  shorts: VideoSummary[];
  channels: ServerChannelSummary[];
  playlists: PlaylistSummary[];
  chips: ServerChip[];
  continuation?: string | null;
  clearHistoryToken?: string | null;
  removeTokens: Record<string, string>;
}

/** One server-history row, as the History screen renders it. */
export interface ServerHistoryEntry {
  videoId: string;
  title: string;
  channelName: string;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  isShort: boolean;
  removeFeedbackToken?: string | null;
  timestampMs: number;
}

/** One page of server history, as flat entries the screen renders. */
export interface ServerHistoryPage {
  entries: ServerHistoryEntry[];
  continuation?: string | null;
  clearHistoryToken?: string | null;
}

/** One row of the merged history: the server list as base, session plays merged in. */
export interface MergedHistoryEntry {
  videoId: string;
  title: string;
  channelName: string;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  /** Seconds watched on this device, 0 when only the server knows the row. */
  positionSeconds: number;
  isShort: boolean;
  timestampMs: number;
  source: "server" | "local";
  removeFeedbackToken?: string | null;
}

/** One Watch Later row: the video plus the playlist-entry id the server needs to remove it. */
export interface WatchLaterItem {
  video: VideoSummary;
  setVideoId?: string | null;
}

/** One page of the server's Watch Later playlist. */
export interface WatchLaterPage {
  title: string;
  videos: WatchLaterItem[];
  continuation?: string | null;
}

/** One page of the account's Liked-videos playlist (`VLLL`). */
export interface LikedVideosPage {
  title: string;
  videos: VideoSummary[];
  continuation?: string | null;
}

/** One saved Google account, as the backend lists it. Display fields only — cookies never leave the backend. */
export interface AccountSummary {
  id: string;
  name?: string | null;
  email?: string | null;
  channelHandle?: string | null;
  thumbnailUrl?: string | null;
  isActive: boolean;
}

/** Every saved Google account, oldest first, with the active one flagged. */
export async function listAccounts(): Promise<AccountSummary[]> {
  return invokeBackend<AccountSummary[]>("list_accounts");
}

/**
 * Makes a saved account the active one. The backend emits
 * `google-account-switched` and the server surfaces reload under it.
 */
export async function switchAccount(id: string): Promise<AccountSummary> {
  return invokeBackend<AccountSummary>("switch_account", { id });
}

/** Opens the Google sign-in window to add another account (works while signed in). */
export async function addAccount(): Promise<void> {
  return invokeBackend<void>("add_account");
}

/**
 * Removes one saved account. Returns the account that is active
 * afterwards, or null when the app is a guest again.
 */
export async function removeAccount(id: string): Promise<AccountSummary | null> {
  return invokeBackend<AccountSummary | null>("remove_account", { id });
}

/** One page of the account's subscriptions feed (`FEsubscriptions`). */
export async function getServerSubscriptions(
  continuation?: string | null,
): Promise<ServerFeedPage> {
  return invokeBackend<ServerFeedPage>("get_server_subscriptions", {
    continuation: continuation ?? null,
  });
}

/**
 * Subscribes or unsubscribes the account to a channel, on the server.
 * Returns whether the server confirmed it.
 */
export async function setChannelSubscribed(
  channelId: string,
  subscribed: boolean,
): Promise<boolean> {
  return invokeBackend<boolean>("set_channel_subscribed", { channelId, subscribed });
}

/**
 * Likes or unlikes a video on the account, on the server. Disliking is
 * the same call with `liked = false`: there is no account dislike
 * endpoint — a dislike at least removes the account like, as Android does.
 */
export async function setVideoLiked(
  videoId: string,
  liked: boolean,
): Promise<boolean> {
  return invokeBackend<boolean>("set_video_liked", { videoId, liked });
}

/** One page of the account's watch history (`FEhistory`), newest first. */
export async function getServerHistory(
  continuation?: string | null,
): Promise<ServerHistoryPage> {
  return invokeBackend<ServerHistoryPage>("get_server_history", {
    continuation: continuation ?? null,
  });
}

/**
 * Merges server history entries with this device's session plays: server
 * entries first in server order, local-only plays appended newest-first.
 */
export async function mergeWatchHistory(
  serverEntries: ServerHistoryEntry[],
): Promise<MergedHistoryEntry[]> {
  return invokeBackend<MergedHistoryEntry[]>("merge_watch_history", { serverEntries });
}

/**
 * Clears the account's watch history on the server and, once the server
 * confirms, wipes the local rows with it. Returns false when there was no
 * token to send or the server refused — the list comes back on the next
 * refresh, so the local rows stay too.
 */
export async function clearServerHistory(
  clearToken?: string | null,
  removeTokens: string[] = [],
): Promise<boolean> {
  return invokeBackend<boolean>("clear_server_history", {
    clearToken: clearToken ?? null,
    removeTokens,
  });
}

/** One page of the account's Watch Later playlist (`VLWL`). */
export async function getWatchLater(
  continuation?: string | null,
): Promise<WatchLaterPage> {
  return invokeBackend<WatchLaterPage>("get_watch_later", {
    continuation: continuation ?? null,
  });
}

/**
 * Saves or unsaves a video in Watch Later, on the server. Removing needs the
 * playlist-entry id (`setVideoId`) from the Watch Later page — the backend
 * answers with a Validation error without it.
 */
export async function setVideoWatchLater(
  videoId: string,
  saved: boolean,
  setVideoId?: string | null,
): Promise<boolean> {
  return invokeBackend<boolean>("set_video_watch_later", {
    videoId,
    saved,
    setVideoId: setVideoId ?? null,
  });
}

/** One page of the account's own playlists (`FEplaylist_aggregation`). */
export async function getServerPlaylists(
  continuation?: string | null,
): Promise<ServerFeedPage> {
  return invokeBackend<ServerFeedPage>("get_server_playlists", {
    continuation: continuation ?? null,
  });
}

/** One page of the account's Liked-videos playlist (`VLLL`). */
export async function getLikedVideos(
  continuation?: string | null,
): Promise<LikedVideosPage> {
  return invokeBackend<LikedVideosPage>("get_liked_videos", {
    continuation: continuation ?? null,
  });
}

/**
 * Creates a playlist on the account and returns its id, as Android's
 * PlaylistsViewModel does. The playlist is private.
 */
export async function createServerPlaylist(title: string): Promise<string> {
  return invokeBackend<string>("create_server_playlist", { title });
}

/** Deletes a playlist from the account. */
export async function deleteServerPlaylist(playlistId: string): Promise<boolean> {
  return invokeBackend<boolean>("delete_server_playlist", { playlistId });
}

/**
 * Renames a playlist on the account. The account API renames only; the
 * description stays as the account has it, as Android does.
 */
export async function renameServerPlaylist(
  playlistId: string,
  name: string,
): Promise<boolean> {
  return invokeBackend<boolean>("rename_server_playlist", { playlistId, name });
}

/** Adds one video to a playlist on the account. */
export async function addVideoToServerPlaylist(
  playlistId: string,
  videoId: string,
): Promise<boolean> {
  return invokeBackend<boolean>("add_video_to_server_playlist", { playlistId, videoId });
}

/** Removes one video from a playlist on the account. */
export async function removeVideoFromServerPlaylist(
  playlistId: string,
  videoId: string,
): Promise<boolean> {
  return invokeBackend<boolean>("remove_video_from_server_playlist", { playlistId, videoId });
}

/**
 * Adds videos to a playlist on the account in one call. Returns the ids
 * the server took.
 */
export async function addVideosToServerPlaylist(
  playlistId: string,
  videoIds: string[],
): Promise<string[]> {
  return invokeBackend<string[]>("add_videos_to_server_playlist", { playlistId, videoIds });
}

/**
 * Removes videos from a playlist on the account in one call. Returns the
 * ids removed; an id the playlist no longer carries is left out.
 */
export async function removeVideosFromServerPlaylist(
  playlistId: string,
  videoIds: string[],
): Promise<string[]> {
  return invokeBackend<string[]>("remove_videos_from_server_playlist", { playlistId, videoIds });
}

/**
 * Whether the backend holds a signed-in Google session. False on any
 * failure (backend down, no session) — callers treat that as signed out
 * and show the guest state rather than failing.
 */
export async function getAccountSignedIn(): Promise<boolean> {
  try {
    const { signedIn } = await invoke<{ signedIn: boolean }>("get_auth_status");
    return signedIn;
  } catch {
    return false;
  }
}

/** The backend's `Validation` kind: a signed-in-only call made while signed out. */
export function isSignedOutError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "kind" in error &&
    (error as BackendApiError).kind === "validation"
  );
}
