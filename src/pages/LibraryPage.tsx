import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Clock, Disc3, Download, FolderOpen, History, ListVideo, Music2, Settings, ThumbsUp } from "lucide-react";
import type { VideoSummary } from "../types/video";
import type { PlaylistItem, SongItem } from "../types/music";
import { getString } from "../lib/i18n/index";
import { hiddenOnLibraryPage, useHiddenLibrarySections } from "../lib/librarySections";
import { useMusicEnabled, withMusic } from "../lib/useMusicContent";
import { useShortsEnabled, videosWithShorts } from "../lib/useShortsContent";
import { useLibrary, type LibraryPlaylist } from "../lib/useLibrary";
import { useServerMusicLibrary } from "../lib/useServerMusicLibrary";
import { downloadedMusicCollectionPath } from "../lib/musicRoutes";
import { historyVideoToSong, type HistoryVideo } from "../lib/useHistory";
import { playLocalFiles } from "../lib/localMedia/playback";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useLocalMediaStore } from "../store/useLocalMediaStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "../lib/settings/schema";
import {
  albumDetailPath,
  storedAlbumToItem,
  type StoredAlbum,
} from "../store/useAlbumLibraryStore";
import { LibraryShelf } from "../components/library/LibraryShelf";
import { LocalFileCard } from "../components/localMedia/LocalFileCard";
import { RecapEntryCard } from "../components/recap/RecapEntryCard";
import { Button } from "../components/ui/Button";
import { VideoCard } from "../components/video/VideoCard";
import { PlaylistCard } from "../components/video/PlaylistCard";
import { MusicItemCard } from "../components/music/MusicItemCard";
import { ShortCard } from "../components/shorts/ShortCard";
import { NotesShelf } from "../components/note/NotesShelf";
import { ShortsIcon } from "../components/ui/ShortsIcon";
import type { ShortVideoSummary } from "../types/video";

const videoIdOf = (item: { videoId?: string | null; id: string }) => item.videoId ?? item.id;

