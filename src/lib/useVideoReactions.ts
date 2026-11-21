import { useEffect, useMemo, useState } from "react";
import { isMusicVideo } from "./utils";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import { mergeLikedItems, useLikesStore } from "../store/useLikesStore";
import { useUiStore } from "../store/useUiStore";
import { showSaveFailedToast, showSaveToast } from "./saveToast";
import type { VideoSummary } from "../types/video";
import { recapAction, recapDislike, recapDislikeRemoved } from "./recap/recapQueue";
import { getAccountSignedIn, setVideoLiked } from "./api/account";
import { normalizeBackendError } from "./api/errors";
import { getString } from "./i18n/index";

export type ReactionState = "none" | "liked" | "disliked";

interface ReactionVideoMeta {
  description?: string | null;
  channelId?: string | null;
  /** Button-issued token for `like/like`, from the watch answer. */
  likeParams?: string | null;
  /** Button-issued token for `like/removelike`. */
  removeLikeParams?: string | null;
}

/**
 * Like/dislike for the active video. The local library toggles instantly,
 * and — when signed in — the like is confirmed on the Google account
 * (`like/like` / `like/removelike`, WEB_REMIX). There is no account
 * dislike endpoint: a dislike at least removes the account like, as
 * Android does. A server failure rolls the local toggle back and shows an
 * error toast instead of leaving the UI and the account out of sync.
 * `likeDelta` is +1 only after a server-confirmed like in this session,
 * so the displayed like count can move like Android's `likeCountDelta`.
 */
export function useVideoReactions(video: VideoSummary | null, videoMeta: ReactionVideoMeta | null) {
  const [state, setState] = useState<ReactionState>("none");
  const [likeDelta, setLikeDelta] = useState(0);
  const localItems = useLikesStore((s) => s.items);
  const serverItems = useLikesStore((s) => s.serverItems);
  // A video liked on the phone is liked here too, so the button follows
  // the account, not just this device's copy.
  const items = useMemo(
    () => mergeLikedItems(serverItems, localItems),
    [localItems, serverItems],
  );
  const loaded = useLikesStore((s) => s.loaded);
  const loadLikes = useLikesStore((s) => s.load);
  const loadServerLikes = useLikesStore((s) => s.loadServer);
  const toggleVideoLike = useLikesStore((s) => s.toggleVideo);
  const hideVideo = useFeedActionsStore((s) => s.hideVideo);

  const likedInLibrary = Boolean(
    video && items.some((item) => item.kind === "video" && item.id === video.id),
  );

  useEffect(() => {
    if (!loaded) void loadLikes();
  }, [loadLikes, loaded]);

  useEffect(() => {
    void loadServerLikes();
  }, [loadServerLikes]);

  // A new video starts from the library; the delta only lives for this video.
  // `likedInLibrary` is deliberately not a dependency: this resets only when
  // the video changes, not when the library does.
  useEffect(() => {
    setState(likedInLibrary ? "liked" : "none");
    setLikeDelta(0);
  }, [video?.id]);

  // The library stays the source of truth for likes — except an explicit
  // dislike, which the library cannot express: removing the local like
  // after a dislike must not flip the button back to unmarked.
  useEffect(() => {
    setState((prev) => (prev === "disliked" ? prev : likedInLibrary ? "liked" : "none"));
  }, [likedInLibrary]);

  const channelId = videoMeta?.channelId || video?.channelId || video?.id || "";
  // The like call carries the button-issued token when the watch answer
  // gave one: liking sends `likeParams`, unliking `removeLikeParams`.
  // The server refuses the call without its token.
  const likeParamsFor = (liked: boolean) =>
    liked ? videoMeta?.likeParams ?? null : videoMeta?.removeLikeParams ?? null;

  const like = async () => {
    if (!video) return;
    const signedIn = await getAccountSignedIn().catch(() => false);
    const next: ReactionState = likedInLibrary ? "none" : "liked";
    setState(next);
    const likedVideo = { ...video, channelId };
    const item = { title: video.title, image: video.thumbnailUrl, shape: "landscape" as const };
    void toggleVideoLike(likedVideo).then((nowLiked) => {
      if (!signedIn) {
        showSaveToast({
          destination: { kind: "likes" },
          item,
          removed: !nowLiked,
          undo: () => toggleVideoLike(likedVideo),
        });
        return;
      }
      void setVideoLiked(video.id, nowLiked, likeParamsFor(nowLiked)).then((ok) => {
        if (!ok) throw new Error("server declined the like");
        setLikeDelta(nowLiked ? 1 : 0);
        showSaveToast({
          destination: { kind: "likes" },
          item,
          removed: !nowLiked,
          undo: () => {
            void toggleVideoLike(likedVideo);
            void setVideoLiked(video.id, !nowLiked, likeParamsFor(!nowLiked)).catch((err) =>
              console.warn("Failed to undo the account like", err),
            );
          },
        });
      }).catch((err) => {
        console.warn("Failed to save the like on the account", err);
        void toggleVideoLike(likedVideo);
        setState(likedInLibrary ? "liked" : "none");
        useUiStore.getState().showToast({
          variant: "error",
          message: `${getString(nowLiked ? "account_like_failed" : "account_dislike_failed")}: ${normalizeBackendError(err).message}`,
        });
      });
    }).catch((err) => {
      console.warn("Failed to update likes", err);
      setState(likedInLibrary ? "liked" : "none");
      showSaveFailedToast({ destination: { kind: "likes" }, item, removed: likedInLibrary });
    });
    if (next !== "liked" || isMusicVideo(video)) return;
    recapAction("LIKE");
  };

  const dislike = async () => {
    if (!video) return;
    const signedIn = await getAccountSignedIn().catch(() => false);
    const next: ReactionState = state === "disliked" ? "none" : "disliked";
    setState(next);
    if (next !== "disliked") {
      recapDislikeRemoved(video.id);
      return;
    }
    // A dislike always removes the account like, as Android does — even
    // when the video was never in this device's library. The local like
    // comes off first when there is one; the server call runs either way.
    const removeLocalLike = likedInLibrary
      ? toggleVideoLike({ ...video, channelId }).catch((err) => {
          console.warn("Failed to remove disliked video from likes", err);
        })
      : Promise.resolve(true);
    void removeLocalLike.then(() => {
      if (!signedIn) return;
      void setVideoLiked(video.id, false, likeParamsFor(false)).then((ok) => {
        if (ok) {
          setLikeDelta(0);
          return;
        }
        throw new Error("server declined the unlike");
      }).catch((err) => {
        console.warn("Failed to remove the account like", err);
        if (likedInLibrary) {
          void toggleVideoLike({ ...video, channelId });
          setState("liked");
        } else {
          setState("none");
        }
        useUiStore.getState().showToast({
          variant: "error",
          message: `${getString("account_dislike_failed")}: ${normalizeBackendError(err).message}`,
        });
      });
    });
    if (isMusicVideo(video)) return;
    recapDislike(video);
    hideVideo(video.id);
  };

  return { state, like, dislike, likeDelta };
}
