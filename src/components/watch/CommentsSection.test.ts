// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentsSection } from "./CommentsSection";
import { useUiStore } from "../../store/useUiStore";
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

function typeText(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  thread.createCommentParams = "Ehk123";
  thread.posting = false;
  thread.postError = null;
  thread.postComment.mockResolvedValue(true);
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
