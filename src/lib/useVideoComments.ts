import { useCallback, useEffect, useState } from "react";
import { createComment, getComments, getPostComments } from "./api/youtube";
import { normalizeBackendError } from "./api/errors";
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

  /** Reloads the list in the order `token` names (Top or Newest). */
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
    toggleReplies,
    loadReplies,
    createCommentParams,
    posting,
    postError,
    postComment,
  };
}
