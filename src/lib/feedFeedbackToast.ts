import { getString } from "./i18n/index";
import { useFeedActionsStore } from "../store/useFeedActionsStore";
import { useUiStore } from "../store/useUiStore";
import type { VideoSummary } from "../types/video";

/** "Got it! You'll see less content like this." — Undo takes the mark back. */
export function showNotInterestedToast(video: VideoSummary): void {
  useUiStore.getState().showToast({
    variant: "success",
    message: getString("not_interested_toast"),
    actions: [
      {
        label: getString("undo"),
        onSelect: () => useFeedActionsStore.getState().undoNotInterested(video),
      },
    ],
  });
}

/** "Got it! You'll see more content like this." */
export function showInterestedToast(): void {
  useUiStore.getState().showToast({ variant: "success", message: getString("i_like_this_toast") });
}
