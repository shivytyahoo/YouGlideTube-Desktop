import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getDownloadFormats,
  startDownload,
  type CaptionOption,
  type DownloadAudioOption,
  type DownloadableFormat,
  type DownloadStarted,
} from "./api/downloads";
import { getBackendErrorMessage } from "./api/errors";
import {
  defaultSubtitle,
  clipTitle,
  musicDownloadRequest,
  preferredDownloadHeight,
  videoDownloadRequest,
  videoSelectionFor,
  type DownloadClip,
} from "./downloadActions";
import {
  defaultRow,
  displayHeight,
  preferredCodec,
  qualityRows,
  resolutionBadge,
  type CodecChoice,
} from "./downloadOptions";
import { IS_MACOS_RUNTIME } from "./platform";
import { getString } from "./i18n/index";
import { formatTime } from "./musicFormat";
import { recapVideoAction } from "./recap/recapQueue";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";
import { useOriginalTitle } from "./useOriginalTitle";

export type VideoDownloadMode = "video" | "audio";

/** A short description of a format for the dock: "1080p · VP9 · 60 fps". */
export function describeFormat(format: DownloadableFormat): string {
  const fps = format.fps && format.fps > 30 ? ` · ${format.fps} fps` : "";
  const height = displayHeight(format);
  return `${height ? `${height}p` : format.resolution} · ${format.videoCodec}${fps}`;
}

export { resolutionBadge };

/** A video's audio saved on its own: kept as an AAC song tagged with the video. */
function audioOnlySong(video: VideoSummary): SongItem {
  return {
    id: video.id,
    title: video.title,
    artists: video.channelName ? [{ name: video.channelName, id: video.channelId ?? null }] : [],
    album: null,
    duration: video.durationSeconds ?? null,
    musicVideoType: null,
    thumbnail: video.thumbnailUrl ?? "",
    explicit: false,
    videoId: video.id,
    playlistId: null,
    params: null,
  };
}

/** "M:SS", "H:MM:SS" or bare seconds → milliseconds, as Android's clip
 *  fields parse. Anything else (empty, negative, a component past 59) is not
 *  a time. */
export function parseClipTimestamp(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  let seconds: number;
  if (numbers.length === 1) {
    seconds = numbers[0] ?? 0;
  } else if (numbers.length === 2) {
    const minutes = numbers[0] ?? 0;
    const secs = numbers[1] ?? 0;
    if (secs >= 60) return null;
    seconds = minutes * 60 + secs;
  } else if (numbers.length === 3) {
    const hours = numbers[0] ?? 0;
    const minutes = numbers[1] ?? 0;
    const secs = numbers[2] ?? 0;
    if (minutes >= 60 || secs >= 60) return null;
    seconds = hours * 3600 + minutes * 60 + secs;
  } else {
    return null;
  }
  return seconds * 1000;
}

/** The ticked audio tracks, primary first, each muxed into the one file: the
 *  dialog downloads one file holding every language the user asked for, as
 *  Android's `audioTrackKeys` does. A key that is no longer offered, and a
 *  repeated key, are dropped. */
export function resolveMultiAudioKeys(
  tracks: DownloadAudioOption[],
  primaryKey: string | null,
  extraKeys: string[],
): string[] {
  const available = new Set(tracks.map((track) => track.key));
  const keys = [primaryKey, ...extraKeys].filter(
    (key): key is string => key != null && available.has(key),
  );
  return [...new Set(keys)];
}

