import { describe, expect, it } from "vitest";
import { buildCommentReplyTree } from "./commentReplyTree";
import type { Comment } from "../types/video";

/**
 * Pins how a flat reply list becomes a conversation, mirroring the Android
 * app's CommentReplyTreeTest. YouTube stores one level of replies and marks
 * a reply-to-a-reply with nothing but the `@handle` it opens with.
 */
const reply = (id: string, author: string, text: string): Comment => ({
  id,
  author,
  authorThumbnail: "",
  text,
  likeCount: 0,
  publishedText: "1 day ago",
});

describe("buildCommentReplyTree", () => {
  it("a reply that mentions an earlier reply hangs off it", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@DaniDipp", "Source code I compile myself"),
      reply("r2", "@RachidBoudjelida", "SO basically we should throw everything"),
      reply("r3", "@skbs981", "@RachidBoudjelida and also by the governments"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["r1", "r2"]);
    expect(tree[1]?.children.map((node) => node.comment.id)).toEqual(["r3"]);
  });

  it("a mention of someone who has not replied yet stays at the top level", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@first", "@nobody hello"),
      reply("r2", "@second", "@alsoNobody hi"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["r1", "r2"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("a reply mentioning its own author is not nested under itself", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@same", "first"),
      reply("r2", "@same", "@same talking to myself"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["r1", "r2"]);
  });

  it("nesting goes as deep as the conversation does", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@a", "start"),
      reply("r2", "@b", "@a answering you"),
      reply("r3", "@c", "@b answering you"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["r1"]);
    const second = tree[0]?.children[0];
    expect(second?.comment.id).toBe("r2");
    expect(second?.children[0]?.comment.id).toBe("r3");
  });

  it("a mention only nests under someone who spoke earlier", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@a", "@b answering someone who has not replied yet"),
      reply("r2", "@b", "here I am"),
    ]);

    expect(tree.map((node) => node.comment.id)).toEqual(["r1", "r2"]);
  });

  it("a single reply needs no tree", () => {
    const tree = buildCommentReplyTree([reply("r1", "@a", "@a hello")]);

    expect(tree[0]?.comment.id).toBe("r1");
    expect(tree[0]?.children).toEqual([]);
  });
});
