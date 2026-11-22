// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendApiError } from "./api/errors";
import { useVideoComments } from "./useVideoComments";
import type { CommentsResponse } from "../types/video";

const getComments = vi.fn();
const getPostComments = vi.fn();
const createComment = vi.fn();
const createCommentReply = vi.fn();
const deleteCommentApi = vi.fn();

vi.mock("./api/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/youtube")>()),
  getComments: (...args: unknown[]) => getComments(...args),
  getPostComments: (...args: unknown[]) => getPostComments(...args),
  createComment: (...args: unknown[]) => createComment(...args),
  createCommentReply: (...args: unknown[]) => createCommentReply(...args),
  deleteComment: (...args: unknown[]) => deleteCommentApi(...args),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function page(overrides: Partial<CommentsResponse> = {}): CommentsResponse {
  return {
    comments: [
      {
        id: "c1",
        author: "Someone",
        authorThumbnail: null,
        text: "First!",
        publishedText: "1 hour ago",
        likeCount: 3,
        replyCount: 0,
      },
    ],
    nextPageToken: null,
    ...overrides,
  };
}

let latest: ReturnType<typeof useVideoComments>;
let root: Root;

function Harness() {
  latest = useVideoComments("vid00000001");
  return null;
}

async function renderHarness() {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await vi.waitFor(() => expect(latest.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  getComments.mockResolvedValue(page({ createCommentParams: "Ehk123" }));
  getPostComments.mockResolvedValue(page());
  createComment.mockResolvedValue(true);
  createCommentReply.mockResolvedValue(null);
  deleteCommentApi.mockResolvedValue(true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe("useVideoComments posting", () => {
  it("harvests the comment box token from the first page", async () => {
    await renderHarness();
    expect(latest.createCommentParams).toBe("Ehk123");
  });

  it("posts with the token and reloads the list from the server", async () => {
    await renderHarness();
    let posted = false;
    await act(async () => {
      posted = await latest.postComment("hello there");
    });
    expect(posted).toBe(true);
    expect(createComment).toHaveBeenCalledWith("Ehk123", "hello there");
    await vi.waitFor(() => expect(getComments).toHaveBeenCalledTimes(2));
  });

  it("reports the failure instead of pretending the comment posted", async () => {
    await renderHarness();
    createComment.mockRejectedValueOnce(new BackendApiError("nope", "unknown", null));
    let posted = true;
    await act(async () => {
      posted = await latest.postComment("hello there");
    });
    expect(posted).toBe(false);
    expect(latest.postError).toBe("nope");
    expect(getComments).toHaveBeenCalledTimes(1);
  });

  it("treats a null backend reply as a failed post", async () => {
    await renderHarness();
    createComment.mockResolvedValueOnce(null as unknown as boolean);
    let posted = true;
    await act(async () => {
      posted = await latest.postComment("hello there");
    });
    expect(posted).toBe(false);
    expect(latest.postError).toBe("server declined the comment");
    expect(getComments).toHaveBeenCalledTimes(1);
  });

  it("does not post when the page carried no comment box token", async () => {
    getComments.mockResolvedValue(page({ createCommentParams: undefined }));
    await renderHarness();
    expect(latest.createCommentParams).toBeNull();
    let posted = true;
    await act(async () => {
      posted = await latest.postComment("hello there");
    });
    expect(posted).toBe(false);
    expect(createComment).not.toHaveBeenCalled();
  });
});

describe("useVideoComments replies and deletes", () => {
  const threadPage = (overrides: Partial<CommentsResponse> = {}) =>
    page({
      comments: [
        {
          id: "c1",
          author: "Someone",
          authorThumbnail: null,
          text: "First!",
          publishedText: "1 hour ago",
          likeCount: 3,
          replyCount: 2,
          continuationToken: "REPLIES_TOKEN",
          replyParams: "REPLY_TOKEN",
          replyPath: "comment/create_comment_reply",
        },
      ],
      ...overrides,
    });

  const serverReply = {
    id: "r1",
    author: "Me",
    authorThumbnail: null,
    text: "thanks!",
    publishedText: "just now",
    likeCount: 0,
    replyCount: 0,
    isOwn: true,
  };

  it("posts a reply with the comment's own token and joins its thread", async () => {
    getComments.mockResolvedValue(threadPage());
    createCommentReply.mockResolvedValue(serverReply);
    await renderHarness();
    const parent = latest.comments[0]!;
    let posted = false;
    await act(async () => {
      posted = await latest.postReply(parent, "thanks!");
    });
    expect(posted).toBe(true);
    expect(createCommentReply).toHaveBeenCalledWith(
      "REPLY_TOKEN",
      "comment/create_comment_reply",
      "thanks!",
    );
    // The box token is never a reply token: a create would have posted top-level.
    expect(createComment).not.toHaveBeenCalled();
    expect(latest.replies["c1"]?.map((reply) => reply.id)).toEqual(["r1"]);
    expect(latest.comments[0]?.replyCount).toBe(3);
    expect(latest.expanded["c1"]).toBe(true);
  });

  it("reloads the thread when the answer carried no server row", async () => {
    getComments.mockImplementation(async (_videoId: unknown, token: unknown) =>
      token === "REPLIES_TOKEN"
        ? page({ comments: [serverReply] })
        : threadPage(),
    );
    createCommentReply.mockResolvedValue(null);
    await renderHarness();
    const parent = latest.comments[0]!;
    let posted = false;
    await act(async () => {
      posted = await latest.postReply(parent, "thanks!");
    });
    expect(posted).toBe(true);
    await vi.waitFor(() => expect(latest.replies["c1"]?.map((reply) => reply.id)).toEqual(["r1"]));
  });

  it("does not post a reply when the comment carried no reply token", async () => {
    getComments.mockResolvedValue(threadPage());
    await renderHarness();
    const parent = { ...latest.comments[0]!, replyParams: undefined };
    let posted = true;
    await act(async () => {
      posted = await latest.postReply(parent, "thanks!");
    });
    expect(posted).toBe(false);
    expect(createCommentReply).not.toHaveBeenCalled();
  });

  it("deletes a top-level comment and removes it from the list", async () => {
    getComments.mockResolvedValue(
      threadPage({
        comments: [
          {
            id: "c1",
            author: "Me",
            authorThumbnail: null,
            text: "mine",
            publishedText: "1 hour ago",
            likeCount: 0,
            replyCount: 0,
            isOwn: true,
            deleteAction: '{"performCommentActionEndpoint":{"actions":[{"type":"delete"}]}}',
          },
        ],
      }),
    );
    await renderHarness();
    let deleted = false;
    await act(async () => {
      deleted = await latest.deleteComment("c1");
    });
    expect(deleted).toBe(true);
    expect(deleteCommentApi).toHaveBeenCalledWith(
      '{"performCommentActionEndpoint":{"actions":[{"type":"delete"}]}}',
    );
    expect(latest.comments).toEqual([]);
  });

  it("deletes a reply and drops the thread count", async () => {
    getComments.mockImplementation(async (_videoId: unknown, token: unknown) =>
      token === "REPLIES_TOKEN"
        ? page({
            comments: [
              {
                ...serverReply,
                deleteAction:
                  '{"performCommentActionEndpoint":{"actions":[{"type":"delete"}]}}',
              },
            ],
          })
        : threadPage(),
    );
    await renderHarness();
    await act(async () => {
      await latest.toggleReplies("c1", "REPLIES_TOKEN");
    });
    await vi.waitFor(() => expect(latest.replies["c1"]?.length).toBe(1));
    let deleted = false;
    await act(async () => {
      deleted = await latest.deleteComment("r1");
    });
    expect(deleted).toBe(true);
    expect(latest.replies["c1"]).toEqual([]);
    expect(latest.comments[0]?.replyCount).toBe(1);
  });

  it("keeps the comment when the delete fails", async () => {
    getComments.mockResolvedValue(
      threadPage({
        comments: [
          {
            id: "c1",
            author: "Me",
            authorThumbnail: null,
            text: "mine",
            publishedText: "1 hour ago",
            likeCount: 0,
            replyCount: 0,
            isOwn: true,
            deleteAction: '{"performCommentActionEndpoint":{"actions":[{"type":"delete"}]}}',
          },
        ],
      }),
    );
    deleteCommentApi.mockRejectedValueOnce(new BackendApiError("nope", "unknown", null));
    await renderHarness();
    let deleted = true;
    await act(async () => {
      deleted = await latest.deleteComment("c1");
    });
    expect(deleted).toBe(false);
    expect(latest.comments.map((comment) => comment.id)).toEqual(["c1"]);
  });
});
