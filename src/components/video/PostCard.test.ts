import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PostCard } from "./PostCard";
import type { PostSummary } from "../../types/video";
import { useUiStore } from "../../store/useUiStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockLikePost } = vi.hoisted(() => ({ mockLikePost: vi.fn(async (_endpoint: string) => {}) }));

vi.mock("../../lib/api/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/youtube")>();
  return { ...actual, likePost: mockLikePost };
});

const LIKE_ACTION = JSON.stringify({
  performCommentActionEndpoint: { actions: [{ type: "like" }] },
});
const UNLIKE_ACTION = JSON.stringify({
  performCommentActionEndpoint: { actions: [{ type: "unlike" }] },
});

function post(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    type: "post",
    id: "Ugkx1",
    authorName: "Author",
    authorAvatar: null,
    textContent: "Hello world",
    attachment: null,
    likesCountText: "42",
    commentCountText: "3",
    publishedTimeText: "2 days ago",
    isLiked: false,
    likeAction: LIKE_ACTION,
    unlikeAction: UNLIKE_ACTION,
    ...overrides,
  };
}

describe("PostCard like button", () => {
  let host: HTMLDivElement;
  let root: Root;

  const renderCard = (value: PostSummary) => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(PostCard, { post: value })));
    });
  };

  const likeButton = () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Like"]')!;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mockLikePost.mockClear();
    mockLikePost.mockImplementation(async () => {});
    useUiStore.setState({ toast: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("flips the count with the icon and calls the like endpoint", async () => {
    renderCard(post());
    await act(async () => {
      likeButton().click();
    });
    expect(mockLikePost).toHaveBeenCalledWith(LIKE_ACTION);
    expect(mockLikePost).toHaveBeenCalledTimes(1);
    expect(likeButton().textContent).toContain("43");
    expect(likeButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("unlikes with the unlike endpoint and flips the count back", async () => {
    renderCard(post());
    await act(async () => {
      likeButton().click();
    });
    await act(async () => {
      likeButton().click();
    });
    expect(mockLikePost).toHaveBeenNthCalledWith(2, UNLIKE_ACTION);
    expect(likeButton().textContent).toContain("42");
    expect(likeButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("rolls the optimistic flip back when the server refuses", async () => {
    mockLikePost.mockRejectedValueOnce(new Error("offline"));
    renderCard(post());
    await act(async () => {
      likeButton().click();
    });
    expect(likeButton().textContent).toContain("42");
    expect(likeButton().getAttribute("aria-pressed")).toBe("false");
    expect(useUiStore.getState().toast?.message).toBe("Couldn't like the post. Try again.");
  });

  it("asks for sign-in when the post carries no like endpoint", async () => {
    renderCard(post({ likeAction: null, unlikeAction: null }));
    await act(async () => {
      likeButton().click();
    });
    expect(mockLikePost).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.message).toBe("Sign in to like this post");
  });
});
