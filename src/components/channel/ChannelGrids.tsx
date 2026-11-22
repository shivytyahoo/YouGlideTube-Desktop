import React, { useMemo } from "react";
import { PlaylistCard } from "../video/PlaylistCard";
import { PostCard } from "../video/PostCard";
import { ShortCard } from "../shorts/ShortCard";
import type { 
  ShortVideoSummary, 
  PlaylistSummary, 
  PostSummary 
} from "../../types/video";
import { useGridStyle } from "../../lib/useGridColumns";
import type { ShortsQueueSource } from "../../lib/shortsQueueSource";

// --- Shorts Grid ---

interface ChannelShortsGridProps {
  shorts: ShortVideoSummary[];
  /** The channel tab these shorts came from, so tapping one opens the channel's paginated queue. */
  queue?: {
    channelId: string;
    sortIndex: number;
    tabParams: string | null;
    pageToken: string | null;
  } | null;
}

export const ChannelShortsGrid: React.FC<ChannelShortsGridProps> = ({ shorts, queue }) => {
  const gridStyle = useGridStyle({ density: "dense" });
  const queueSource = useMemo<ShortsQueueSource | undefined>(() => {
    if (!queue) return undefined;
    return {
      kind: "channel",
      channelId: queue.channelId,
      startVideoId: "",
      sortIndex: queue.sortIndex,
      tabParams: queue.tabParams,
      pageToken: queue.pageToken,
    };
  }, [queue]);
  if (!shorts.length) return null;

  return (
    <div className="video-grid gap-y-4" style={gridStyle}>
      {shorts.map((short) => (
        <ShortCard
          key={short.id}
          short={short}
          queue={shorts}
          queueSource={queueSource}
        />
      ))}
    </div>
  );
};

// --- Playlists Grid ---

interface ChannelPlaylistsGridProps {
  playlists: PlaylistSummary[];
}

export const ChannelPlaylistsGrid: React.FC<ChannelPlaylistsGridProps> = ({ playlists }) => {
  const gridStyle = useGridStyle({ gapRem: 1.5 });
  if (!playlists.length) return null;

  return (
    <div className="video-grid gap-y-6" style={gridStyle}>
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </div>
  );
};

// --- Posts Feed ---

interface ChannelPostsFeedProps {
  posts: PostSummary[];
}

export const ChannelPostsFeed: React.FC<ChannelPostsFeedProps> = ({ posts }) => {
  if (!posts.length) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
};
