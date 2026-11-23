import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { CommentItem } from "./CommentItem";
import { GoogleSignInDialog } from "../GoogleSignInDialog";
import { useVideoComments } from "../../lib/useVideoComments";
import { googleAccountDisplayName, useGoogleAccount } from "../../lib/useGoogleAccount";
import { useUiStore } from "../../store/useUiStore";
import { useTimedComments } from "../../lib/useTimedComments";
import { useTimedFollow } from "../../lib/useTimedFollow";
import { useBoolPref } from "../../lib/usePreference";
import {
  COMMENT_FILTERS,
  commentSortFor,
  oldestCommentsFirst,
  timedCommentsInOrder,
  type CommentFilter,
} from "../../lib/commentFilters";
import { SETTINGS } from "../../lib/settings/schema";
import { usePlayerStore } from "../../store/usePlayerStore";
import { getString } from "../../lib/i18n/index";
import { buildCommentReplyTree, type CommentReplyNode } from "../../lib/commentReplyTree";
import type { Comment, CommentSort } from "../../types/video";
import type { CommentsSectionProps } from "./types";

const FILTER_LABELS = {
  top: "comments_sort_top",
  newest: "comments_sort_newest",
  oldest: "comments_sort_oldest",
  timed: "comments_sort_timed",
} as const satisfies Record<CommentFilter, string>;

// YouTube names the orders in English; ours are named by their place in its list.
const sortLabel = (option: CommentSort, index: number) =>
  index === 0 ? getString("comments_sort_top") : index === 1 ? getString("comments_sort_newest") : option.title;

