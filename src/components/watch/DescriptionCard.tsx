import { useState } from "react";
import { formatCount } from "../../lib/utils";
import { getPlural, getString } from "../../lib/i18n/index";
import { hasTextSelection } from "../../lib/textSelection";
import { LinkedText } from "./LinkedText";
import { DescriptionExtras } from "./DescriptionExtras";
import { DescriptionTags } from "./DescriptionTags";
import { ChevronRight, Copy, ListVideo, ScrollText, ThumbsUp } from "lucide-react";
import { copyText } from "../../lib/clipboard";
import { useUiStore } from "../../store/useUiStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { rememberView } from "../../lib/chaptersPanelMemory";
import type { DescriptionCardProps } from "./types";
import { formatUploadDate } from "../../lib/publishedDate";
import { useDateDisplaySettings } from "../../lib/useDateDisplaySettings";

// A live stream's count is YouTube's own "197 watching now", shown as sent.
const formatViews = (views: string | number | null | undefined, isLive: boolean) => {
  if (isLive && typeof views === "string" && views) return views;
  return getString("watch_view_count", views ? formatCount(views) : "0");
};

async function copyDescription(description: string) {
  const copied = await copyText(description);
  useUiStore.getState().showToast({
    variant: copied ? "success" : "error",
    message: getString(copied ? "watch_description_copied" : "watch_description_copy_failed"),
  });
}

export function DescriptionCard({ currentVideo, videoData }: DescriptionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const dateSettings = useDateDisplaySettings();
  const setIsChaptersPanelOpen = usePlayerStore((s) => s.setIsChaptersPanelOpen);
  const captions = usePlayerStore((s) => s.captions);

  const description = videoData?.description || "";
  const viewCount = videoData?.viewCountText || currentVideo.viewCountText || null;
  const likeCount = videoData?.likeCountText || null;
  const chapters = videoData?.chapters || [];
  const hasTranscript = captions.length > 0;

  const openChaptersPanel = (tab: "chapters" | "transcript") => {
    // The panel restores the remembered tab when it mounts, so the row lands on it.
    rememberView(currentVideo.id, { tab, captionId: captions[0]?.id ?? "off" });
    setIsChaptersPanelOpen(true);
  };
  const publishedRaw = videoData?.publishedText || currentVideo.publishedText || "";
  const published = publishedRaw
    ? formatUploadDate(publishedRaw, dateSettings, "watch", {
        timestampMs: currentVideo.publishedAt ?? currentVideo.publishedAtMs ?? null,
      })
    : "";

  return (
    <div
      onClick={() => {
        if (!hasTextSelection()) setExpanded((value) => !value);
      }}
      className="cursor-pointer rounded-xl bg-surface-container-low p-4 text-sm transition-colors hover:bg-surface-container"
    >
      <div className="flex items-center gap-2 font-medium text-chrome-neutral-200">
        <span>{formatViews(viewCount, Boolean(videoData?.isLive))}</span>
        {likeCount && (
          <span
            title={getString("watch_description_likes")}
            className="flex items-center gap-1 text-chrome-neutral-200"
          >
            <ThumbsUp size={13} className="text-chrome-neutral-400" />
            {likeCount}
          </span>
        )}
        {published && (
          <span className="text-chrome-neutral-400" title={videoData?.relativePublishedText ?? undefined}>
            {published}
          </span>
        )}
      </div>

      <div className={`mt-2 select-text whitespace-pre-wrap text-chrome-neutral-300 ${expanded ? "" : "line-clamp-3"}`}>
        {description ? (
          <LinkedText text={description} rich={videoData?.descriptionRich} />
        ) : (
          <span className="text-chrome-neutral-500">{getString("watch_no_description")}</span>
        )}
      </div>

      {expanded && videoData?.descriptionExtras && <DescriptionExtras extras={videoData.descriptionExtras} />}

      {expanded && (chapters.length > 0 || hasTranscript) && (
        <div className="mt-3 space-y-1 border-t border-chrome-neutral-800 pt-3">
          {chapters.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openChaptersPanel("chapters");
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-container-high"
            >
              <ListVideo size={18} className="shrink-0 text-chrome-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-chrome-neutral-100">
                  {getString("watch_description_chapters")}
                </span>
                <span className="block text-xs text-chrome-neutral-400">
                  {getPlural("watch_description_chapters_count", chapters.length)}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-chrome-neutral-500 rtl:-scale-x-100" />
            </button>
          )}
          {hasTranscript && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openChaptersPanel("transcript");
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-surface-container-high"
            >
              <ScrollText size={18} className="shrink-0 text-chrome-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-chrome-neutral-100">
                  {getString("watch_description_transcript")}
                </span>
                <span className="block text-xs text-chrome-neutral-400">
                  {getString("watch_description_transcript_subtitle")}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-chrome-neutral-500 rtl:-scale-x-100" />
            </button>
          )}
        </div>
      )}

      {expanded && <DescriptionTags tags={videoData?.tags} category={videoData?.category} />}

      {expanded && description && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void copyDescription(description);
          }}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          <Copy size={14} />
          {getString("watch_copy_description")}
        </button>
      )}

      {description && (
        <span className="mt-2 inline-block font-medium text-chrome-neutral-400">
          {expanded ? getString("watch_show_less") : getString("watch_show_more")}
        </span>
      )}
    </div>
  );
}
