import { profileStorage } from "./storage/profileStorage";

const ORDER_KEY_PREFIX = "youglidetube_server_playlist_order_";

/**
 * An account playlist's own order, kept on this device: Android's
 * `reorderVideos` is a no-op for account playlists — there is no reorder
 * API — so the viewer's drag is a local custom order, never a server write.
 */
export function loadServerPlaylistOrder(playlistId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(
      profileStorage.getItem(`${ORDER_KEY_PREFIX}${playlistId}`) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveServerPlaylistOrder(playlistId: string, videoIds: string[]): void {
  try {
    profileStorage.setItem(`${ORDER_KEY_PREFIX}${playlistId}`, JSON.stringify(videoIds));
  } catch (error) {
    console.error("Failed to persist the playlist order", error);
  }
}

/** Placed rows first, in the viewer's order; anything not placed yet follows in the account's order. */
export function applyServerPlaylistOrder<T extends { id: string }>(videos: T[], order: string[]): T[] {
  if (order.length === 0) return videos;
  const place = new Map(order.map((id, index) => [id, index]));
  const unplaced = Number.MAX_SAFE_INTEGER;
  return [...videos].sort(
    (a, b) => (place.get(a.id) ?? unplaced) - (place.get(b.id) ?? unplaced),
  );
}
