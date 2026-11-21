import { describe, expect, it } from "vitest";

import { CHAPTER_LOOP_END_EPSILON_SECONDS, seekLeavesLoop, shouldLoopBack } from "./chapterLoop";

const loop = { videoId: "v", startSeconds: 10, endSeconds: 20, title: "Intro" };

describe("shouldLoopBack", () => {
  it("fires at the chapter end, slightly early so ended never wins", () => {
    expect(shouldLoopBack(loop, "v", 20)).toBe(true);
    expect(shouldLoopBack(loop, "v", 20 - CHAPTER_LOOP_END_EPSILON_SECONDS)).toBe(true);
    expect(shouldLoopBack(loop, "v", 19)).toBe(false);
  });

  it("ignores other videos, a missing loop and a backwards chapter", () => {
    expect(shouldLoopBack(loop, "other", 25)).toBe(false);
    expect(shouldLoopBack(null, "v", 25)).toBe(false);
    expect(shouldLoopBack({ ...loop, endSeconds: 10 }, "v", 25)).toBe(false);
    expect(shouldLoopBack({ ...loop, videoId: "" }, "v", 25)).toBe(false);
  });
});

describe("seekLeavesLoop", () => {
  it("turns the loop off when the seek lands outside the chapter", () => {
    expect(seekLeavesLoop(loop, "v", 5)).toBe(true);
    expect(seekLeavesLoop(loop, "v", 25)).toBe(true);
    expect(seekLeavesLoop(loop, "v", 10)).toBe(false);
    expect(seekLeavesLoop(loop, "v", 20)).toBe(false);
    expect(seekLeavesLoop(loop, "v", 15)).toBe(false);
  });

  it("ignores other videos and a missing loop", () => {
    expect(seekLeavesLoop(loop, "other", 5)).toBe(false);
    expect(seekLeavesLoop(null, "v", 5)).toBe(false);
  });
});
