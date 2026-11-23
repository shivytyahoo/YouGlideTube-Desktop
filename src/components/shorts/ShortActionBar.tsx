import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Ban,
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  EyeOff,
  MessageCircle,
  MoreVertical,
  Share2,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { useVideoReactions } from "../../lib/useVideoReactions";
import { useExitGhost } from "../../lib/useExitGhost";
import { useUiStore } from "../../store/useUiStore";
import { showSaveFailedToast, showSaveToast, type SaveDestination } from "../../lib/saveToast";
import { useDownloadStore } from "../../store/useDownloadStore";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { useWatchLaterStore } from "../../store/useWatchLaterStore";
import { getAccountSignedIn } from "../../lib/api/account";
import { GOOGLE_ACCOUNT_SWITCHED_EVENT, GOOGLE_SIGN_IN_COMPLETED_EVENT } from "../../lib/useGoogleAccount";
import {
  isShortSaved,
  removeShortFromLibrary,
  saveShortToLibrary,
} from "../../lib/savedShortsLibrary";
import { useChannelAvatar } from "../../lib/useChannelAvatar";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { dontRecommendLabel } from "../../lib/dontRecommendLabel";
import { getString } from "../../lib/i18n/index";
import { formatCount, parseCountText } from "../../lib/utils";
import { youtubeShortsUrl } from "../../lib/youtubeUrl";
import { copyText, shareLink } from "../../lib/clipboard";
import type { ShortItem, ShortsPanelState } from "../../types/shorts";
import type { ShortVideoSummary, VideoDetails, VideoSummary } from "../../types/video";
import type { RydData } from "../../lib/api/foss";
import { useOriginalTitle } from "../../lib/useOriginalTitle";

interface ShortActionBarProps {
  short: ShortItem;
  details?: VideoDetails | null;
  rydData?: RydData | null;
  commentCountText?: string | null;
  onRequestPanel: (panel: ShortsPanelState) => void;
  onRequestAdvance?: () => void;
  onMoreLikeThis: () => void;
  /** Filled with what a double click on the video does: like it, never take a like back. */
  likeFromSurfaceRef: MutableRefObject<() => void>;
  /** Simple mode hides the labels under the rail buttons. */
  showRailLabels?: boolean;
  /** Simple mode confirms a save with a toast, because the rail has no label to change. */
  toastOnSave?: boolean;
  /** Whether the reel is playing: the sound disc spins while it is. */
  isPlaying?: boolean;
}

