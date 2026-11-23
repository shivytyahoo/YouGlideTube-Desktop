import { useCallback, useEffect, useRef, useState } from "react";
import { createComment, createCommentReply, deleteComment as deleteCommentApi, getComments, getPostComments, likeComment as likeCommentApi } from "./api/youtube";
import { normalizeBackendError } from "./api/errors";
import { formatCount } from "./utils";
import type { Comment, CommentSort } from "../types/video";

interface UseVideoCommentsOptions {
  postId?: string | null;
  postCommentParams?: string | null;
}

export function useVideoComments(videoId: string | undefined, options: UseVideoCommentsOptions = {}) {
  const postId = options.postId?.trim() || null;
  const postCommentParams = options.postCommentParams?.trim() || null;
  const sourceId = postId ?? videoId;
  const sourceKey = postId ? `post:${postId}:${postCommentParams ?? ""}` : `video:${videoId ?? ""}`;
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [countText, setCountText] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [sortOptions, setSortOptions] = useState<CommentSort[]>([]);
  // The sort chosen for this source; any other source starts on YouTube's default first page.
  const [chosenSort, setChosenSort] = useState<{ key: string; token: string } | null>(null);
  const sortToken = chosenSort?.key === sourceKey ? chosenSort.token : null;
  const [loadingMore, setLoadingMore] = useState(false);
  // The comment box token the first page carried, when it carried one:
  // posting needs it, and a page without it cannot post.
  const [createCommentParams, setCreateCommentParams] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Bumped after a posted comment so the list reloads from the server.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [replies, setReplies] = useState<Record<string, Comment[]>>({});
  const [repliesLoading, setRepliesLoading] = useState<Record<string, boolean>>({});
  const [repliesNextToken, setRepliesNextToken] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The real reason the last delete failed, with the comment it belonged to —
  // the caller shows this instead of only a static string.
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  // Votes already in flight, by comment id: a double tap must not send twice.
  const votesInFlight = useRef<Set<string>>(new Set());

  const fetchComments = useCallback(
    (pageToken?: string | null) => {
      if (postId) return getPostComments(postId, postCommentParams, pageToken);
      return getComments(videoId || "", pageToken);
    },
    [postId, postCommentParams, videoId],
  );

  useEffect(() => {
    setSortOptions([]);
    setTotalCount(null);
    setDisabled(false);
    setCreateCommentParams(null);
    setPostError(null);
  }, [sourceKey]);

  useEffect(() => {
    setComments([]);
    setNextPageToken(null);
    if (!sortToken) setCountText(null);
    setReplies({});
    setRepliesLoading({});
    setRepliesNextToken({});
    setExpanded({});
    if (!sourceId) return;

    let cancelled = false;
    setLoading(true);
    fetchComments(sortToken)
      .then((res) => {
        if (cancelled) return;
        setComments(res.comments || []);
        setNextPageToken(res.nextPageToken || null);
        if (res.commentCountText) setCountText(res.commentCountText);
        if (res.totalCount != null) setTotalCount(res.totalCount);
        if (res.sortOptions?.length) setSortOptions(res.sortOptions);
        if (res.createCommentParams) setCreateCommentParams(res.createCommentParams);
        setDisabled(Boolean(res.commentsDisabled));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Failed to load comments", err);
        setComments([]);
        setNextPageToken(null);
        setCountText(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchComments, sourceId, sourceKey, sortToken, reloadNonce]);

  /** Reloads the list from the server — the comments were fetched as a
   * guest while signed out, so after a sign-in the section calls this to
   * pick up the signed-in tokens (the comment box token above all). */
  const refresh = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);
  const selectSort = useCallback(
    (token: string) => {
      setSortOptions((options) => options.map((option) => ({ ...option, selected: option.token === token })));
      setChosenSort({ key: sourceKey, token });
    },
    [sourceKey],
  );

  const loadMore = useCallback(async () => {
    if (!sourceId || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchComments(nextPageToken);
      setComments((prev) => [...prev, ...(res.comments || [])]);
      setNextPageToken(res.nextPageToken || null);
      if (res.commentCountText) setCountText(res.commentCountText);
    } catch (err) {
      console.error("Failed to load more comments", err);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchComments, sourceId, nextPageToken, loadingMore]);

  const loadReplies = useCallback(
    async (commentId: string, replyToken: string) => {
      if (!sourceId || repliesLoading[commentId]) return;
      setRepliesLoading((prev) => ({ ...prev, [commentId]: true }));
      try {
        const res = await fetchComments(replyToken);
        setReplies((prev) => ({ ...prev, [commentId]: [...(prev[commentId] || []), ...(res.comments || [])] }));
        setRepliesNextToken((prev) => ({ ...prev, [commentId]: res.nextPageToken || null }));
      } catch (err) {
        console.error(`Failed to load replies for comment ${commentId}`, err);
      } finally {
        setRepliesLoading((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [fetchComments, sourceId, repliesLoading],
  );

  /** The top-level comment a reply belongs to: itself, or the thread that holds it. */
  const ancestorIdOf = useCallback(
    (commentId: string): string | null => {
      if (comments.some((comment) => comment.id === commentId)) return commentId;
      for (const [ancestorId, thread] of Object.entries(replies)) {
        if (thread.some((reply) => reply.id === commentId)) return ancestorId;
      }
      return null;
    },
    [comments, replies],
  );

  /** Posts a reply to any comment in the list, with that comment's own token —
   * never the top-level box's, which would post a top-level comment instead.
   * The reply joins its thread; when the answer carried no server row, the
   * thread reloads so the reply shows up once it propagates. False on failure. */
  const postReply = useCallback(
    async (parent: Comment, text: string) => {
      const params = parent.replyParams?.trim();
      const body = text.trim();
      if (!params || !body || posting) return false;
      setPosting(true);
      try {
        const serverReply = await createCommentReply(params, parent.replyPath ?? null, body);
        const ancestorId = ancestorIdOf(parent.id) ?? parent.id;
        setExpanded((prev) => ({ ...prev, [ancestorId]: true }));
        setComments((prev) =>
          prev.map((comment) =>
            comment.id === ancestorId
              ? { ...comment, replyCount: (comment.replyCount ?? 0) + 1 }
              : comment,
          ),
        );
        if (serverReply) {
          setReplies((prev) => ({
            ...prev,
            [ancestorId]: [...(prev[ancestorId] || []), serverReply],
          }));
        } else {
          const ancestor = comments.find((comment) => comment.id === ancestorId);
          if (ancestor?.continuationToken) {
            setReplies((prev) => ({ ...prev, [ancestorId]: [] }));
            setRepliesNextToken((prev) => ({ ...prev, [ancestorId]: null }));
            await loadReplies(ancestorId, ancestor.continuationToken);
          }
        }
        return true;
      } catch (err) {
        console.warn("Failed to post the reply", err);
        return false;
      } finally {
        setPosting(false);
      }
    },
    [ancestorIdOf, comments, loadReplies, posting],
  );

  /** Deletes one of the viewer's own comments, wherever it sits in the list.
   * False on failure; the caller shows why it stayed. */
  const deleteComment = useCallback(
    async (commentId: string) => {
      const target =
        comments.find((comment) => comment.id === commentId) ??
        Object.values(replies)
          .flat()
          .find((reply) => reply.id === commentId);
      const action = target?.deleteAction?.trim();
      if (!action) return false;
      setDeleteError(null);
      try {
        const ok = await deleteCommentApi(action);
        if (!ok) throw new Error("server declined the delete");
        if (comments.some((comment) => comment.id === commentId)) {
          setComments((prev) => prev.filter((comment) => comment.id !== commentId));
        } else {
          const ancestorId = ancestorIdOf(commentId);
          if (ancestorId) {
            setReplies((prev) => ({
              ...prev,
              [ancestorId]: (prev[ancestorId] || []).filter((reply) => reply.id !== commentId),
            }));
            setComments((prev) =>
              prev.map((comment) =>
                comment.id === ancestorId
                  ? { ...comment, replyCount: Math.max(0, (comment.replyCount ?? 1) - 1) }
                  : comment,
              ),
            );
          }
        }
        return true;
      } catch (err) {
        console.warn("Failed to delete the comment", err);
        setDeleteError({ id: commentId, message: normalizeBackendError(err).message });
        return false;
      }
    },
    [ancestorIdOf, comments, replies],
  );

  /** Replaces one comment by id, wherever it sits in the list. */
  const replaceComment = useCallback((commentId: string, next: Comment) => {
    setComments((prev) => prev.map((comment) => (comment.id === commentId ? next : comment)));
    setReplies((prev) => {
      let changed = false;
      const nextReplies: Record<string, Comment[]> = {};
      for (const [ancestorId, thread] of Object.entries(prev)) {
        nextReplies[ancestorId] = thread.map((reply) => {
          if (reply.id !== commentId) return reply;
          changed = true;
          return next;
        });
      }
      return changed ? nextReplies : prev;
    });
  }, []);

  /** Likes a comment, or withdraws the like when it is already liked — and
   * the same for dislike. As Android's `CommentsPager.vote` does: the
   * toolbar command for the direction, an optimistic count move, and the
   * parsed state back on a refusal. Works on top-level comments and replies
   * alike. False when there is no vote to send, or the server refused it. */
  const voteOnComment = useCallback(
    async (comment: Comment, like: boolean) => {
      const current =
        comments.find((item) => item.id === comment.id) ??
        Object.values(replies)
          .flat()
          .find((reply) => reply.id === comment.id) ??
        comment;
      if (votesInFlight.current.has(current.id)) return false;
      const endpoint = like
        ? current.isLiked
          ? current.unlikeAction
          : current.likeAction
        : current.isDisliked
          ? current.undislikeAction
          : current.dislikeAction;
      if (!endpoint?.trim()) return false;
      votesInFlight.current.add(current.id);
      const count = current.likeCount ?? 0;
      const optimistic: Comment =
        like && current.isLiked
          ? { ...current, isLiked: false, likeCount: Math.max(0, count - 1) }
          : like
            ? {
                ...current,
                isLiked: true,
                isDisliked: false,
                likeCount: count + 1,
                likeCountLikedText:
                  current.likeCountLikedText?.trim() || formatCount(count + 1),
              }
            : current.isDisliked
              ? { ...current, isDisliked: false }
              : {
                  ...current,
                  isDisliked: true,
                  isLiked: false,
                  likeCount: current.isLiked ? Math.max(0, count - 1) : count,
                };
      replaceComment(current.id, optimistic);
      try {
        await likeCommentApi(endpoint);
        return true;
      } catch (err) {
        console.warn("Failed to vote on the comment", err);
        replaceComment(current.id, current);
        return false;
      } finally {
        votesInFlight.current.delete(current.id);
      }
    },
    [comments, replies, replaceComment],
  );

  const toggleCommentLike = useCallback(
    (comment: Comment) => voteOnComment(comment, true),
    [voteOnComment],
  );

  const toggleCommentDislike = useCallback(
    (comment: Comment) => voteOnComment(comment, false),
    [voteOnComment],
  );

  /** Posts a comment, then reloads the list from the server. False on failure. */
  const postComment = useCallback(async (text: string) => {
    const params = createCommentParams;
    const body = text.trim();
    if (!params || !body || posting) return false;
    setPosting(true);
    setPostError(null);
    try {
      const ok = await createComment(params, body);
      if (!ok) throw new Error("server declined the comment");
      setReloadNonce((n) => n + 1);
      return true;
    } catch (err) {
      console.warn("Failed to post the comment", err);
      setPostError(normalizeBackendError(err).message);
      return false;
    } finally {
      setPosting(false);
    }
  }, [createCommentParams, posting]);

  const toggleReplies = useCallback(
    async (commentId: string, replyToken: string | null | undefined) => {
      if (expanded[commentId]) {
        setExpanded((prev) => ({ ...prev, [commentId]: false }));
        return;
      }
      setExpanded((prev) => ({ ...prev, [commentId]: true }));
      if (!replies[commentId] && replyToken) await loadReplies(commentId, replyToken);
    },
    [expanded, replies, loadReplies],
  );

  return {
    comments,
    loading,
    countText,
    totalCount,
    disabled,
    sortOptions,
    selectSort,
    nextPageToken,
    loadingMore,
    replies,
    repliesLoading,
    repliesNextToken,
    expanded,
    loadMore,
    refresh,
    toggleReplies,
    loadReplies,
    postReply,
    deleteComment,
    deleteError,
    toggleCommentLike,
    toggleCommentDislike,
    createCommentParams,
    posting,
    postError,
    postComment,
  };
}