export function CommentsSection({
  videoId,
  hideHeader = false,
  postId,
  postCommentParams,
  fill = false,
  onClose,
}: CommentsSectionProps) {
  const { status, account } = useGoogleAccount();
  const thread = useVideoComments(videoId, {
    postId,
    postCommentParams,
    ownIdentity: account
      ? { name: googleAccountDisplayName(account), thumbnailUrl: account.thumbnailUrl }
      : null,
  });
  const [filter, setFilter] = useState<CommentFilter>("top");
  const [draft, setDraft] = useState("");
  // The sign-in dialog lives here, not behind the top-bar store flag:
  // the prompt's store call opened nothing on a real machine, while the
  // top bar's own dialog (local state, same component) works. Rendered
  // locally, the prompt opens the dialog it can see.
  const [signInOpen, setSignInOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Set when the prompt was the way in: after a sign-in the box takes
  // focus, so the user lands back ready to type. Cleared when the dialog
  // closes without a sign-in, or once the box has taken focus.
  const focusAfterSignIn = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    setFilter("top");
    setDraft("");
  }, [videoId]);
  // Community posts have no playback to follow and keep YouTube's own orders.
  const filtersShown = !postId && thread.sortOptions.length >= 2;
  const isTimed = filtersShown && filter === "timed";

  const timed = useTimedComments(videoId, thread.sortOptions, isTimed);
  const duration = usePlayerStore((s) => s.duration);
  const [follow, setFollow] = useBoolPref(SETTINGS.TIMED_COMMENTS_FOLLOW);
  const listRef = useRef<HTMLDivElement>(null);

  const comments = useMemo(() => {
    if (isTimed) return timedCommentsInOrder(timed.comments, duration);
    return filtersShown && filter === "oldest" ? oldestCommentsFirst(thread.comments) : thread.comments;
  }, [duration, filter, filtersShown, isTimed, thread.comments, timed.comments]);
  const { anchorId, pauseForReading, pauseForReplies } = useTimedFollow(listRef, comments, isTimed && follow);

  const chooseFilter = (next: CommentFilter) => {
    setFilter(next);
    if (next === "timed") return;
    const order = commentSortFor(thread.sortOptions, next);
    if (order && !order.selected) thread.selectSort(order.token);
  };

  const loading = isTimed ? timed.loading && comments.length === 0 : thread.loading;
  const hasMore = isTimed ? timed.hasMore : Boolean(thread.nextPageToken);
  const loadingMore = isTimed ? timed.loading : thread.loadingMore;
  const loadMore = isTimed ? timed.loadMore : thread.loadMore;
  const emptyText = isTimed ? getString("comments_no_timed") : getString("watch_no_comments");
  // The Timed list scrolls by itself, so following it never moves the page or the player.
  const listClass = fill ? "min-h-0 flex-1 overflow-y-auto pe-1" : isTimed ? "max-h-[70vh] overflow-y-auto pe-1" : "";

  /** The list was fetched as a guest while signed out, so it carries no
   * comment box token: a sign-in reloads it signed-in, and only then does
   * the composer appear. A list that already had a token needs no reload. */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== "signed-in" && status === "signed-in" && !thread.createCommentParams) {
      thread.refresh();
    }
    prevStatusRef.current = status;
  }, [status, thread.createCommentParams, thread.refresh]);

  /** After a sign-in from the prompt, the composer takes focus once its
   * token has arrived — the user lands back ready to type. */
  useEffect(() => {
    if (thread.createCommentParams && focusAfterSignIn.current) {
      focusAfterSignIn.current = false;
      composerRef.current?.focus();
    }
  }, [thread.createCommentParams]);

  /** A reply posts through the thread and reports back; success toasts like a top-level post. */
  const postReply = async (comment: Comment, text: string) => {
    const ok = await thread.postReply(comment, text);
    if (ok) useUiStore.getState().showToast({ variant: "success", message: getString("comment_reply_posted") });
    return ok;
  };

  /** A thread's replies, nested the way the conversation actually branches:
   * a reply to a reply sits one level deeper than the reply it answered. */
  const renderReplyThread = (nodes: CommentReplyNode[]) =>
    nodes.map((node) => (
      <div key={node.comment.id} className="space-y-4">
        <CommentItem
          comment={node.comment}
          reply
          onPostReply={postReply}
          onDelete={async (comment) => thread.deleteComment(comment.id)}
          onToggleLike={(comment) => void thread.toggleCommentLike(comment)}
          onToggleDislike={(comment) => void thread.toggleCommentDislike(comment)}
          deleteError={thread.deleteError?.id === node.comment.id ? thread.deleteError.message : null}
        />
        {node.children.length > 0 && (
          <div className="ms-4 space-y-4 border-s-2 border-chrome-neutral-800 ps-4">
            {renderReplyThread(node.children)}
          </div>
        )}
      </div>
    ));

  return (
    <div className={fill ? "flex h-full flex-col gap-4" : "space-y-6 pt-4"}>
      {!hideHeader && (
        <div className="flex flex-wrap items-center gap-4">
          <h2 className={fill ? "text-base font-medium text-chrome-neutral-100" : "text-xl font-bold text-chrome-neutral-100"}>
            {thread.totalCount != null
              ? getString("watch_comments_total", thread.totalCount.toLocaleString())
              : `${thread.countText || thread.comments.length} ${getString("watch_comments")}`}
          </h2>
          {onClose && (
            <button
              type="button"
              aria-label={getString("close")}
              onClick={onClose}
              className="ms-auto grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <X size={18} />
            </button>
          )}
          {filtersShown ? (
            <div className="flex flex-wrap gap-2">
              {COMMENT_FILTERS.map((option) => (
                <Chip key={option} active={filter === option} onClick={() => chooseFilter(option)}>
                  {getString(FILTER_LABELS[option])}
                </Chip>
              ))}
            </div>
          ) : (
            thread.sortOptions.length > 1 && (
              <div className="flex gap-2">
                {thread.sortOptions.map((option, index) => (
                  <Chip
                    key={option.token}
                    active={option.selected}
                    onClick={() => !option.selected && thread.selectSort(option.token)}
                  >
                    {sortLabel(option, index)}
                  </Chip>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {isTimed && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-chrome-neutral-400">{getString("comments_timed_follow")}</span>
          <ToggleSwitch checked={follow} onChange={setFollow} />
        </div>
      )}

      {!thread.disabled && !loading && thread.createCommentParams ? (
        <div className="space-y-2">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={getString("comment_post_placeholder")}
            rows={2}
            className="w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-3 text-sm text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-600 focus:border-chrome-neutral-700"
          />
          {thread.postError ? (
            <p className="text-sm text-chrome-red-400">
              {getString("comment_post_failed")}: {thread.postError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                const ok = await thread.postComment(draft);
                if (!ok) return;
                setDraft("");
                useUiStore.getState().showToast({ variant: "success", message: getString("comment_posted") });
              }}
              disabled={!draft.trim() || thread.posting}
            >
              {thread.posting ? <Loader2 className="animate-spin" size={14} /> : null}
              {getString("comment_post")}
            </Button>
          </div>
        </div>
      ) : !thread.disabled && !loading && !thread.createCommentParams && status === "signed-out" ? (
        <button
          type="button"
          onClick={() => {
            focusAfterSignIn.current = true;
            setSignInOpen(true);
          }}
          className="text-sm font-medium text-primary hover:underline"
        >
          {getString("comment_sign_in")}
        </button>
      ) : null}

      {loading ? (
        <Loader2 className="animate-spin text-chrome-neutral-500" size={24} />
      ) : thread.disabled ? (
        <p className="text-sm text-chrome-neutral-500">{getString("watch_comments_disabled")}</p>
      ) : comments.length === 0 && !(isTimed && hasMore) ? (
        <p className="text-sm text-chrome-neutral-500">{emptyText}</p>
      ) : (
        <div
          ref={listRef}
          className={`space-y-6 ${listClass}`}
          onWheel={pauseForReading}
          onPointerDown={pauseForReading}
        >
          <div className="space-y-4">
            {comments.map((c, idx) => (
              <div
                key={c.id || `comment-${idx}`}
                data-comment-id={c.id}
                className={`flex flex-col rounded-lg transition-colors duration-200 ease-out ${
                  c.id === anchorId ? "bg-surface-container-high" : ""
                }`}
              >
                <CommentItem
                  comment={c}
                  onPostReply={postReply}
                  onDelete={async (comment) => thread.deleteComment(comment.id)}
                  onToggleLike={(comment) => void thread.toggleCommentLike(comment)}
                  onToggleDislike={(comment) => void thread.toggleCommentDislike(comment)}
                  deleteError={thread.deleteError?.id === c.id ? thread.deleteError.message : null}
                />
                <div className="ms-14">
                  {(c.continuationToken || (c.replyCount != null && c.replyCount > 0)) && (
                    <button
                      onClick={() => {
                        if (!thread.expanded[c.id]) pauseForReplies();
                        void thread.toggleReplies(c.id, c.continuationToken);
                      }}
                      className="mt-2 flex items-center gap-1 border-none bg-transparent p-0 text-xs font-semibold text-primary hover:underline"
                    >
                      {thread.expanded[c.id]
                        ? getString("watch_hide_replies")
                        : getString("watch_show_replies", c.replyCount ?? "")}
                    </button>
                  )}

                  {thread.expanded[c.id] && (
                    <div className="mt-4 space-y-4 border-s-2 border-chrome-neutral-800 ps-4">
                      {renderReplyThread(buildCommentReplyTree(thread.replies[c.id] ?? []))}

                      {thread.repliesLoading[c.id] && (
                        <div className="flex items-center gap-2 py-1 text-xs text-chrome-neutral-400">
                          <Loader2 className="animate-spin text-chrome-neutral-400" size={14} />
                          <span>{getString("watch_loading_replies")}</span>
                        </div>
                      )}

                      {!thread.repliesLoading[c.id] && thread.repliesNextToken[c.id] && (
                        <button
                          onClick={() => thread.loadReplies(c.id, thread.repliesNextToken[c.id]!)}
                          className="mt-2 block border-none bg-transparent p-0 text-[11px] font-bold text-primary hover:underline"
                        >
                          {getString("watch_show_more_replies")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {(hasMore || (isTimed && loadingMore)) && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 font-semibold"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="animate-spin text-chrome-neutral-400" size={16} />
                    <span>{getString("watch_loading_more_comments")}</span>
                  </>
                ) : (
                  getString("watch_load_more_comments")
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {signInOpen && (
        <GoogleSignInDialog
          onClose={() => {
            setSignInOpen(false);
            // A dismissal without a sign-in leaves no box to land in.
            if (statusRef.current !== "signed-in") focusAfterSignIn.current = false;
          }}
        />
      )}
    </div>
  );
}

export default CommentsSection;