export function useVideoDownloadDialog(video: VideoSummary | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [formats, setFormats] = useState<DownloadableFormat[]>([]);
  const [audioTracks, setAudioTracks] = useState<DownloadAudioOption[]>([]);
  const [captions, setCaptions] = useState<CaptionOption[]>([]);
  const [mode, setMode] = useState<VideoDownloadMode>("video");
  const [codec, setCodec] = useState<CodecChoice>("Auto");
  const [selectedId, setSelectedId] = useState("");
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [extraAudioKeys, setExtraAudioKeys] = useState<string[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipStart, setClipStart] = useState("0:00");
  const [clipEnd, setClipEnd] = useState("");
  const [clipError, setClipError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const preferred = preferredCodec(values, IS_MACOS_RUNTIME);
  const originalTitle = useOriginalTitle(video?.id);

  useEffect(() => {
    setFormats([]);
    setAudioTracks([]);
    setCaptions([]);
    setMode("video");
    setCodec("Auto");
    setSelectedId("");
    setAudioKey(null);
    setExtraAudioKeys([]);
    setTitle(video?.title ?? "");
    setFolder(null);
    setClipEnabled(false);
    setClipStart("0:00");
    setClipEnd(video?.durationSeconds ? formatTime(video.durationSeconds) : "");
    setClipError(null);
    setError(null);
    if (!video) return;
    let cancelled = false;
    setLoading(true);
    void getDownloadFormats(video.id)
      .then((options) => {
        if (cancelled) return;
        setFormats(options.formats);
        setAudioTracks(options.audioTracks);
        setCaptions(options.captions);
        setAudioKey(options.audioTracks.find((track) => track.isDefault)?.key ?? options.audioTracks[0]?.key ?? null);
        const wanted = defaultSubtitle(useAppSettingsStore.getState().values)?.languageCode ?? "";
        setSubtitle(options.captions.some((caption) => caption.languageCode === wanted) ? wanted : "");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [video, attempt]);

  // The answer can land after the dialog opened, and a name the user typed stays.
  useEffect(() => {
    if (originalTitle) setTitle((current) => (current === video?.title ? originalTitle : current));
  }, [originalTitle, video, attempt]);

  const rows = useMemo(() => qualityRows(formats, codec, preferred), [formats, codec, preferred]);
  const availableCodecs = useMemo(
    () => new Set(formats.map((format) => format.videoCodec)),
    [formats],
  );

  // Keep a selection that still exists in the visible rows; otherwise fall back
  // to the default quality.
  useEffect(() => {
    if (rows.some((row) => row.formatId === selectedId)) return;
    setSelectedId(defaultRow(rows, preferredDownloadHeight(values))?.formatId ?? "");
  }, [rows, selectedId, values]);

  const selected = rows.find((row) => row.formatId === selectedId) ?? null;
  const audioTrack = audioTracks.find((track) => track.key === audioKey) ?? null;
  const originalAudio = audioTracks.find((track) => track.isDefault) ?? audioTracks[0] ?? null;
  /** The extra languages offered, besides the primary track: only AAC
   *  tracks can be muxed into the downloaded file. */
  const extraAudioTracks = useMemo(
    () => audioTracks.filter((track) => track.codec === "AAC" && track.key !== audioKey),
    [audioTracks, audioKey],
  );
  /** Primary first, then the ticked extras: one file holding all of them. */
  const selectedAudioKeys = useMemo(
    () =>
      resolveMultiAudioKeys(
        audioTracks.filter((track) => track.codec === "AAC"),
        audioKey,
        extraAudioKeys,
      ),
    [audioTracks, audioKey, extraAudioKeys],
  );
  const toggleExtraAudioKey = useCallback((key: string) => {
    setExtraAudioKeys((current) =>
      current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key],
    );
  }, []);
  const audioSize = mode === "audio" ? originalAudio?.sizeBytes ?? null : null;
  /** The extra languages' bytes on top of the estimate, which already holds
   *  the primary audio. */
  const extraAudioSize = useMemo(
    () =>
      selectedAudioKeys.slice(1).reduce(
        (sum, key) =>
          sum + (audioTracks.find((track) => track.key === key)?.sizeBytes ?? 0),
        0,
      ),
    [audioTracks, selectedAudioKeys],
  );
  const totalSize = mode === "audio"
    ? audioSize
    : selected?.estimatedSizeBytes == null
      ? null
      : selected.estimatedSizeBytes + extraAudioSize;

  // A clip is only offered for a video with a known length, as on Android.
  const durationMs = (video?.durationSeconds ?? 0) * 1000;
  const canClip = durationMs > 0;
  /** The clip the user picked, or null when the toggle is off or the range
   *  is invalid. */
  const clipRange: DownloadClip | null = useMemo(() => {
    if (!clipEnabled || !canClip) return null;
    const startMs = parseClipTimestamp(clipStart);
    const endMs = parseClipTimestamp(clipEnd);
    if (startMs == null || endMs == null) return null;
    if (startMs < 0 || endMs <= startMs || endMs > durationMs) return null;
    return { startMs, endMs };
  }, [clipEnabled, canClip, clipStart, clipEnd, durationMs]);
  const clipInvalid = clipEnabled && canClip && clipRange == null;
  /** The file name the dialog shows: the title with its range when clipped. */
  const fileName = clipRange ? clipTitle(title, clipRange) : title;

  const submit = async (): Promise<DownloadStarted | null> => {
    if (!video) return null;
    // An invalid clip never starts a download: Android shows a toast instead.
    if (clipInvalid) {
      setClipError(getString("download_clip_invalid"));
      return null;
    }
    setClipError(null);
    setStarting(true);
    setError(null);
    try {
      const overrides = {
        title,
        destinationDirectory: folder ?? undefined,
        clip: clipRange ?? undefined,
      };
      let started: DownloadStarted;
      if (mode === "audio") {
        started = await startDownload({
          ...musicDownloadRequest(audioOnlySong(video), values, "AAC", overrides),
          mediaKind: "audio",
          tags: { channelName: video.channelName || undefined, channelId: video.channelId ?? undefined },
        });
      } else {
        if (!selected) return null;
        const caption = captions.find((option) => option.languageCode === subtitle);
        const subtitleChoice = caption
          ? { languageCode: caption.languageCode, autoGenerated: caption.isAutoGenerated }
          : undefined;
        // One download, one file: every ticked language is muxed into it,
        // primary first. With a single track the request is exactly as
        // before — `audioTrack` alone — and with no AAC track on offer the
        // single download still runs, with no explicit track: the backend
        // picks the default audio.
        const selection = {
          ...videoSelectionFor(selected),
          audioTrack: audioTrack && !audioTrack.isDefault ? audioTrack.key : undefined,
          audioTracks: selectedAudioKeys.length > 1 ? selectedAudioKeys : undefined,
        };
        started = await startDownload(
          videoDownloadRequest(video, values, selection, describeFormat(selected), {
            ...overrides,
            subtitle: subtitleChoice,
          }),
        );
      }
      recapVideoAction(video, "DOWNLOAD");
      return started;
    } catch (reason) {
      setError(reason);
      return null;
    } finally {
      setStarting(false);
    }
  };

  // Editing the range clears the invalid message; the range re-validates
  // on the next submit.
  const changeClipStart = (value: string) => {
    setClipStart(value);
    setClipError(null);
  };
  const changeClipEnd = (value: string) => {
    setClipEnd(value);
    setClipError(null);
  };

  return {
    audioKey,
    audioTrack,
    audioTracks,
    availableCodecs,
    canClip,
    captions,
    clipEnabled,
    clipEnd,
    clipError,
    clipInvalid,
    clipRange,
    clipStart,
    codec,
    displayTitle: originalTitle || video?.title || "",
    error,
    errorMessage: error ? getBackendErrorMessage(error) : null,
    extraAudioKeys,
    extraAudioTracks,
    fileName,
    folder,
    loading,
    mode,
    originalAudio,
    preferredCodec: preferred,
    retry: () => setAttempt((value) => value + 1),
    rows,
    selected,
    selectedAudioKeys,
    selectedId,
    setAudioKey,
    setClipEnabled,
    setClipEnd: changeClipEnd,
    setClipStart: changeClipStart,
    setCodec,
    setFolder,
    setMode,
    setSelectedId,
    setSubtitle,
    setTitle,
    starting,
    submit,
    subtitle,
    title,
    toggleExtraAudioKey,
    totalSize,
  };
}
