// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentsSection } from "./CommentsSection";
import { useUiStore } from "../../store/useUiStore";
import { useConfirmStore } from "../../store/useConfirmStore";
import type { Comment } from "../../types/video";

const thread = vi.hoisted(() => ({
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
  ] as Comment[],
  loading: false,
  countText: "1 comment",
  totalCount: 1,
  disabled: false,
  sortOptions: [],
  selectSort: vi.fn(),
  nextPageToken: null,
  loadingMore: false,
  replies: {},
  repliesLoading: {},
  repliesNextToken: {},
  expanded: {},
  loadMore: vi.fn(),
  toggleReplies: vi.fn(),
  loadReplies: vi.fn(),
  createCommentParams: "Ehk123" as string | null,
  posting: false,
  postError: null as string | null,
  postComment: vi.fn(async (_text: string) => true),
  postReply: vi.fn(async (_comment: Comment, _text: string) => true),
  deleteComment: vi.fn(async (_commentId: string) => true),
}));
vi.mock("../../lib/useVideoComments", () => ({
  useVideoComments: () => thread,
}));

const accountState = vi.hoisted(() => ({ status: "signed-in" }));
vi.mock("../../lib/useGoogleAccount", () => ({
  useGoogleAccount: () => ({ status: accountState.status }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderSection() {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(CommentsSection, { videoId: "vid00000001" })));
  });
}

function textarea(): HTMLTextAreaElement | null {
  return host.querySelector("textarea");
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

function buttons(text: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
}

function replyArea(): HTMLTextAreaElement | undefined {
  return [...host.querySelectorAll("textarea")].find((area) => area.placeholder === "Add a reply…");
}

const defaultComment: Comment = {
  id: "c1",
  author: "Someone",
  authorThumbnail: null,
  text: "First!",
  publishedText: "1 hour ago",
  likeCount: 3,
  replyCount: 0,
};

function typeText(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  thread.comments = [{ ...defaultComment }];
  thread.replies = {};
  thread.repliesLoading = {};
  thread.repliesNextToken = {};
  thread.expanded = {};
  thread.createCommentParams = "Ehk123";
  thread.posting = false;
  thread.postError = null;
  thread.postComment.mockResolvedValue(true);
  thread.postReply.mockResolvedValue(true);
  thread.deleteComment.mockResolvedValue(true);
  accountState.status = "signed-in";
  useUiStore.setState({ toast: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

describe("CommentsSection composer", () => {
  it("shows the composer when the page carried a comment box token", () => {
    renderSection();
    expect(textarea()?.placeholder).toBe("Add a comment…");
    expect(button("Comment")).toBeDefined();
  });

  it("posts the draft and clears it on success", async () => {
    renderSection();
    const area = textarea()!;
    typeText(area, "hello there");
    await act(async () => {
      button("Comment")!.click();
    });
    expect(thread.postComment).toHaveBeenCalledWith("hello there");
    await vi.waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Comment posted"));
    expect(textarea()!.value).toBe("");
  });

  it("keeps the draft when posting fails", async () => {
    thread.postComment.mockResolvedValueOnce(false);
    thread.postError = "nope";
    renderSection();
    const area = textarea()!;
    typeText(area, "hello there");
    await act(async () => {
      button("Comment")!.click();
    });
    expect(thread.postComment).toHaveBeenCalledWith("hello there");
    expect(textarea()!.value).toBe("hello there");
  });

  it("offers sign-in instead of a composer when signed out and the page has no token", () => {
    thread.createCommentParams = null;
    accountState.status = "signed-out";
    renderSection();
    expect(textarea()).toBeNull();
    expect(button("Sign in to comment")).toBeDefined();
  });

  it("shows nothing to post with when signed in but the page has no token", () => {
    thread.createCommentParams = null;
    renderSection();
    expect(textarea()).toBeNull();
    expect(button("Sign in to comment")).toBeUndefined();
  });
});

describe("CommentsSection replies", () => {
  it("offers a Reply box on a comment that carries a reply token", async () => {
    thread.comments = [
      { ...defaultComment, replyParams: "REPLY_TOKEN", replyPath: "comment/create_comment_reply" },
    ];
    renderSection();
    expect(button("Reply")).toBeDefined();
    act(() => {
      button("Reply")!.click();
    });
    const area = replyArea();
    expect(area).toBeDefined();
    typeText(area!, "thanks!");
    await act(async () => {
      const replyButtons = buttons("Reply");
      replyButtons[replyButtons.length - 1]!.click();
    });
    expect(thread.postReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
      "thanks!",
    );
    await vi.waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Reply posted"));
    expect(replyArea()).toBeUndefined();
  });

  it("keeps the reply draft when posting the reply fails", async () => {
    thread.comments = [{ ...defaultComment, replyParams: "REPLY_TOKEN" }];
    thread.postReply.mockResolvedValueOnce(false);
    renderSection();
    act(() => {
      button("Reply")!.click();
    });
    const area = replyArea()!;
    typeText(area, "thanks!");
    await act(async () => {
      const replyButtons = buttons("Reply");
      replyButtons[replyButtons.length - 1]!.click();
    });
    expect(thread.postReply).toHaveBeenCalledTimes(1);
    expect(replyArea()!.value).toBe("thanks!");
    expect(replyArea()!.closest("div")?.textContent).toContain("Couldn't post the comment");
  });

  it("hides the Reply button when the comment carries no reply token", () => {
    renderSection();
    expect(button("Reply")).toBeUndefined();
  });

  it("shows replies nested under the reply they answered", async () => {
    thread.comments = [{ ...defaultComment, replyCount: 2 }];
    thread.replies = {
      c1: [
        { id: "r1", author: "@a", authorThumbnail: null, text: "start", publishedText: "1h", likeCount: 0, replyCount: 0 },
        { id: "r2", author: "@b", authorThumbnail: null, text: "@a answering you", publishedText: "1h", likeCount: 0, replyCount: 0 },
      ],
    };
    thread.expanded = { c1: true };
    renderSection();
    const items = [...host.querySelectorAll("[data-comment-id]")];
    expect(items.map((item) => item.getAttribute("data-comment-id"))).toEqual(["c1"]);
    // The nested reply sits inside the thread's indented branch, not beside its parent.
    const nested = host.querySelector(".border-s-2 .border-s-2");
    expect(nested?.textContent).toContain("answering you");
  });
});

describe("CommentsSection deletes", () => {
  it("offers Delete behind the options menu on the viewer's own comment", async () => {
    thread.comments = [
      {
        ...defaultComment,
        isOwn: true,
        deleteAction: '{"performCommentActionEndpoint":{"actions":[{"type":"delete"}]}}',
      },
    ];
    renderSection();
    const options = host.querySelector('button[aria-label="Comment options"]');
    expect(options).toBeDefined();
    act(() => {
      (options as HTMLButtonElement).click();
    });
    const deleteButton = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Delete",
    );
    expect(deleteButton).toBeDefined();
    await act(async () => {
      deleteButton!.click();
      useConfirmStore.getState().answer(true);
    });
    await vi.waitFor(() => expect(thread.deleteComment).toHaveBeenCalledWith("c1"));
  });

  it("hides the options menu on a comment that is not the viewer's own", () => {
    renderSection();
    expect(host.querySelector('button[aria-label="Comment options"]')).toBeNull();
  });
});
