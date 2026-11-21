import { useEffect, useState } from "react";
import { isMusicVideo } from "./utils";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import { useLikesStore } from "../store/useLikesStore";
import { showSaveFailedToast, showSaveToast } from "./saveToast";
import type { VideoSummary } from "../types/video";
import { recapAction, recapDislike, recapDislikeRemoved } from "./recap/recapQueue";

export type ReactionState = "none" | "liked" | "disliked";

interface ReactionVideoMeta {
  description?: string | null;
  channelId?: string | null;
}

/**
 * Local like/dislike toggle for the active video. A like is recorded in the
 * recap ledger; a dislike also hides the video from every feed.
 */
export function useVideoReactions(video: VideoSummary | null, videoMeta: ReactionVideoMeta | null) {
  const [state, setState] = useState<ReactionState>("none");
  const items = useLikesStore((s) => s.items);
  const loaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const toggleVideoLike = useLikesStore((s) => s.toggleVideo);
  const hideVideo = useFeedActionsStore((s) => s.hideVideo);

  const likedInLibrary = Boolean(
    video && items.some((item) => item.kind === "video" && item.id === video.id),
  );

  useEffect(() => {
    if (!loaded) void loadLikes();
  }, [loadLikes, loaded]);

  useEffect(() => {
    setState(likedInLibrary ? "liked" : "none");
  }, [likedInLibrary, video?.id]);

  const channelId = videoMeta?.channelId || video?.channelId || video?.id || "";

  const like = () => {
    if (!video) return;
    const next: ReactionState = likedInLibrary ? "none" : "liked";
    setState(next);
    const likedVideo = { ...video, channelId };
    const item = { title: video.title, image: video.thumbnailUrl, shape: "landscape" as const };
    void toggleVideoLike(likedVideo).then((nowLiked) => {
      showSaveToast({
        destination: { kind: "likes" },
        item,
        removed: !nowLiked,
        undo: () => toggleVideoLike(likedVideo),
      });
    }).catch((err) => {
      console.warn("Failed to update likes", err);
      setState(likedInLibrary ? "liked" : "none");
      showSaveFailedToast({ destination: { kind: "likes" }, item, removed: likedInLibrary });
    });
    if (next !== "liked" || isMusicVideo(video)) return;
    recapAction("LIKE");
  };

  const dislike = () => {
    if (!video) return;
    const next: ReactionState = state === "disliked" ? "none" : "disliked";
    setState(next);
    if (next !== "disliked") {
      recapDislikeRemoved(video.id);
      return;
    }
    if (likedInLibrary) {
      void toggleVideoLike({ ...video, channelId }).catch((err) => (
        console.warn("Failed to remove disliked video from likes", err)
      ));
    }
    if (isMusicVideo(video)) return;
    recapDislike(video);
    hideVideo(video.id);
  };

  return { state, like, dislike };
}
