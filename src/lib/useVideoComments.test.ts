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

vi.mock("./api/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/youtube")>()),
  getComments: (...args: unknown[]) => getComments(...args),
  getPostComments: (...args: unknown[]) => getPostComments(...args),
  createComment: (...args: unknown[]) => createComment(...args),
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
