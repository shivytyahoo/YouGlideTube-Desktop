/**
 * Where a Shorts queue comes from, mirroring Android's ShortsQueueSource.
 * The queue decides what a swipe past the end does: a channel, subscriptions
 * or snapshot queue continues into the algorithmic feed; the feed itself and
 * a seeded feed stop where they are.
 */
export type ShortsQueueSource =
  | { kind: "feed" }
  | { kind: "seeded"; startVideoId: string }
  | {
      kind: "channel";
      channelId: string;
      startVideoId: string;
      /** Position of the chosen sort in the channel's own sort bar (Latest, Popular, Oldest). */
      sortIndex: number;
      /** The tab params the channel page browsed, so paging stays in that sort. */
      tabParams: string | null;
      /** The next-page token the channel tab already has, if any. */
      pageToken: string | null;
    }
  | { kind: "subscriptions"; startVideoId: string }
  | { kind: "snapshot"; token: string; startVideoId: string };

export function channelQueueUrl(channelId: string): string {
  return `/channel/${channelId}`;
}

/** Encodes a source the way Android does, so a handoff survives a reload. */
export function encodeShortsQueueSource(source: ShortsQueueSource): string {
  switch (source.kind) {
    case "feed":
      return "feed";
    case "seeded":
      return `feed:${source.startVideoId}`;
    case "channel":
      return `channel:${source.startVideoId}:${source.sortIndex}:${channelQueueUrl(source.channelId)}`;
    case "subscriptions":
      return source.startVideoId ? `subs:${source.startVideoId}` : "subs";
    case "snapshot":
      return `snap:${source.token}:${source.startVideoId}`;
  }
}

/** Parses what {@link encodeShortsQueueSource} produced; anything unrecognised falls back to Feed. */
export function decodeShortsQueueSource(raw: string | null | undefined): ShortsQueueSource {
  const value = raw?.trim() ?? "";
  if (!value) return { kind: "feed" };
  const kind = value.split(":")[0] ?? "";
  const rest = value.includes(":") ? value.slice(value.indexOf(":") + 1) : "";
  switch (kind) {
    case "feed":
      return rest ? { kind: "seeded", startVideoId: rest } : { kind: "feed" };
    case "subs":
      return { kind: "subscriptions", startVideoId: rest };
    case "channel": {
      const startVideoId = rest.split(":")[0] ?? "";
      const afterStart = rest.includes(":") ? rest.slice(rest.indexOf(":") + 1) : "";
      const sortIndex = Number.parseInt(afterStart.split(":")[0] ?? "", 10);
      const channelUrl = afterStart.includes(":") ? afterStart.slice(afterStart.indexOf(":") + 1) : "";
      const match = /\/channel\/(UC[\w-]+)/.exec(channelUrl);
      if (!match) return { kind: "feed" };
      return {
        kind: "channel",
        channelId: match[1] ?? "",
        startVideoId,
        sortIndex: Number.isFinite(sortIndex) ? sortIndex : 0,
        tabParams: null,
        pageToken: null,
      };
    }
    case "snap": {
      const token = rest.split(":")[0] ?? "";
      const startVideoId = rest.includes(":") ? rest.slice(rest.indexOf(":") + 1) : "";
      if (!token) return { kind: "feed" };
      return { kind: "snapshot", token, startVideoId };
    }
    default:
      return { kind: "feed" };
  }
}

/** The short a queue should open on, when the source names one. */
export function queueSourceOpenAtVideoId(source: ShortsQueueSource): string | null {
  switch (source.kind) {
    case "feed":
      return null;
    case "seeded":
    case "channel":
    case "subscriptions":
    case "snapshot":
      return source.startVideoId || null;
  }
}

/** Whether running out of items should hand over to the algorithmic feed. */
export function queueSourceContinuesIntoFeed(source: ShortsQueueSource): boolean {
  return (
    source.kind === "snapshot" || source.kind === "channel" || source.kind === "subscriptions"
  );
}
