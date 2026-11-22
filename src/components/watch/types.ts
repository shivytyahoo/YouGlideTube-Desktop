import type { ReactNode } from "react";
import type {
  VideoSummary,
  VideoDetails,
  RelatedContentItem,
} from "../../types/video";
import type { DeArrowOverride, RydData } from "../../lib/api/foss";

export interface WatchLayoutSlots {
  player: ReactNode;
  metadata: ReactNode;
  description: ReactNode;
  comments: ReactNode;
  sidebar: ReactNode;
}

export type WatchLayoutProps = WatchLayoutSlots;

export interface PlayerCoreProps {
  videoId: string;
  videoDetails: VideoDetails | null;
  onEnded?: () => void;
}

export interface WatchMetadataProps {
  currentVideo: VideoSummary;
  videoData: VideoDetails | null;
  dearrowData: DeArrowOverride | null;
  rydData: RydData | null;
}

export interface DescriptionCardProps {
  currentVideo: VideoSummary;
  videoData: VideoDetails | null;
  onSeek?: (seconds: number) => void;
}

export interface RelatedVideosProps {
  items: RelatedContentItem[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: RelatedContentItem) => void;
  onAddToQueue?: (video: VideoSummary) => void;
  /** "full_width" renders each card as a full-width row instead of a compact card. */
  variant?: "compact" | "full_width";
}

export interface CommentsSectionProps {
  videoId: string;
  hideHeader?: boolean;
  postId?: string | null;
  postCommentParams?: string | null;
  /** Fills a side panel: the header stays and the list scrolls. */
  fill?: boolean;
  onClose?: () => void;
}

export interface LiveChatProps {
  videoId: string;
  /** A finished stream: its chat is replayed in step with the player. */
  isReplay?: boolean;
  /** Fills its container's height, as the fullscreen side panel, instead of a fixed card height. */
  fill?: boolean;
  /** Shows a close button in the header. */
  onClose?: () => void;
}

export interface WatchErrorStateProps {
  message: string;
  /** The backend error `kind`: a known one renders its own title and hint. */
  kind?: string;
  /** Opens sign-in, for failures a signed-in account can clear (login-required, age-restricted). */
  onSignIn?: () => void;
  onRetryWithProxy?: () => void;
  onGoBack: () => void;
}
