import { Eye, EyeOff, ThumbsDown, ThumbsUp } from "lucide-react";
import { showInterestedToast, showNotInterestedToast } from "../../lib/feedFeedbackToast";
import { getString } from "../../lib/i18n/index";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-chrome-zinc-800 bg-surface-container px-2.5 py-1 text-xs font-medium text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * The card's inline feedback, as on Android: "I want more like this" and
 * "Not interested" fire once, and the trailing eye toggles the watched mark.
 * The menu carries the same actions; this row is the one-tap version of them.
 */
export function VideoCardFeedback({ video, isWatched }: { video: VideoSummary; isWatched: boolean }) {
  const notInterested = useFeedActionsStore((s) => s.notInterested);
  const interested = useFeedActionsStore((s) => s.interested);
  const markWatched = useFeedActionsStore((s) => s.markWatched);
  const markUnwatched = useFeedActionsStore((s) => s.markUnwatched);
  const showToast = useUiStore((s) => s.showToast);
  const feedActionFailed = () => showToast({ variant: "error", message: getString("feed_action_failed") });

  const handleInterested = () => {
    void interested(video).then(showInterestedToast).catch(feedActionFailed);
  };
  const handleNotInterested = () => {
    void notInterested(video)
      .then(() => showNotInterestedToast(video))
      .catch(feedActionFailed);
  };
  const handleWatchedToggle = () => {
    if (isWatched) {
      void markUnwatched(video.id)
        .then(() => showToast({ variant: "success", message: getString("mark_as_unwatched_toast") }))
        .catch(feedActionFailed);
      return;
    }
    void markWatched(video);
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={handleInterested} className={BUTTON_CLASS}>
        <ThumbsUp size={14} aria-hidden="true" />
        {getString("i_like_this")}
      </button>
      <button type="button" onClick={handleNotInterested} className={BUTTON_CLASS}>
        <ThumbsDown size={14} aria-hidden="true" />
        {getString("menu_not_interested")}
      </button>
      <button
        type="button"
        onClick={handleWatchedToggle}
        aria-label={getString(isWatched ? "mark_as_unwatched" : "menu_mark_watched")}
        title={getString(isWatched ? "mark_as_unwatched" : "menu_mark_watched")}
        className={BUTTON_CLASS}
      >
        {isWatched ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
