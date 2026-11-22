import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Radio, ShieldCheck, BadgeCheck, ArrowDown, RotateCw, Send, Trash2, X } from "lucide-react";
import { useLiveChat, type ChatView, type LiveChatState } from "../../lib/useLiveChat";
import { useChatReplay } from "../../lib/useChatReplay";
import { deleteLiveChatMessage, sendLiveChatMessage } from "../../lib/api/youtube";
import { useGoogleAccount } from "../../lib/useGoogleAccount";
import { getString } from "../../lib/i18n/index";
import { selectionTouches } from "../../lib/textSelection";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import type { LiveChatMessage, LiveChatSegment } from "../../types/video";
import type { LiveChatProps } from "./types";

function argbToCss(argb?: number | null): string | undefined {
  if (argb == null) return undefined;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  const a = ((argb >>> 24) & 0xff) / 255;
  return `rgba(${r}, ${g}, ${b}, ${a || 1})`;
}

// Rec. 709 luma decides black vs white foreground over a colored super-chat background.
function prefersDarkText(argb?: number | null): boolean {
  if (argb == null) return false;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

function MessageBody({ segments, message }: { segments: LiveChatSegment[]; message: string }) {
  const toSrc = useProxyImageSrc();
  if (!segments?.length) return <>{message}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.emojiImageUrl ? (
          <img
            key={index}
            src={toSrc(segment.emojiImageUrl)}
            alt={segment.text}
            className="inline-block h-[1.15em] w-[1.15em] align-text-bottom"
          />
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function authorNameClass(message: LiveChatMessage): string {
  if (message.isOwner) return "text-chrome-amber-400";
  if (message.isModerator) return "text-chrome-blue-400";
  if (message.isMember) return "text-chrome-emerald-400";
  return "text-chrome-neutral-400";
}

function AuthorBadges({ message }: { message: LiveChatMessage }) {
  const toSrc = useProxyImageSrc();
  return (
    <>
      {message.isModerator && <ShieldCheck size={11} className="shrink-0 text-chrome-blue-400" />}
      {message.isVerified && <BadgeCheck size={11} className="shrink-0 text-chrome-neutral-400" />}
      {message.isMember && message.memberBadgeUrl && (
        <img src={toSrc(message.memberBadgeUrl)} alt="" className="h-3 w-3 shrink-0 rounded-full" />
      )}
    </>
  );
}

function ChatRow({ message }: { message: LiveChatMessage }) {
  const toSrc = useProxyImageSrc();
  if (message.messageType === "superChat") {
    const background = argbToCss(message.superChatArgb);
    const darkText = prefersDarkText(message.superChatArgb);
    return (
      <div
        className="rounded-lg px-3 py-2"
        style={{ backgroundColor: background || "rgba(245, 158, 11, 0.15)" }}
      >
        <div className={`flex items-center justify-between gap-2 text-xs font-bold ${darkText ? "text-chrome-black" : "text-chrome-white"}`}>
          <span dir="auto" className="truncate">{message.author}</span>
          {message.superChatAmount && <span className="shrink-0">{message.superChatAmount}</span>}
        </div>
        {message.message && (
          <div className={`mt-1 break-words text-sm ${darkText ? "text-chrome-black/90" : "text-chrome-white/90"}`}>
            <MessageBody segments={message.segments} message={message.message} />
          </div>
        )}
      </div>
    );
  }

  if (message.messageType === "membership") {
    return (
      <div className="rounded-lg border-s-2 border-chrome-emerald-500/50 bg-chrome-emerald-500/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-chrome-emerald-400">
          <span dir="auto" className="truncate">{message.author}</span>
          <AuthorBadges message={message} />
        </div>
        {message.message && (
          <div className="mt-0.5 break-words text-sm text-chrome-neutral-200">
            <MessageBody segments={message.segments} message={message.message} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-1">
      {message.authorPhotoUrl ? (
        <img
          src={toSrc(message.authorPhotoUrl)}
          alt=""
          className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-surface-container-high" />
      )}
      <p className="min-w-0 break-words text-sm leading-snug text-chrome-neutral-200">
        <span dir="auto"
          className={`me-1.5 inline-flex items-center gap-1 align-middle text-xs font-semibold ${authorNameClass(message)}`}
        >
          {message.author}
          <AuthorBadges message={message} />
        </span>
        <MessageBody segments={message.segments} message={message.message} />
      </p>
    </div>
  );
}

function StreamChat({ videoId, view, channelId, signedIn, ...panel }: ChatPanelSource) {
  const chat = useLiveChat(videoId, true, view);
  return <ChatPanel chat={chat} isReplay={false} view={view} videoId={videoId} channelId={channelId} signedIn={signedIn} {...panel} />;
}

function ReplayChat({ videoId, view, ...panel }: ChatPanelSource) {
  const chat = useChatReplay(videoId, true, view);
  return <ChatPanel chat={chat} isReplay view={view} videoId={videoId} {...panel} />;
}

interface ChatPanelSource {
  videoId: string;
  view: ChatView;
  channelId?: string | null;
  signedIn?: boolean;
  onViewChange: (view: ChatView) => void;
  fill?: boolean;
  onClose?: () => void;
}

/** A live stream's chat, or a finished stream's chat replayed in step with the player. */
export function LiveChat({ videoId, isReplay, fill, onClose }: LiveChatProps) {
  const [view, setView] = useState<ChatView>("top");
  const { status } = useGoogleAccount();
  const channelId = usePlayerStore((s) => s.currentVideo?.channelId);
  return isReplay ? (
    <ReplayChat videoId={videoId} view={view} onViewChange={setView} fill={fill} onClose={onClose} />
  ) : (
    <StreamChat
      videoId={videoId}
      view={view}
      channelId={channelId}
      signedIn={status === "signed-in"}
      onViewChange={setView}
      fill={fill}
      onClose={onClose}
    />
  );
}

function ViewToggle({ view, onViewChange }: { view: ChatView; onViewChange: (view: ChatView) => void }) {
  return (
    <div className="flex items-center rounded-full bg-surface-container p-0.5">
      {(["top", "all"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onViewChange(option)}
          aria-pressed={view === option}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            view === option
              ? "bg-surface-container-highest text-chrome-neutral-100"
              : "text-chrome-neutral-400 hover:text-chrome-neutral-200"
          }`}
        >
          {getString(option === "top" ? "live_chat_view_top" : "live_chat_view_all")}
        </button>
      ))}
    </div>
  );
}

function ChatComposer({ videoId, channelId }: { videoId: string; channelId: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const showToast = useUiStore((s) => s.showToast);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendLiveChatMessage(videoId, channelId, trimmed);
      setText("");
    } catch {
      showToast({ variant: "error", message: getString("live_chat_send_failed") });
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="flex shrink-0 items-center gap-2 border-t border-chrome-neutral-800 px-3 py-2"
    >
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={500}
        placeholder={getString("live_chat_message_placeholder")}
        aria-label={getString("live_chat_message_placeholder")}
        className="min-w-0 flex-1 rounded-full bg-surface-container-high px-3 py-2 text-sm text-chrome-neutral-100 placeholder:text-chrome-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <button
        type="submit"
        disabled={!text.trim() || sending}
        aria-label={getString("live_chat_send")}
        title={getString("live_chat_send")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary transition-colors hover:bg-surface-container-high disabled:opacity-40"
      >
        <Send size={17} />
      </button>
    </form>
  );
}

function ChatPanel({
  chat,
  isReplay,
  view,
  onViewChange,
  videoId,
  channelId,
  signedIn = false,
  fill = false,
  onClose,
}: {
  chat: LiveChatState;
  isReplay: boolean;
  view: ChatView;
  onViewChange: (view: ChatView) => void;
  videoId: string;
  channelId?: string | null;
  signedIn?: boolean;
  fill?: boolean;
  onClose?: () => void;
}) {
  const { messages, loading, ended, canSwitchView, reconnect } = chat;

  const listRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  // Messages the viewer deleted: the poll keeps returning them until the
  // server catches up, so they stay hidden locally.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const showToast = useUiStore((s) => s.showToast);
  const openSignInDialog = useUiStore((s) => s.openSignInDialog);

  const handleDelete = (message: LiveChatMessage) => {
    if (!message.menuParams) return;
    void deleteLiveChatMessage(message.menuParams, message.menuApiUrl)
      .then(() => {
        setDeletedIds((previous) => new Set(previous).add(message.id));
      })
      .catch(() => {
        showToast({ variant: "error", message: getString("live_chat_delete_failed") });
      });
  };

  const visibleMessages = messages.filter((message) => !deletedIds.has(message.id));

  // Keep the view glued to the newest message unless the user has scrolled up to read history
  // or is highlighting a message, which a jump would drag out from under the pointer.
  useLayoutEffect(() => {
    if (pinned && listRef.current && !selectionTouches(listRef.current)) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visibleMessages, pinned]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const onScroll = () => {
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      setPinned(nearBottom);
    };
    element.addEventListener("scroll", onScroll);
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low ${
        fill ? "h-full" : "h-[min(560px,70vh)] shrink-0"
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-chrome-neutral-800 px-4 py-3">
        <Radio size={16} className="text-primary" />
        <h3 className="text-base font-medium text-chrome-neutral-200">
          {getString(isReplay ? "live_chat_replay_title" : "live_chat_title")}
        </h3>
        <div className="ms-auto flex items-center gap-2">
          {canSwitchView && <ViewToggle view={view} onViewChange={onViewChange} />}
          {ended ? (
            <button
              type="button"
              onClick={reconnect}
              className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold text-chrome-neutral-300 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <RotateCw size={12} />
              {getString("live_chat_reconnect")}
            </button>
          ) : (
            !isReplay && (
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {getString("live_badge")}
              </span>
            )
          )}
          {onClose && (
            <button
              type="button"
              aria-label={getString("close")}
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={listRef} className="h-full select-text space-y-2.5 overflow-y-auto px-3 py-3">
          {loading && visibleMessages.length === 0 ? (
            <div className="flex items-center gap-2 px-1 py-2 text-sm text-chrome-neutral-500">
              <Loader2 size={16} className="animate-spin" />
              {getString("live_chat_connecting")}
            </div>
          ) : visibleMessages.length === 0 ? (
            <p className="px-1 py-2 text-sm text-chrome-neutral-500">
              {ended ? getString("live_chat_ended") : getString("live_chat_empty")}
            </p>
          ) : (
            visibleMessages.map((message) => (
              <div key={message.id} className="group relative">
                <ChatRow message={message} />
                {!isReplay && message.menuParams && (
                  <button
                    type="button"
                    aria-label={getString("live_chat_delete")}
                    title={getString("live_chat_delete")}
                    onClick={() => handleDelete(message)}
                    className="absolute end-1 top-1 hidden h-6 w-6 place-items-center rounded-full bg-chrome-black/70 text-chrome-neutral-300 transition-colors hover:text-chrome-white focus-visible:grid group-hover:grid"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
          {ended && visibleMessages.length > 0 && (
            <p className="px-1 pt-2 text-xs text-chrome-neutral-500">{getString("live_chat_ended")}</p>
          )}
        </div>

        {!pinned && (
          <button
            onClick={() => setPinned(true)}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
          >
            <ArrowDown size={13} />
            {getString("live_chat_jump_latest")}
          </button>
        )}
      </div>

      {!isReplay &&
        (signedIn && channelId ? (
          <ChatComposer videoId={videoId} channelId={channelId} />
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-chrome-neutral-800 px-4 py-2.5">
            <span className="text-xs text-chrome-neutral-400">{getString("live_chat_sign_in_to_chat")}</span>
            <button
              type="button"
              onClick={openSignInDialog}
              className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-transform active:scale-95"
            >
              {getString("player_error_sign_in")}
            </button>
          </div>
        ))}
    </div>
  );
}

export default LiveChat;
