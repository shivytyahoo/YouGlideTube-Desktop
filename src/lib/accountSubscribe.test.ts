import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  restoreSubscription,
  toggleSubscription,
  unsubscribeChannel,
} from "./accountSubscribe";
import type { UnsubscribedChannel } from "../store/useSubscriptionStore";

const getAccountSignedIn = vi.fn();
const setChannelSubscribed = vi.fn();
const confirmAction = vi.fn();
const listen = vi.fn();
const unlisten = vi.fn();
const showToast = vi.fn();
const openSignInDialog = vi.fn();

vi.mock("./api/account", () => ({
  getAccountSignedIn: (...args: unknown[]) => getAccountSignedIn(...args),
  setChannelSubscribed: (...args: unknown[]) => setChannelSubscribed(...args),
}));
vi.mock("./dialogs", () => ({
  confirmAction: (...args: unknown[]) => confirmAction(...args),
}));
vi.mock("./i18n/index", () => ({ getString: (key: string) => key }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("../store/useUiStore", () => ({
  useUiStore: { getState: () => ({ showToast, openSignInDialog }) },
}));

const subscribedIds = new Set<string>();
const storeState = {
  isSubscribed: vi.fn((channelId: string) => subscribedIds.has(channelId)),
  subscribe: vi.fn(async (channelId: string) => {
    subscribedIds.add(channelId);
  }),
  unsubscribe: vi.fn(
    async (channelId: string): Promise<UnsubscribedChannel | null> => {
      if (!subscribedIds.has(channelId)) return null;
      subscribedIds.delete(channelId);
      return { channel: { id: channelId, name: channelId }, groupNames: [] };
    },
  ),
  restoreSubscription: vi.fn(async (removed: UnsubscribedChannel) => {
    subscribedIds.add(removed.channel.id);
  }),
};

vi.mock("../store/useSubscriptionStore", () => ({
  useSubscriptionStore: { getState: () => storeState },
}));

describe("accountSubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribedIds.clear();
    getAccountSignedIn.mockResolvedValue(true);
    setChannelSubscribed.mockResolvedValue(true);
    listen.mockResolvedValue(unlisten);
  });

  it("subscribes locally first, then confirms on the server", async () => {
    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(true);
    expect(storeState.subscribe).toHaveBeenCalledWith("ch-1", "Channel One", undefined, {
      learn: true,
    });
    expect(setChannelSubscribed).toHaveBeenCalledWith("ch-1", true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("rolls the local subscribe back when the server refuses", async () => {
    setChannelSubscribed.mockRejectedValueOnce(new Error("server down"));

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(false);
    expect(storeState.unsubscribe).toHaveBeenCalledWith("ch-1", { learn: true });
    expect(subscribedIds.has("ch-1")).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("unsubscribes locally and on the server", async () => {
    subscribedIds.add("ch-1");

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(true);
    expect(setChannelSubscribed).toHaveBeenCalledWith("ch-1", false);
    expect(subscribedIds.has("ch-1")).toBe(false);
  });

  it("restores the local unsubscribe when the server refuses", async () => {
    subscribedIds.add("ch-1");
    setChannelSubscribed.mockRejectedValueOnce(new Error("server down"));

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(false);
    expect(storeState.restoreSubscription).toHaveBeenCalledTimes(1);
    expect(subscribedIds.has("ch-1")).toBe(true);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("gates a signed-out subscribe on the sign-in dialog and finishes it after sign-in", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    confirmAction.mockResolvedValue(true);

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(false);
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "sign_in_to_subscribe_title",
        message: "sign_in_to_subscribe_message",
      }),
    );
    expect(openSignInDialog).toHaveBeenCalledTimes(1);
    expect(storeState.subscribe).not.toHaveBeenCalled();

    const handler = listen.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();
    getAccountSignedIn.mockResolvedValue(true);

    handler!();
    await vi.waitFor(() => expect(storeState.subscribe).toHaveBeenCalledTimes(1));
    expect(setChannelSubscribed).toHaveBeenCalledWith("ch-1", true);
    expect(subscribedIds.has("ch-1")).toBe(true);
  });

  it("does nothing when the signed-out user declines the sign-in gate", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    confirmAction.mockResolvedValue(false);

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(false);
    expect(openSignInDialog).not.toHaveBeenCalled();
    expect(storeState.subscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes locally only while signed out", async () => {
    getAccountSignedIn.mockResolvedValue(false);
    subscribedIds.add("ch-1");

    const changed = await toggleSubscription("ch-1", "Channel One");

    expect(changed).toBe(true);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(setChannelSubscribed).not.toHaveBeenCalled();
    expect(subscribedIds.has("ch-1")).toBe(false);
  });

  it("unsubscribeChannel returns what was removed, and null when the server refuses", async () => {
    subscribedIds.add("ch-1");

    const removed = await unsubscribeChannel("ch-1");
    expect(removed).toMatchObject({ channel: { id: "ch-1" } });
    expect(setChannelSubscribed).toHaveBeenCalledWith("ch-1", false);

    subscribedIds.add("ch-1");
    setChannelSubscribed.mockRejectedValueOnce(new Error("server down"));
    const refused = await unsubscribeChannel("ch-1");
    expect(refused).toBeNull();
    expect(subscribedIds.has("ch-1")).toBe(true);
  });

  it("restoreSubscription restores locally and on the server", async () => {
    await restoreSubscription({ channel: { id: "ch-1", name: "Channel One" }, groupNames: [] });

    expect(storeState.restoreSubscription).toHaveBeenCalledTimes(1);
    expect(setChannelSubscribed).toHaveBeenCalledWith("ch-1", true);
  });
});
