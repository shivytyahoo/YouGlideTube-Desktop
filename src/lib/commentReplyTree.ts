import type { Comment } from "../types/video";

/** A reply and whatever replied to it, at the depth it sits in the conversation. */
export interface CommentReplyNode {
  comment: Comment;
  children: CommentReplyNode[];
}

const LEADING_MENTION = /^\s*@([^\s,:]+)/;

/**
 * Arranges a flat reply list into the conversation it actually is, as the
 * Android app's `buildCommentReplyTree` does.
 *
 * YouTube stores one level of replies: a reply to a reply comes back in the
 * same list, marked only by the `@handle` it opens with. Reading that mention
 * back is what lets the thread show who was answering whom instead of a
 * single column of equals.
 *
 * A mention only nests a reply under someone who already spoke *earlier* in
 * the thread, so a mention of the top-level author, of a stranger, or of
 * someone further down leaves the reply where it is rather than reordering
 * the conversation.
 */
export function buildCommentReplyTree(replies: Comment[]): CommentReplyNode[] {
  if (replies.length < 2) return replies.map((comment) => ({ comment, children: [] }));

  const children = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  const seenAuthors = new Map<string, string>();

  for (const reply of replies) {
    const handle = reply.author.trim().replace(/^@/, "").toLowerCase();
    const mention = LEADING_MENTION.exec(reply.text)?.[1]?.toLowerCase();
    // Answering yourself is a continuation, not a branch, so it stays where it is.
    const parentId = mention && mention !== handle ? seenAuthors.get(mention) : undefined;
    if (parentId) {
      const siblings = children.get(parentId) ?? [];
      siblings.push(reply);
      children.set(parentId, siblings);
    } else {
      roots.push(reply);
    }
    if (!seenAuthors.has(handle)) seenAuthors.set(handle, reply.id);
  }

  const node = (comment: Comment): CommentReplyNode => ({
    comment,
    children: (children.get(comment.id) ?? []).map(node),
  });

  return roots.map(node);
}
