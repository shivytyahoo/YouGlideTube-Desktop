import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Loader2, MoreVertical, Pin, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { ChannelLabel } from "../video/CardMeta";
import { LinkedText } from "./LinkedText";
import { Button } from "../ui/Button";
import { MediaMenu } from "../ui/MediaMenu";
import type { MenuAnchor } from "../ui/AnchoredPortalMenu";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useConfirmStore } from "../../store/useConfirmStore";
import type { Comment } from "../../types/video";
import { alignToEnd, isRtlText } from "../../lib/direction";

const PREVIEW_LENGTH = 280;

/** Comment avatars arrive from YouTube at 88px; every other avatar in the app is
 * upgraded and proxied the same way, so they match instead of looking soft. */
function CommentAvatar({ src, author }: { src: string | null | undefined; author: string | null | undefined }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src, 128));
  if (!imageSrc) return <>{author?.charAt(0)?.toUpperCase() || "?"}</>;
  return <img src={imageSrc} className="h-full w-full object-cover" alt="" loading="lazy" />;
}

/** A long comment shows its first lines with plain links until it is expanded. */
function CommentText({ comment, className }: { comment: Comment; className: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = comment.text;
  if (!text) return null;
  const long = text.length > PREVIEW_LENGTH;
  return (
    // From the text itself: dir="auto" would skip the text, which sets its own direction, and read
    // the Read more button's language instead.
    <div dir={isRtlText(text) ? "rtl" : "ltr"} className={className}>
      {long && !expanded ? (
        <LinkedText text={`${text.slice(0, PREVIEW_LENGTH)}...`} />
      ) : (
        <LinkedText text={text} rich={comment.richText} />
      )}
      {long && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="ms-1 cursor-pointer font-semibold text-primary hover:underline focus:outline-none"
        >
          {expanded ? getString("watch_read_less") : getString("watch_read_more")}
        </button>
      )}
    </div>
  );
}

/** The inline reply box under a comment, as Android's `CommentReplyComposer`:
 * success closes the box, failure keeps the text and shows why it stayed. */
function ReplyComposer({
  onSubmit,
  onClose,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setFailed(false);
        }}
        placeholder={getString("comment_add_reply")}
        rows={2}
        className="w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-3 text-sm text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-600 focus:border-chrome-neutral-700"
      />
      {failed ? (
        <p className="text-sm text-chrome-red-400">{getString("comment_post_failed")}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1.5 text-sm font-medium text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
        >
          {getString("cancel")}
        </button>
        <Button
          onClick={async () => {
            if (!draft.trim() || posting) return;
            setPosting(true);
            const ok = await onSubmit(draft);
            setPosting(false);
            if (!ok) {
              setFailed(true);
              return;
            }
            onClose();
          }}
          disabled={!draft.trim() || posting}
        >
          {posting ? <Loader2 className="animate-spin" size={14} /> : null}
          {getString("comment_reply")}
        </Button>
      </div>
    </div>
  );
}

/** One comment or reply: author line with its badges, text, likes and the creator's heart.
 * A comment that carries a reply token offers a Reply box; the viewer's own comment
 * offers Delete behind its options menu, after a confirm dialog. A comment that
 * carries vote tokens offers Like and Dislike buttons, as Android's toolbar does;
 * without them the like count stays a static label, as before. */
