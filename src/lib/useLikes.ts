import { useEffect, useMemo } from "react";
import { getHistoryDateLabel, type HistoryDateGroup, type HistoryVideo } from "./useHistory";
import { mergeLikedItems, useLikesStore, type LikedItem, type LikedItemKind } from "../store/useLikesStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

const artistText = (song: SongItem) => (
  song.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown Artist"
);

export const songVideoId = (song?: SongItem | null) => song?.videoId ?? song?.id ?? "";

export function likedSongToHistoryVideo(item: Extract<LikedItem, { kind: "music" }>): HistoryVideo {
  const song = item.song ?? ({} as SongItem);
  return {
    id: songVideoId(song) || item.id,
    title: song.title ?? "",
    channelName: artistText(song),
    thumbnailUrl: song.thumbnail || null,
    durationSeconds: song.duration ?? null,
    publishedText: getHistoryDateLabel(item.likedAt),
    viewCountText: "Liked",
    watchDate: item.likedAt,
    watchProgressPercent: 0,
    isMusic: true,
  };
}

export function likedVideoToHistoryVideo(item: Extract<LikedItem, { kind: "video" }>): HistoryVideo {
  const video = item.video ?? ({ id: item.id, title: "", channelName: "" } as VideoSummary);
  return {
    ...video,
    id: video.id || item.id,
    publishedText: getHistoryDateLabel(item.likedAt),
    viewCountText: video.viewCountText ?? "Liked",
    watchDate: item.likedAt,
    watchProgressPercent: 0,
    isMusic: false,
  };
}

export function likedItemToHistoryVideo(item: LikedItem): HistoryVideo {
  return item.kind === "music"
    ? likedSongToHistoryVideo(item)
    : likedVideoToHistoryVideo(item);
}

export function groupLikedItemsByDate(items: LikedItem[]): HistoryDateGroup[] {
  const groups = new Map<string, HistoryVideo[]>();

  for (const item of items) {
    const label = getHistoryDateLabel(item.likedAt);
    const videos = groups.get(label) ?? [];
    videos.push(likedItemToHistoryVideo(item));
    groups.set(label, videos);
  }

  return Array.from(groups.entries()).map(([dateLabel, videos]) => ({
    dateLabel,
    videos,
  }));
}

export function useLikes() {
  const localItems = useLikesStore((s) => s.items);
  const serverItems = useLikesStore((s) => s.serverItems);
  const loaded = useLikesStore((s) => s.loaded);
  const load = useLikesStore((s) => s.load);
  const loadServer = useLikesStore((s) => s.loadServer);
  const remove = useLikesStore((s) => s.remove);
  const clear = useLikesStore((s) => s.clear);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  useEffect(() => {
    void loadServer();
  }, [loadServer]);

  // The account's likes lead and this device's own likes follow, so a
  // video liked on the phone shows here without waiting for a local copy.
  const items = useMemo(
    () => mergeLikedItems(serverItems, localItems),
    [localItems, serverItems],
  );
  const historyVideos = useMemo(() => items.map(likedItemToHistoryVideo), [items]);
  const groupedLikes = useMemo(() => groupLikedItemsByDate(items), [items]);

  return {
    items,
    historyVideos,
    groupedLikes,
    loading: !loaded,
    removeLikedItem: remove as (kind: LikedItemKind, id: string) => Promise<void>,
    clearLikes: clear,
  };
}

export function videoLikeId(video: VideoSummary) {
  return video.id;
}