function HistoryShelfRow({
  items,
  onPlay,
  onAddToQueue,
}: {
  items: HistoryVideo[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const musicSongs = useMemo(
    () => items.filter((item) => item.isMusic).map(historyVideoToSong),
    [items],
  );

  return (
    <>
      {items.map((item, index) => {
        if (item.isMusic) {
          const song = historyVideoToSong(item);
          const queueIndex = Math.max(
            0,
            musicSongs.findIndex((s) => videoIdOf(s) === videoIdOf(song)),
          );
          return (
            <div key={`${item.id}-${index}`} className="w-[160px] md:w-[200px] shrink-0">
              <MusicItemCard
                variant="song"
                item={song}
                fill
                onPlay={() => void playQueue(musicSongs, queueIndex)}
              />
            </div>
          );
        }
        return (
          <div key={`${item.id}-${index}`} className="w-[280px] md:w-[320px] shrink-0">
            <VideoCard
              video={item}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              variant="grid"
              hideChannelAvatar
            />
          </div>
        );
      })}
    </>
  );
}

interface LibraryPageProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}

function VideoShelfRow({
  videos,
  onPlay,
  onAddToQueue,
}: {
  videos: VideoSummary[];
  onPlay: (video: VideoSummary) => void;
  onAddToQueue?: (video: VideoSummary) => void;
}) {
  return (
    <>
      {videos.map((video, index) => (
        <div
          key={`${video.id}-${index}`}
          className="w-[280px] md:w-[320px] shrink-0"
        >
          <VideoCard
            video={video}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
            variant="grid"
            hideChannelAvatar
          />
        </div>
      ))}
    </>
  );
}

function PlaylistShelfRow({ playlists }: { playlists: LibraryPlaylist[] }) {
  return (
    <>
      {playlists.map((playlist) => (
        <div key={playlist.id} className="w-[200px] shrink-0">
          <PlaylistCard playlist={playlist} />
        </div>
      ))}
    </>
  );
}

function MusicPlaylistShelfRow({
  playlists,
  onOpen,
}: {
  playlists: PlaylistItem[];
  onOpen: (playlist: PlaylistItem) => void;
}) {
  return (
    <>
      {playlists.map((playlist) => (
        <div key={playlist.id} className="w-[160px] md:w-[200px] shrink-0">
          <MusicItemCard
            variant="playlist"
            item={playlist}
            fill
            onOpen={() => onOpen(playlist)}
            onPlay={() => onOpen(playlist)}
          />
        </div>
      ))}
    </>
  );
}

function AlbumShelfRow({
  albums,
  onOpenAlbum,
}: {
  albums: StoredAlbum[];
  onOpenAlbum: (album: StoredAlbum) => void;
}) {
  return (
    <>
      {albums.map((album) => (
        <div key={album.id} className="w-[160px] md:w-[200px] shrink-0">
          <MusicItemCard
            variant="album"
            item={storedAlbumToItem(album)}
            fill
            onOpen={() => onOpenAlbum(album)}
            onPlay={() => onOpenAlbum(album)}
          />
        </div>
      ))}
    </>
  );
}

function DownloadVideoShelfRow({
  videos,
  onPlay,
}: {
  videos: VideoSummary[];
  onPlay: (video: VideoSummary) => void;
}) {
  return (
    <>
      {videos.map((video, index) => (
        <div key={`${video.id}-${index}`} className="w-[280px] md:w-[320px] shrink-0">
          <VideoCard video={video} onPlay={onPlay} hideChannelAvatar />
        </div>
      ))}
    </>
  );
}

function libraryStats(playlists: number, albums: number, shorts: number, shortsEnabled: boolean, musicEnabled: boolean) {
  if (musicEnabled) {
    return shortsEnabled
      ? getString("library_stats_summary", playlists, albums, shorts)
      : getString("library_stats_summary_no_shorts", playlists, albums);
  }
  return shortsEnabled
    ? getString("library_stats_summary_no_albums", playlists, shorts)
    : getString("library_stats_summary_playlists_only", playlists);
}

function MusicDownloadShelfRow({ songs }: { songs: SongItem[] }) {
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  return (
    <>
      {songs.map((song, index) => (
        <div key={`${song.id}-${index}`} className="w-[160px] md:w-[200px] shrink-0">
          <MusicItemCard variant="song" item={song} fill onPlay={() => void playQueue(songs, index)} />
        </div>
      ))}
    </>
  );
}

function ShortsShelfRow({ shorts }: { shorts: ShortVideoSummary[] }) {
  return (
    <>
      {shorts.map((short) => (
        <ShortCard
          finiteQueue
          key={short.id}
          short={short}
          queue={shorts}
          variant="shelf"
        />
      ))}
    </>
  );
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ onPlay, onAddToQueue }) => {
  const navigate = useNavigate();
  const {
    history,
    playlists,
    savedAlbums,
    watchLater,
    liked,
    savedShorts,
    videoDownloads,
    musicDownloads,
    loading,
  } = useLibrary();

  const shortsEnabled = useShortsEnabled();
  const musicEnabled = useMusicEnabled();
  const libraryPreviews = useAppSettingsStore((state) => state.values[SETTINGS.LIBRARY_PREVIEWS] !== "false");
  const separatePlaylists = useAppSettingsStore((state) => state.values[SETTINGS.SEPARATE_PLAYLISTS] === "true");
  const hidden = hiddenOnLibraryPage(useHiddenLibrarySections(), shortsEnabled, musicEnabled);
  const serverMusicLibrary = useServerMusicLibrary();
  const localMediaFiles = useLocalMediaStore((s) => s.files);
  const localMediaPlays = useLocalMediaStore((s) => s.plays);
  const localMediaLoaded = useLocalMediaStore((s) => s.loaded);
  const loadLocalMedia = useLocalMediaStore((s) => s.load);

  useEffect(() => {
    if (!localMediaLoaded) void loadLocalMedia();
  }, [localMediaLoaded, loadLocalMedia]);

  const isEmpty = (length: number) => !loading && length === 0;

  const statsText = libraryStats(playlists.length, savedAlbums.length, savedShorts.length, shortsEnabled, musicEnabled);
  const historyShown = withMusic(videosWithShorts(history, shortsEnabled), musicEnabled);
  const likedVideos = liked.filter((item) => !item.isMusic);
  const likedMusic = withMusic(liked.filter((item) => item.isMusic), musicEnabled);
  const musicPlaylists = useMemo(
    () => serverMusicLibrary.playlists.slice(0, 15),
    [serverMusicLibrary.playlists],
  );
  const localVideoFiles = useMemo(
    () => localMediaFiles.filter((file) => file.kind === "video").slice(0, 15),
    [localMediaFiles],
  );

  const handleOpenAlbum = (album: StoredAlbum) => {
    navigate(albumDetailPath(album));
  };

  return (
    <div className="max-w-[1800px] mx-auto px-6 md:px-8 pt-8 pb-12 flex flex-col gap-10">
      <header className="flex items-center gap-5">

        <div className="min-w-0">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-chrome-neutral-100">
            {getString("library_page_title")}
          </h1>
          <p className="mt-2 text-sm text-chrome-neutral-400">{statsText}</p>
        </div>
        <Button type="button" variant="tonal" className="ms-auto shrink-0" onClick={() => navigate("/local-media")}>
          <FolderOpen size={16} />
          {getString("library_local_media_label")}
        </Button>
      </header>

      <RecapEntryCard />

      {!hidden.has("HISTORY") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_history_label")}
          icon={History}
          viewAllTo="/history"
          isEmpty={isEmpty(historyShown.length)}
        >
          <HistoryShelfRow items={historyShown} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {separatePlaylists ? (
        <>
          {!hidden.has("VIDEO_PLAYLISTS") && (
            <LibraryShelf
              showPreview={libraryPreviews}
              title={getString("library_video_playlists_label")}
              icon={ListVideo}
              viewAllTo="/playlists"
              isEmpty={isEmpty(playlists.length)}
            >
              <PlaylistShelfRow playlists={playlists} />
            </LibraryShelf>
          )}

          {!hidden.has("MUSIC_PLAYLISTS") && (
            <LibraryShelf
              showPreview={libraryPreviews}
              title={getString("library_music_playlists_label")}
              icon={Music2}
              viewAllTo="/albums"
              isEmpty={isEmpty(musicPlaylists.length)}
            >
              <MusicPlaylistShelfRow
                playlists={musicPlaylists}
                onOpen={(playlist) => navigate(downloadedMusicCollectionPath(playlist.id))}
              />
            </LibraryShelf>
          )}
        </>
      ) : (
        !hidden.has("VIDEO_PLAYLISTS") && !hidden.has("MUSIC_PLAYLISTS") && (
          <LibraryShelf
            showPreview={libraryPreviews}
            title={getString("library_playlists_label")}
            icon={ListVideo}
            viewAllTo="/playlists"
            isEmpty={isEmpty(playlists.length + musicPlaylists.length)}
          >
            <PlaylistShelfRow playlists={playlists} />
            <MusicPlaylistShelfRow
              playlists={musicPlaylists}
              onOpen={(playlist) => navigate(downloadedMusicCollectionPath(playlist.id))}
            />
          </LibraryShelf>
        )
      )}

      {!hidden.has("ALBUMS") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("albums_title")}
          icon={Disc3}
          viewAllTo="/albums"
          isEmpty={isEmpty(savedAlbums.length)}
        >
          <AlbumShelfRow albums={savedAlbums} onOpenAlbum={handleOpenAlbum} />
        </LibraryShelf>
      )}

      {!hidden.has("SAVED_SHORTS") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_saved_shorts_label")}
          icon={ShortsIcon}
          viewAllTo="/saved-shorts"
          isEmpty={isEmpty(savedShorts.length)}
        >
          <ShortsShelfRow shorts={savedShorts} />
        </LibraryShelf>
      )}

      {!hidden.has("WATCH_LATER") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_watch_later_label")}
          icon={Clock}
          viewAllTo="/watch-later"
          isEmpty={isEmpty(watchLater.length)}
        >
          <VideoShelfRow videos={watchLater} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("LIKED_VIDEOS") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_liked_videos_label")}
          icon={ThumbsUp}
          viewAllTo="/liked"
          isEmpty={isEmpty(likedVideos.length)}
        >
          <HistoryShelfRow items={likedVideos} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("LIKED_MUSIC") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("liked_music")}
          icon={Music2}
          viewAllTo="/liked"
          isEmpty={isEmpty(likedMusic.length)}
        >
          <HistoryShelfRow items={likedMusic} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </LibraryShelf>
      )}

      {!hidden.has("NOTES") && <NotesShelf />}

      {!hidden.has("VIDEO_DOWNLOADS") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_video_downloads_label")}
          icon={Download}
          viewAllTo="/downloads"
          isEmpty={isEmpty(videoDownloads.length)}
        >
          <DownloadVideoShelfRow videos={videoDownloads} onPlay={onPlay} />
        </LibraryShelf>
      )}

      {!hidden.has("MUSIC_DOWNLOADS") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_music_downloads_label")}
          icon={Music2}
          viewAllTo="/downloads"
          isEmpty={isEmpty(musicDownloads.length)}
        >
          <MusicDownloadShelfRow songs={musicDownloads} />
        </LibraryShelf>
      )}

      {!hidden.has("LOCAL_MEDIA") && (
        <LibraryShelf
          showPreview={libraryPreviews}
          title={getString("library_local_media_label")}
          icon={FolderOpen}
          viewAllTo="/local-media"
          isEmpty={isEmpty(localVideoFiles.length)}
        >
          {localVideoFiles.map((file, index) => (
            <div key={file.id} className="w-[280px] md:w-[320px] shrink-0">
              <LocalFileCard
                file={file}
                plays={localMediaPlays}
                nowMs={Date.now()}
                onPlay={() => playLocalFiles(localVideoFiles, index, navigate)}
              />
            </div>
          ))}
        </LibraryShelf>
      )}

      {!hidden.has("SETTINGS") && (
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="flex w-full items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low px-5 py-4 text-start transition-colors hover:bg-surface-container"
        >
          <Settings size={20} className="shrink-0 text-chrome-neutral-300" />
          <span className="text-base font-medium text-chrome-neutral-100">{getString("settings")}</span>
          <ChevronRight size={18} className="ms-auto shrink-0 text-chrome-neutral-500" />
        </button>
      )}
    </div>
  );
};

export default LibraryPage;