export function CommentItem({
  comment,
  reply = false,
  onPostReply,
  onDelete,
  onToggleLike,
  onToggleDislike,
  deleteError,
}: {
  comment: Comment;
  reply?: boolean;
  onPostReply?: (comment: Comment, text: string) => Promise<boolean>;
  onDelete?: (comment: Comment) => Promise<boolean>;
  onToggleLike?: (comment: Comment) => void;
  onToggleDislike?: (comment: Comment) => void;
  /** The real reason this comment's last delete failed, when it failed. */
  deleteError?: string | null;
}) {
  const navigate = useNavigate();
  const openAuthor = () => comment.authorChannelId && navigate(`/channel/${comment.authorChannelId}`);
  const likes = comment.likeCountText || (comment.likeCount ? formatCount(comment.likeCount) : null);
  const [showComposer, setShowComposer] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const canReply = Boolean(comment.replyParams && onPostReply);
  const canDelete = Boolean(comment.isOwn && comment.deleteAction && onDelete);
  const canVote = Boolean(onToggleLike && (comment.likeAction || comment.unlikeAction));
  const canDislike = Boolean(onToggleDislike && (comment.dislikeAction || comment.undislikeAction));

  const askDelete = async () => {
    setMenuAnchor(null);
    const confirmed = await useConfirmStore.getState().ask({
      title: getString("comment_delete_title"),
      message: getString("comment_delete_body"),
      confirmLabel: getString("delete"),
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await onDelete?.(comment);
    if (!ok) setDeleteFailed(true);
  };

  return (
    <div className={`flex ${reply ? "gap-3 text-xs" : "gap-4"}`}>
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-chrome-neutral-400 ${
          reply ? "h-8 w-8" : "h-10 w-10 text-sm"
        } ${comment.authorChannelId ? "cursor-pointer" : ""}`}
        onClick={openAuthor}
      >
        <CommentAvatar src={comment.authorThumbnail} author={comment.author} />
      </div>
      <div className="min-w-0 flex-1">
        {comment.isPinned && (
          <div className="mb-1 flex items-center gap-1 text-xs text-chrome-neutral-400">
            <Pin size={12} />
            <span>{comment.pinnedText || getString("comment_pinned")}</span>
          </div>
        )}
        <div className={`flex items-center gap-2 font-bold text-chrome-neutral-100 ${reply ? "" : "text-sm"}`}>
          <button
            type="button"
            onClick={openAuthor}
            className={`min-w-0 ${comment.isCreator ? "rounded-full bg-surface-container-high px-2 py-0.5" : ""} ${
              comment.authorChannelId ? "transition-colors hover:text-primary" : "cursor-default"
            }`}
          >
            <ChannelLabel name={comment.author} verified={comment.isVerified} artist={comment.isArtist} iconSize={12} />
          </button>
          <span dir="auto" className={`font-medium text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {comment.publishedText}
          </span>
        </div>
        <CommentText
          comment={comment}
          className={`mt-1 select-text text-chrome-neutral-200 ${reply ? "font-normal" : "text-sm"}`}
        />
        {(likes || canVote || canDislike || comment.isHearted || canReply || canDelete) && (
          <div className={`mt-2 flex items-center gap-3 text-chrome-neutral-400 ${reply ? "text-[10px]" : "text-xs"}`}>
            {canVote ? (
              <button
                type="button"
                aria-label={getString("like")}
                aria-pressed={comment.isLiked}
                onClick={() => onToggleLike!(comment)}
                className="flex cursor-pointer items-center gap-1 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                <ThumbsUp
                  size={reply ? 10 : 12}
                  className={comment.isLiked ? "fill-primary text-primary" : ""}
                />{" "}
                {likes}
              </button>
            ) : (
              likes && (
                <span className="flex items-center gap-1">
                  <ThumbsUp size={reply ? 10 : 12} /> {likes}
                </span>
              )
            )}
            {canDislike && (
              <button
                type="button"
                aria-label={getString("watch_dislike")}
                aria-pressed={comment.isDisliked}
                onClick={() => onToggleDislike!(comment)}
                className="grid cursor-pointer place-items-center transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                <ThumbsDown
                  size={reply ? 10 : 12}
                  className={comment.isDisliked ? "fill-primary text-primary" : ""}
                />
              </button>
            )}
            {comment.isHearted && (
              <span title={comment.heartedByText ?? undefined} aria-label={comment.heartedByText ?? getString("comment_hearted")}>
                <Heart size={reply ? 11 : 13} className="fill-primary text-primary" />
              </span>
            )}
            {canReply && (
              <button
                type="button"
                onClick={() => setShowComposer((value) => !value)}
                className="font-semibold text-chrome-neutral-300 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
              >
                {getString("comment_reply")}
              </button>
            )}
            {canDelete && (
              <button
                ref={menuButtonRef}
                type="button"
                aria-label={getString("comment_options")}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = menuButtonRef.current?.getBoundingClientRect();
                  if (rect) setMenuAnchor({ top: rect.bottom + 8, flipBottom: rect.top - 8, ...alignToEnd(rect) });
                }}
                className="grid h-6 w-6 place-items-center rounded-full transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
              >
                <MoreVertical size={reply ? 14 : 16} />
              </button>
            )}
          </div>
        )}
        {deleteError ? (
          <p className="mt-2 text-sm text-chrome-red-400">{deleteError}</p>
        ) : deleteFailed ? (
          <p className="mt-2 text-sm text-chrome-red-400">{getString("comment_delete_failed")}</p>
        ) : null}
        {showComposer && canReply && (
          <ReplyComposer
            onSubmit={(text) => onPostReply!(comment, text)}
            onClose={() => setShowComposer(false)}
          />
        )}
      </div>
      {menuAnchor && (
        <MediaMenu
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          actions={[
            {
              id: "delete",
              label: getString("delete"),
              icon: <Trash2 size={16} />,
              danger: true,
              onSelect: () => void askDelete(),
            },
          ]}
        />
      )}
    </div>
  );
}
