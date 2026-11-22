import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  blockChannel: vi.fn(),
  unblockChannel: vi.fn(),
}));
vi.mock("../lib/api/db", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
  addWatchRecord: vi.fn(async () => undefined),
  blockChannel: (...args: unknown[]) => api.blockChannel(...args),
  unblockChannel: (...args: unknown[]) => api.unblockChannel(...args),
}));

import { matchBlockedKeyword, normalizeKeyword, useFeedActionsStore } from "./useFeedActionsStore";
import type { VideoSummary } from "../types/video";

function video(title: string, channelName = "Some Channel"): VideoSummary {
  return { id: "abc", title, channelName };
}

describe("matchBlockedKeyword", () => {
  it("returns null when nothing is blocked", () => {
    expect(matchBlockedKeyword(video("Rust in 100 seconds"), [])).toBeNull();
  });

  it("matches a single word on word boundaries only", () => {
    expect(matchBlockedKeyword(video("Ass kicking gameplay"), ["ass"])).toBe("ass");
    expect(matchBlockedKeyword(video("A class on compilers"), ["ass"])).toBeNull();
  });

  it("matches a phrase anywhere in the title", () => {
    expect(matchBlockedKeyword(video("Reacting to the finale"), ["reacting to"])).toBe("reacting to");
  });

  it("matches the channel name as well as the title", () => {
    expect(matchBlockedKeyword(video("A video", "Drama Alert"), ["drama"])).toBe("drama");
  });

  it("ignores case on both sides", () => {
    expect(matchBlockedKeyword(video("SPOILERS ahead"), [normalizeKeyword("  Spoilers ")])).toBe(
      "spoilers",
    );
  });

  it("matches non-ascii words on boundaries", () => {
    expect(matchBlockedKeyword(video("新しい 動画 です"), ["動画"])).toBe("動画");
  });

  it("returns the first matching keyword", () => {
    expect(matchBlockedKeyword(video("Spoilers and drama"), ["drama", "spoilers"])).toBe("drama");
  });
});

describe("feed actions", () => {
  const card = (id: string): VideoSummary => ({ id, title: "A video", channelName: "Chan", channelId: "UC1" });

  beforeEach(() => {
    useFeedActionsStore.setState({
      dismissedVideoIds: new Set(),
      blockedChannelIds: new Set(),
      suppressedChannelIds: new Map(),
    });
    api.blockChannel.mockReset().mockResolvedValue(undefined);
    api.unblockChannel.mockReset().mockResolvedValue(undefined);
  });

  it("lets an unblocked channel back into the feeds", async () => {
    await useFeedActionsStore.getState().blockChannel(card("a"));
    await useFeedActionsStore.getState().notInterested(card("b"));
    await useFeedActionsStore.getState().unblockChannel("UC1");
    const state = useFeedActionsStore.getState();
    expect(state.blockedChannelIds.has("UC1")).toBe(false);
    expect(state.suppressedChannelIds.has("UC1")).toBe(false);
    expect(api.unblockChannel).toHaveBeenCalledWith("UC1");
  });

  it("keeps a channel hidden when the backend cannot unblock it", async () => {
    await useFeedActionsStore.getState().blockChannel(card("a"));
    api.unblockChannel.mockRejectedValue(new Error("db"));
    await expect(useFeedActionsStore.getState().unblockChannel("UC1")).rejects.toThrow("db");
    expect(useFeedActionsStore.getState().blockedChannelIds.has("UC1")).toBe(true);
  });

  it("never turns a second not interested into a channel block", async () => {
    await useFeedActionsStore.getState().notInterested(card("a"));
    await useFeedActionsStore.getState().notInterested(card("b"));
    const state = useFeedActionsStore.getState();
    expect(state.blockedChannelIds.size).toBe(0);
    expect(api.blockChannel).not.toHaveBeenCalled();
    expect(state.suppressedChannelIds.has("UC1")).toBe(true);
    expect([...state.dismissedVideoIds]).toEqual(["a", "b"]);
  });

  it("marks not interested locally, with no backend call", async () => {
    await useFeedActionsStore.getState().notInterested(card("a"));
    const state = useFeedActionsStore.getState();
    expect(state.dismissedVideoIds.has("a")).toBe(true);
    expect(state.suppressedChannelIds.has("UC1")).toBe(true);
    expect(api.blockChannel).not.toHaveBeenCalled();
  });

  it("keeps the channel's name with the block", async () => {
    await useFeedActionsStore.getState().blockChannel(card("a"));
    expect(api.blockChannel).toHaveBeenCalledWith("UC1", "Chan");
  });

  it("rolls a channel block back when the backend fails", async () => {
    api.blockChannel.mockRejectedValue(new Error("db"));
    await expect(useFeedActionsStore.getState().blockChannel(card("a"))).rejects.toThrow("db");
    expect(useFeedActionsStore.getState().blockedChannelIds.size).toBe(0);
  });

  it("lets 'I want more like this' lift a not-interested mark", async () => {
    await useFeedActionsStore.getState().notInterested(card("a"));
    await useFeedActionsStore.getState().interested(card("a"));
    const state = useFeedActionsStore.getState();
    expect(state.dismissedVideoIds.has("a")).toBe(false);
    expect(state.suppressedChannelIds.has("UC1")).toBe(false);
  });

  it("undoes a not-interested mark without touching other videos", async () => {
    await useFeedActionsStore.getState().notInterested(card("a"));
    await useFeedActionsStore.getState().notInterested(card("b"));
    useFeedActionsStore.getState().undoNotInterested(card("a"));
    const state = useFeedActionsStore.getState();
    expect(state.dismissedVideoIds.has("a")).toBe(false);
    expect(state.dismissedVideoIds.has("b")).toBe(true);
  });

  it("interested on a video never marked changes nothing", async () => {
    await useFeedActionsStore.getState().interested(card("a"));
    const state = useFeedActionsStore.getState();
    expect(state.dismissedVideoIds.size).toBe(0);
    expect(state.suppressedChannelIds.size).toBe(0);
  });
});
