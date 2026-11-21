import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
vi.mock("../lib/api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
}));

const mocks = vi.hoisted(() => ({
  getNotifications: vi.fn(async (): Promise<import("../lib/api/notifications").NotificationRecord[]> => []),
  getUnreadNotificationCount: vi.fn(async () => 0),
  markNotificationRead: vi.fn(async (_id: number) => {}),
  checkSubscriptionsNow: vi.fn(async () => 0),
}));
vi.mock("../lib/api/notifications", () => ({
  getNotifications: mocks.getNotifications,
  getUnreadNotificationCount: mocks.getUnreadNotificationCount,
  markNotificationRead: mocks.markNotificationRead,
  checkSubscriptionsNow: mocks.checkSubscriptionsNow,
  clearNotifications: vi.fn(async () => {}),
  deleteNotification: vi.fn(async (_id: number) => {}),
  restoreNotification: vi.fn(async () => {}),
}));

import { useNotificationStore } from "./useNotificationStore";
import type { NotificationRecord } from "../lib/api/notifications";

const notification = (id: number, isRead: boolean): NotificationRecord => ({
  id,
  videoId: `video-${id}`,
  title: `Video ${id}`,
  channelId: "UC1",
  channelName: "Channel",
  thumbnailUrl: null,
  publishedText: null,
  kind: "NEW_VIDEO",
  isRead,
  createdAt: 1000 + id,
});

describe("useNotificationStore markRead", () => {
  beforeEach(() => {
    settings.clear();
    vi.clearAllMocks();
    mocks.getNotifications.mockImplementation(async () => []);
    mocks.getUnreadNotificationCount.mockImplementation(async () => 0);
    useNotificationStore.setState({
      notifications: [notification(1, false), notification(2, false)],
      unreadCount: 2,
      lastCheckedAt: null,
      checking: false,
      loaded: true,
    });
  });

  it("marks only the notification that was tapped", async () => {
    await useNotificationStore.getState().markRead(1);
    const state = useNotificationStore.getState();
    expect(state.notifications.find((item) => item.id === 1)?.isRead).toBe(true);
    expect(state.notifications.find((item) => item.id === 2)?.isRead).toBe(false);
    expect(state.unreadCount).toBe(1);
    expect(mocks.markNotificationRead).toHaveBeenCalledWith(1);
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a notification that is already read", async () => {
    useNotificationStore.setState({
      notifications: [notification(1, true)],
      unreadCount: 0,
    });
    await useNotificationStore.getState().markRead(1);
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it("reloads when the backend refuses the write", async () => {
    mocks.markNotificationRead.mockRejectedValueOnce(new Error("db"));
    mocks.getNotifications.mockImplementationOnce(async () => [notification(1, false)]);
    await useNotificationStore.getState().markRead(1);
    expect(mocks.getNotifications).toHaveBeenCalled();
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});

describe("useNotificationStore refreshIfStale", () => {
  beforeEach(() => {
    settings.clear();
    vi.clearAllMocks();
    mocks.getNotifications.mockImplementation(async () => []);
    mocks.getUnreadNotificationCount.mockImplementation(async () => 0);
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      lastCheckedAt: null,
      checking: false,
      loaded: true,
    });
  });

  it("checks on open, then at most once per five minutes", async () => {
    await useNotificationStore.getState().refreshIfStale();
    await useNotificationStore.getState().refreshIfStale();
    expect(mocks.checkSubscriptionsNow).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().lastCheckedAt).not.toBeNull();
  });

  it("does not check while notifications are switched off", async () => {
    settings.set("notifications_enabled", "false");
    await expect(useNotificationStore.getState().checkNow()).resolves.toBe(false);
    expect(mocks.checkSubscriptionsNow).not.toHaveBeenCalled();
  });

  it("does not check while new-video alerts are switched off", async () => {
    settings.set("notif_new_videos_enabled", "false");
    await expect(useNotificationStore.getState().checkNow()).resolves.toBe(false);
    expect(mocks.checkSubscriptionsNow).not.toHaveBeenCalled();
  });

  it("reports a failed check instead of stamping it as done", async () => {
    mocks.checkSubscriptionsNow.mockRejectedValueOnce(new Error("offline"));
    await expect(useNotificationStore.getState().checkNow()).resolves.toBe(false);
    expect(useNotificationStore.getState().lastCheckedAt).toBeNull();
  });
});
