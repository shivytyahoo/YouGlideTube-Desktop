import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Music2, Play, Plus } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { prefetchStreamInfo } from "../../lib/streamResolution";
import { useChannelAvatar } from "../../lib/useChannelAvatar";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { formatCount } from "../../lib/utils";
import { SubscribeButton } from "../ui/SubscribeButton";
import { toggleSubscription } from "../../lib/accountSubscribe";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import type { ShortItem } from "../../types/shorts";
import type { VideoDetails } from "../../types/video";
import { useOriginalTitle } from "../../lib/useOriginalTitle";

interface ShortMetadataProps {
  short: ShortItem;
  details?: VideoDetails | null;
  onOpenDescription: () => void;
  /** Simple mode swaps the subscribe button for a square icon toggle beside the channel name. */
  subscribeControl?: "button" | "icon";
}

export function ShortMetadata({
  short,
  details,
  onOpenDescription,
  subscribeControl = "button",
}: ShortMetadataProps) {
  const navigate = useNavigate();
  const channelId = short.channelId ?? details?.channelId ?? null;
  const fetchedAvatar = useChannelAvatar(channelId);
  const avatar = useProxiedImageUrl(upgradeAvatarUrl(short.channelAvatarUrl ?? fetchedAvatar));
  const originalTitle = useOriginalTitle(short.id);
  const title = originalTitle || (short.title.trim() && short.title !== "Short" ? short.title : details?.title || short.title);
  const channelName = short.channelName.trim() || details?.channelName || "Unknown channel";
  const viewText = formatCount(short.viewCountText ?? details?.viewCountText);
  const viewStatText = viewText ? `${viewText} views` : null;
  const openChannel = () => short.channelId && navigate(`/channel/${short.channelId}`);
  // The reel overlay names the sound it plays under; without one the pill
  // falls back to the channel's own audio, as before.
  const soundTitle = short.soundTitle?.trim()
    ? short.soundTitle.trim()
    : getString("shorts_original_audio", channelName);

  return (
    <div className="mb-4 flex w-[260px] flex-col gap-4 lg:w-[280px]">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={openChannel}
          className="row-span-2"
        >
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-container-high text-base font-bold text-chrome-neutral-300">
              {channelName.charAt(0).toUpperCase()}
            </div>
          )}
        </button>

        <button dir="auto"
          type="button"
          onClick={openChannel}
          className="truncate text-lg font-bold text-chrome-neutral-100 hover:text-chrome-white"
        >
          {channelName}
        </button>

        {channelId && subscribeControl === "icon" ? (
          <SubscribeIconToggle
            channelId={channelId}
            channelName={channelName}
            avatarUrl={avatar || undefined}
          />
        ) : channelId ? (
          <SubscribeButton
            channelId={channelId}
            channelName={channelName}
            avatarUrl={avatar || undefined}
            size="sm"
            className="!bg-chrome-white !px-4 !py-1.5 !text-sm !font-bold !text-chrome-black hover:!bg-chrome-neutral-200"
          />
        ) : null}
      </div>

      <button dir="auto"
        type="button"
        className="line-clamp-4 text-base leading-relaxed text-chrome-neutral-200 transition-colors hover:text-chrome-white"
        onClick={onOpenDescription}
      >
        {title}
      </button>

      {viewStatText && (
        <span className="w-fit rounded-full bg-chrome-black/60 px-2.5 py-1 text-xs font-semibold text-chrome-neutral-300">
          {viewStatText}
        </span>
      )}

      {short.linkedVideoId && (
        <button
          type="button"
          onClick={() => {
            prefetchStreamInfo(short.linkedVideoId!);
            navigate(`/watch/${short.linkedVideoId}`);
          }}
          className="inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-chrome-black/60 px-3 py-1.5 text-xs font-semibold text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-chrome-black/80 hover:text-chrome-white"
        >
          <Play className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
          <span className="max-w-[220px] truncate lg:max-w-[240px]">
            {short.linkedVideoTitle || getString("shorts_linked_video")}
          </span>
        </button>
      )}

      <div className="inline-flex w-fit items-center gap-2 rounded-full bg-chrome-black/60 px-3 py-1.5 text-xs text-chrome-neutral-300">
        <Music2 className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[220px] truncate lg:max-w-[240px]">
          {soundTitle}
        </span>
      </div>
    </div>
  );
}

/** A square icon toggle beside the channel name: a plus to subscribe, a tick once subscribed. */
function SubscribeIconToggle({
  channelId,
  channelName,
  avatarUrl,
}: {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
}) {
  const subscribed = useSubscriptionStore((state) => state.isSubscribed(channelId));
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label={getString(subscribed ? "subscribed" : "search_subscribe")}
      aria-pressed={subscribed}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void toggleSubscription(channelId, channelName, avatarUrl).finally(() => setBusy(false));
      }}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${
        subscribed
          ? "border-chrome-white/20 bg-chrome-white/10 text-chrome-white"
          : "border-chrome-white bg-chrome-white text-chrome-black hover:bg-chrome-neutral-200"
      } disabled:opacity-60`}
    >
      {subscribed ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
    </button>
  );
}
