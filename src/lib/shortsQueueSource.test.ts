// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  decodeShortsQueueSource,
  encodeShortsQueueSource,
  queueSourceContinuesIntoFeed,
  queueSourceOpenAtVideoId,
  type ShortsQueueSource,
} from "./shortsQueueSource";

describe("shortsQueueSource", () => {
  it("round-trips every source through its encoding", () => {
    const sources: ShortsQueueSource[] = [
      { kind: "feed" },
      { kind: "seeded", startVideoId: "abc12345678" },
      {
        kind: "channel",
        channelId: "UCcreator0001",
        startVideoId: "abc12345678",
        sortIndex: 1,
        tabParams: null,
        pageToken: null,
      },
      { kind: "subscriptions", startVideoId: "abc12345678" },
      { kind: "subscriptions", startVideoId: "" },
      { kind: "snapshot", token: "shelf-1", startVideoId: "abc12345678" },
    ];
    for (const source of sources) {
      const decoded = decodeShortsQueueSource(encodeShortsQueueSource(source));
      expect(decoded.kind).toBe(source.kind);
      if (source.kind === "channel" && decoded.kind === "channel") {
        expect(decoded.channelId).toBe(source.channelId);
        expect(decoded.sortIndex).toBe(source.sortIndex);
        expect(decoded.startVideoId).toBe(source.startVideoId);
      }
      if (source.kind === "seeded" && decoded.kind === "seeded") {
        expect(decoded.startVideoId).toBe(source.startVideoId);
      }
      if (source.kind === "snapshot" && decoded.kind === "snapshot") {
        expect(decoded.token).toBe(source.token);
      }
    }
  });

  it("falls back to the feed for anything unrecognised", () => {
    expect(decodeShortsQueueSource(null)).toEqual({ kind: "feed" });
    expect(decodeShortsQueueSource("")).toEqual({ kind: "feed" });
    expect(decodeShortsQueueSource("bogus:1:2")).toEqual({ kind: "feed" });
    expect(decodeShortsQueueSource("channel:v:0:/not-a-channel")).toEqual({ kind: "feed" });
    expect(decodeShortsQueueSource("snap::v")).toEqual({ kind: "feed" });
  });

  it("only the feed has no opening short", () => {
    expect(queueSourceOpenAtVideoId({ kind: "feed" })).toBeNull();
    expect(queueSourceOpenAtVideoId({ kind: "seeded", startVideoId: "abc12345678" })).toBe("abc12345678");
    expect(queueSourceOpenAtVideoId({ kind: "subscriptions", startVideoId: "" })).toBeNull();
  });

  it("channel, subscriptions and snapshot queues continue into the feed", () => {
    expect(queueSourceContinuesIntoFeed({ kind: "feed" })).toBe(false);
    expect(queueSourceContinuesIntoFeed({ kind: "seeded", startVideoId: "x" })).toBe(false);
    expect(
      queueSourceContinuesIntoFeed({
        kind: "channel",
        channelId: "UCcreator0001",
        startVideoId: "x",
        sortIndex: 0,
        tabParams: null,
        pageToken: null,
      }),
    ).toBe(true);
    expect(queueSourceContinuesIntoFeed({ kind: "subscriptions", startVideoId: "" })).toBe(true);
    expect(queueSourceContinuesIntoFeed({ kind: "snapshot", token: "t", startVideoId: "x" })).toBe(true);
  });
});