export function ShortActionBar({
  short,
  details,
  rydData,
  commentCountText,
  onRequestPanel,
  onRequestAdvance,
  onMoreLikeThis,
  likeFromSurfaceRef,
  showRailLabels = true,
  toastOnSave = true,
  isPlaying = false,
}: ShortActionBarProps) {
  const showToast = useUiStore((s) => s.showToast);
  const notInterestedAction = useFeedActionsStore((s) => s.notInterested);
  const undoNotInterested = useFeedActionsStore((s) => s.undoNotInterested);
  const blockChannelAction = useFeedActionsStore((s) => s.blockChannel);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  // Signed in, the save goes to the account's server Watch Later, as on
  // Android; signed out it stays in the local saved-shorts library.
  const [signedIn, setSignedIn] = useState(false);
  const watchLaterIds = useWatchLaterStore((s) => s.ids);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void getAccountSignedIn()
        .then((value) => {
          if (live) setSignedIn(value);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener(GOOGLE_SIGN_IN_COMPLETED_EVENT, refresh);
    window.addEventListener(GOOGLE_ACCOUNT_SWITCHED_EVENT, refresh);
    return () => {
      live = false;
      window.removeEventListener(GOOGLE_SIGN_IN_COMPLETED_EVENT, refresh);
      window.removeEventListener(GOOGLE_ACCOUNT_SWITCHED_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    if (signedIn) void useWatchLaterStore.getState().load();
  }, [signedIn]);
  const savedToWatchLater = watchLaterIds.has(short.id);
  const saved = signedIn ? savedToWatchLater : savedToLibrary;
  const fetchedAvatar = useChannelAvatar(short.channelId ?? null);
  const discAvatar = useProxiedImageUrl(
    upgradeAvatarUrl(short.channelAvatarUrl ?? fetchedAvatar),
  );
  const resolvedCommentCountText = formatCount(commentCountText ?? short.commentCountText) || getString('settings_comments');
  const originalTitle = useOriginalTitle(short.id);
  const resolvedTitle = originalTitle || details?.title?.trim() || short.title || getString('shorts_short');
  const resolvedChannelName = details?.channelName?.trim() || short.channelName;
  const resolvedChannelId = details?.channelId ?? short.channelId ?? null;
  const resolvedThumbnailUrl = details?.thumbnailUrl ?? short.thumbnailUrl;

  const video = useMemo<VideoSummary>(
    () => ({
      id: short.id,
      title: resolvedTitle,
      channelName: resolvedChannelName,
      channelId: resolvedChannelId,
      thumbnailUrl: resolvedThumbnailUrl,
      durationSeconds: details?.durationSeconds ?? 60,
      publishedText: details?.publishedText ?? short.publishedText ?? null,
      viewCountText: details?.viewCountText ?? short.viewCountText ?? null,
      channelAvatarUrl: short.channelAvatarUrl ?? null,
      isLive: false,
    }),
    [
      details?.durationSeconds,
      details?.publishedText,
      details?.viewCountText,
      resolvedChannelId,
      resolvedChannelName,
      resolvedThumbnailUrl,
      resolvedTitle,
      short,
    ],
  );
  const savedShort = useMemo<ShortVideoSummary>(
    () => ({
      type: "short",
      id: short.id,
      title: resolvedTitle,
      channelName: resolvedChannelName || null,
      channelId: resolvedChannelId,
      thumbnailUrl: resolvedThumbnailUrl,
      channelAvatarUrl: short.channelAvatarUrl ?? null,
      viewCountText: details?.viewCountText ?? short.viewCountText ?? null,
      publishedText: details?.publishedText ?? short.publishedText ?? null,
    }),
    [
      details?.publishedText,
      details?.viewCountText,
      resolvedChannelId,
      resolvedChannelName,
      resolvedThumbnailUrl,
      resolvedTitle,
      short,
    ],
  );
  const { state, like, dislike, likeDelta, dislikeDelta } = useVideoReactions(video, {
    channelId: short.channelId ?? null,
    likeParams: details?.likeParams ?? null,
    removeLikeParams: details?.removeLikeParams ?? null,
    dislikeParams: details?.dislikeParams ?? null,
    removeDislikeParams: details?.removeDislikeParams ?? null,
  });
  // A server-confirmed like in this session moves the displayed count,
  // like Android's likeCountDelta. An unparseable snapshot keeps its text.
  // The delta applies to the fallback snapshot too: without Return YouTube
  // Dislike data a confirmed like otherwise never moves the number.
  const fallbackLikeCount = parseCountText(short.likeCountText ?? details?.likeCountText);
  const likeCount = rydData
    ? rydData.likes + likeDelta
    : fallbackLikeCount === null
      ? null
      : fallbackLikeCount + likeDelta;
  const likeCountText = likeCount !== null
    ? formatCount(likeCount)
    : formatCount(short.likeCountText ?? details?.likeCountText) || getString('like');
  // A server-confirmed dislike in this session moves the displayed count,
  // like Android's dislikeCountDelta.
  const dislikeCountText = rydData ? formatCount(rydData.dislikes + dislikeDelta) : "Dislike";
  useEffect(() => {
    likeFromSurfaceRef.current = () => {
      if (state !== "liked") like();
    };
  });

  useEffect(() => {
    let active = true;
    isShortSaved(short.id)
      .then((saved) => {
        if (active) setSavedToLibrary(saved);
      })
      .catch((error) => console.warn("Failed to read saved Short state", error));

    return () => {
      active = false;
    };
  }, [short.id]);

  const copyLink = async () => {
    setMenuOpen(false);
    const copied = await copyText(youtubeShortsUrl(short.id));
    showToast({
      variant: copied ? "success" : "error",
      message: getString(copied ? "shorts_link_copied" : "share_link_copy_failed"),
    });
  };

  const shareShort = async () => {
    const result = await shareLink(resolvedTitle, youtubeShortsUrl(short.id));
    if (result === "shared") return;
    showToast({
      variant: result === "copied" ? "success" : "error",
      message: getString(result === "copied" ? "shorts_link_copied" : "share_link_copy_failed"),
    });
  };

  const moreLikeThis = () => {
    setMenuOpen(false);
    onMoreLikeThis();
    showToast({ variant: "success", message: getString("shorts_showing_more_like_this") });
  };

  const notInterested = () => {
    setMenuOpen(false);
    void notInterestedAction(video).catch(() => showToast({ variant: "error", message: getString("feed_action_failed") }));
    showToast({
      variant: "success",
      message: getString("shorts_not_interested"),
      actions: [{ label: getString("undo"), onSelect: () => undoNotInterested(video) }],
    });
    onRequestAdvance?.();
  };

  const dontRecommendChannel = () => {
    setMenuOpen(false);
    if (!short.channelId) return;
    void blockChannelAction(video).catch(() => showToast({ variant: "error", message: getString("feed_action_failed") }));
    showToast({ variant: "success", message: getString("shorts_channel_not_recommended") });
    onRequestAdvance?.();
  };

  const toggleSavedShort = async () => {
    setMenuOpen(false);
    const removing = saved;
    const item = { title: savedShort.title, image: savedShort.thumbnailUrl, shape: "portrait" as const };
    const destination: SaveDestination = signedIn ? { kind: "watchLater" } : { kind: "savedShorts" };
    try {
      if (signedIn) {
        const store = useWatchLaterStore.getState();
        if (removing) {
          await store.remove(short.id);
        } else {
          await store.add(video);
        }
        if (toastOnSave) {
          showSaveToast({
            destination,
            item,
            removed: removing,
            undo: async () => {
              if (removing) await useWatchLaterStore.getState().add(video);
              else await useWatchLaterStore.getState().remove(short.id);
            },
          });
        }
        return;
      }

      if (removing) {
        await removeShortFromLibrary(short.id);
        setSavedToLibrary(false);
        if (toastOnSave) {
          showSaveToast({
            destination,
            item,
            removed: true,
            undo: async () => {
              await saveShortToLibrary(savedShort);
              setSavedToLibrary(true);
            },
          });
        }
        return;
      }

      await saveShortToLibrary(savedShort);
      setSavedToLibrary(true);
      if (toastOnSave) {
        showSaveToast({
          destination,
          item,
          undo: async () => {
            await removeShortFromLibrary(short.id);
            setSavedToLibrary(false);
          },
        });
      }
    } catch (error) {
      console.error("Failed to update saved Shorts", error);
      showSaveFailedToast({ destination, item, removed: removing, retry: toggleSavedShort });
    }
  };

  const downloadShort = () => {
    setMenuOpen(false);
    useDownloadStore.getState().openVideo(video);
  };

  const label = (text?: string) => (showRailLabels ? text : undefined);

  return (
    <motion.div layout className="mb-4 flex w-[260px] flex-col items-start gap-5 lg:w-[280px]">
      <ActionButton
        ariaLabel={getString('like')}
        active={state === "liked"}
        countText={label(likeCountText)}
        onClick={like}
        icon={<ThumbsUp className="h-6 w-6" fill={state === "liked" ? "currentColor" : "none"} />}
      />
      <ActionButton
        ariaLabel={getString('watch_dislike')}
        active={state === "disliked"}
        countText={label(dislikeCountText)}
        onClick={dislike}
        icon={<ThumbsDown className="h-6 w-6" fill={state === "disliked" ? "currentColor" : "none"} />}
      />
      <ActionButton
        ariaLabel={getString('settings_comments')}
        countText={label(resolvedCommentCountText)}
        onClick={() => onRequestPanel("comments")}
        icon={<MessageCircle className="h-6 w-6" />}
      />
      <ActionButton
        ariaLabel={getString('share')}
        countText={label("Share")}
        onClick={shareShort}
        icon={<Share2 className="h-6 w-6" />}
      />

      <div className="relative">
        <ActionButton
          ariaLabel={getString('more_options')}
          active={menuOpen}
          countText={label("More")}
          onClick={() => setMenuOpen((open) => !open)}
          icon={<MoreVertical className="h-6 w-6" />}
        />
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <MoreMenu>
              <MenuItem icon={saved ? BookmarkCheck : Bookmark} onClick={() => void toggleSavedShort()}>
                {getString(
                  signedIn
                    ? saved
                      ? "video_remove_from_watch_later"
                      : "video_save_to_watch_later"
                    : saved
                      ? "shorts_menu_remove_from_library"
                      : "shorts_menu_save_to_library",
                )}
              </MenuItem>
              <MenuItem icon={Download} onClick={downloadShort}>{getString("shorts_menu_download")}</MenuItem>
              <MenuItem icon={ThumbsUp} onClick={moreLikeThis}>{getString("shorts_menu_more_like_this")}</MenuItem>
              <MenuItem icon={Ban} danger onClick={notInterested}>{getString("shorts_menu_not_interested")}</MenuItem>
              {short.channelId && (
                <MenuItem icon={EyeOff} danger onClick={dontRecommendChannel}>
                  {dontRecommendLabel(short.channelName)}
                </MenuItem>
              )}
              <MenuItem icon={Copy} onClick={copyLink}>{getString("shorts_menu_copy_link")}</MenuItem>
            </MoreMenu>
          </>
        )}
      </div>

      {/* The sound disc: the channel avatar spinning once every 4s while the reel plays. */}
      {discAvatar ? (
        <img
          src={discAvatar}
          alt=""
          aria-hidden="true"
          className="h-9 w-9 rounded-full object-cover ring-2 ring-chrome-white/25"
          style={{ animation: "spin 4s linear infinite", animationPlayState: isPlaying ? "running" : "paused" }}
        />
      ) : (
        <div className="grid h-9 w-9 place-items-center rounded-full bg-surface-container-high text-sm font-bold text-chrome-neutral-300 ring-2 ring-chrome-white/25">
          {(short.channelName || "?").charAt(0).toUpperCase()}
        </div>
      )}
    </motion.div>
  );
}

function ActionButton({
  icon,
  countText,
  active,
  ariaLabel,
  onClick,
}: {
  icon: ReactNode;
  countText?: string;
  active?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={`flex h-14 w-14 items-center justify-center rounded-full border border-chrome-white/10 bg-chrome-black/60 text-chrome-white transition-colors duration-200 ease-out hover:bg-chrome-black/80 ${
          active ? "text-primary" : ""
        }`}
      >
        {icon}
      </button>
      {countText !== undefined && (
        <span className="mt-1 mb-2 h-4 text-xs font-semibold text-chrome-neutral-300">
          {countText}
        </span>
      )}
    </div>
  );
}

function MoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref);
  return (
    <div
      ref={ref}
      style={{ transformOrigin: "bottom right" }}
      className="animate-menu-in absolute bottom-2 end-16 z-20 w-64 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1"
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  danger = false,
  onClick,
  children,
}: {
  icon: LucideIcon;
  /** Removes or hides something. */
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-container-highest ${
        danger ? "text-chrome-red-400" : "text-chrome-neutral-200"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${danger ? "" : "text-chrome-neutral-400"}`} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
