import React, { useCallback, useEffect, useRef, useState } from "react";
import * as dashjs from "dashjs";
import { createProxiedDashPlayer } from "../../lib/dashSetup";
import {
  AudioLines,
  Bug,
  Captions,
  Check,
  ChevronLeft,
  Gauge,
  Info,
  Link,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  Settings,
  SlidersHorizontal,
  ThumbsUp,
  Timer,
} from "lucide-react";
import type { PlaybackRate } from "../../store/usePlayerStore";
import { SETTINGS } from "../../lib/settings/schema";
import { youtubeShortsUrl, youtubeWatchUrl } from "../../lib/youtubeUrl";
import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { setSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import {
  DEFAULT_PLAYBACK_RATES,
  formatPlaybackRate,
  normalizePlaybackRate,
  parseCustomSpeedPresets,
  selectPreferredCaptionId,
} from "../../lib/settings/playerRuntime";
import { LONG_PRESS_MS, longPressRate } from "../../lib/pointerGesture";
import {
  AUDIO_DRIFT_TOLERANCE_SECONDS,
  AUDIO_RESYNC_MIN_INTERVAL_MS,
} from "../../lib/externalAudioSync";
import { useSubtitleSettingsSync } from "../../lib/useSubtitleSettingsSync";
import { useAmbientSettings } from "../../lib/ambient/useAmbientSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import type { AudioTrack, CaptionTrack, StreamVariant } from "../../types/video";
import { SubtitleOverlay } from "../player/SubtitleOverlay";
import { StatsForNerds } from "../player/StatsForNerds";
import { MediaScrubber } from "../ui/MediaScrubber";
import { noteShortProgress } from "../../lib/shortViews";
import { listenForShortsKeys } from "../../lib/shortsKeys";
import { useVideoEq } from "../../lib/audio/useVideoEq";
import { videoEqAvailable } from "../../lib/audio/mediaEqEngine";
import { useEqActive } from "../../lib/audio/eq/useEqualizer";
import { useEqStore } from "../../store/useEqStore";

interface ShortVideoSurfaceProps {
  videoId: string;
  dashUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  audioTracks: AudioTrack[];
  selectedAudioTrackId: string | null;
  onSelectAudioTrack: (id: string) => void;
  onDoubleClickLike: () => void;
  qualities: StreamVariant[];
  captions: CaptionTrack[];
  selectedQualityId: string;
  onSelectQuality: (variant: StreamVariant | "auto") => void;
  poster?: string;
  active: boolean;
  muted: boolean;
  volume: number;
  playbackMode: string;
  autoScrollSeconds: number;
  /** Impressive mode: chrome stays hidden until a centre tap and hides again on its own. */
  controlsOnDemand?: boolean;
  /** Whether the chrome is currently shown, when controls are on demand. */
  chromeVisible?: boolean;
  onRequestChrome?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onRequestAdvance?: () => void;
  onError?: () => void;
}

type SettingsPane = "root" | "speed" | "quality" | "captions" | "audio";

// Long enough to read a double click, short enough that a single click still feels immediate.
const DOUBLE_CLICK_WAIT_MS = 220;
const LIKE_BURST_MS = 700;
type ContextMenuState = { x: number; y: number };

const DEFAULT_SPEED_OPTIONS: PlaybackRate[] = DEFAULT_PLAYBACK_RATES;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** The codec family a variant carries, for the grouped quality rows. */
function codecShortName(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  if (mimeType.includes("av01")) return "AV1";
  if (mimeType.includes("vp09") || mimeType.includes("vp9")) return "VP9";
  if (mimeType.includes("avc1")) return "H.264";
  if (mimeType.includes("mp4a")) return "AAC";
  if (mimeType.includes("opus")) return "Opus";
  return null;
}

function variantDetail(variant: StreamVariant): string | undefined {
  const parts: string[] = [];
  if (variant.bitrate) parts.push(`${Math.round(variant.bitrate / 1000)} kbps`);
  else if (variant.fps) parts.push(`${variant.fps}fps`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Variants grouped by resolution, in the order they arrived. */
function groupQualitiesByLabel(qualities: StreamVariant[]): Array<[string, StreamVariant[]]> {
  const groups = new Map<string, StreamVariant[]>();
  for (const quality of qualities) {
    const list = groups.get(quality.qualityLabel) ?? [];
    list.push(quality);
    groups.set(quality.qualityLabel, list);
  }
  return [...groups.entries()];
}

export function ShortVideoSurface({
  videoId,
  dashUrl,
  videoUrl,
  audioUrl,
  audioTracks,
  selectedAudioTrackId,
  onSelectAudioTrack,
  onDoubleClickLike,
  qualities,
  captions,
  selectedQualityId,
  onSelectQuality,
  poster,
  active,
  muted,
  volume,
  playbackMode,
  autoScrollSeconds,
  controlsOnDemand = false,
  chromeVisible = true,
  onRequestChrome,
  onPlayingChange,
  onRequestAdvance,
  onError,
}: ShortVideoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const userPausedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRateRef = useRef<PlaybackRate | null>(null);
  const longPressActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  // A source swap (quality change) that should carry the position over, set by
  // the setup effect and consumed once the new source knows its duration.
  const restorePositionRef = useRef<number | null>(null);
  // The position before the source was torn down. The cleanup runs before the
  // next setup and its load() resets the element to 0:00, so the position is
  // saved here, not read in the setup body.
  const lastPositionRef = useRef(0);
  const prevVideoIdRef = useRef<string | null>(null);
  const prevActiveRef = useRef(false);
  const autoAdvanceFiredRef = useRef(false);
  const lastAudioResyncAtRef = useRef(0);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const audioUrlRef = useRef(audioUrl);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);

  useEffect(() => {
    volumeRef.current = volume;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) video.volume = volume;
    if (audio) audio.volume = volume;
  }, [volume]);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [userPaused, setUserPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("root");
  const [selectedCaptionId, setSelectedCaptionId] = useState("off");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  // Shorts keeps its own persisted speed, apart from the Watch page's: a
  // choice here survives the next swipe and never leaks into a regular video.
  const shortsPlaybackRate = normalizePlaybackRate(
    useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_PLAYBACK_SPEED] ?? "1.0"),
  );
  const setShortsPlaybackRate = useCallback((rate: PlaybackRate) => {
    void setSettingValue(SETTINGS.SHORTS_PLAYBACK_SPEED, formatPlaybackRate(normalizePlaybackRate(rate)));
  }, []);
  const customSpeedsEnabled = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEEDS_ENABLED] === "true");
  const customSpeedPresets = useAppSettingsStore((state) => state.values[SETTINGS.CUSTOM_SPEED_PRESETS] ?? "");
  const longPressSpeedSetting = useAppSettingsStore((state) => state.values[SETTINGS.LONG_PRESS_PLAYBACK_SPEED] ?? "2.0");
  const speedSliderEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SPEED_SLIDER_ENABLED] === "true");
  const subtitlesEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SUBTITLES_ENABLED] === "true");
  const preferredSubtitleLanguage = useAppSettingsStore((state) => state.values[SETTINGS.PREFERRED_SUBTITLE_LANGUAGE] ?? "en");
  const groupedQualityEnabled = useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_GROUPED_QUALITY] === "true");
  const ambientEnabled = useAmbientSettings().enabled;

  useSubtitleSettingsSync();

  const longPressPlaybackRate = longPressRate(longPressSpeedSetting);
  const speedOptions = parseCustomSpeedPresets(customSpeedPresets, customSpeedsEnabled);
  const selectedCaption = captions.find((caption) => caption.id === selectedCaptionId) ?? null;
  const selectedAudioTrack =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ??
    audioTracks.find((track) => track.isDefault) ??
    audioTracks[0] ??
    null;
  const selectedVariant = qualities.find((quality) => quality.id === selectedQualityId) ?? null;
  const selectedQualityLabel =
    selectedQualityId === "auto" ? "Auto" : selectedVariant?.qualityLabel || selectedQualityId;

  const useDirect = !!videoUrl;
  const hasSeparateAudio = useDirect && !!audioUrl && audioUrl !== videoUrl;
  useVideoEq(videoRef, audioRef, hasSeparateAudio ? audioUrl : null, 1);
  const eqActive = useEqActive();
  const eqEditorHosted = useEqStore((s) => s.editorHosted);
  const openEqEditor = useEqStore((s) => s.setEditorOpen);
  const [likeBurst, setLikeBurst] = useState(false);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const likeBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
      if (likeBurstTimerRef.current) clearTimeout(likeBurstTimerRef.current);
    },
    [],
  );
  const shouldLoop = playbackMode === "loop";

  // The sound disc and the Shorts UI modes need to know whether the reel is
  // actually playing, not just mounted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onPlayingChange) return;
    const onPlay = () => onPlayingChange(true);
    const onPause = () => onPlayingChange(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [onPlayingChange]);

  // Seconds until the auto-scroll fires; only a Short longer than the timer
  // counts down, mirroring the advance itself.
  const autoScrollInterval = Math.min(20, Math.max(5, autoScrollSeconds));
  const autoScrollRemaining =
    playbackMode === "auto_interval" && duration > autoScrollInterval
      ? Math.max(0, Math.ceil(autoScrollInterval - progress))
      : 0;
  const showAutoScrollBadge = active && chromeVisible && autoScrollRemaining > 0;

  useEffect(() => {
    userPausedRef.current = userPaused;
  }, [userPaused]);

  useEffect(() => {
    if (!active) {
      setSettingsOpen(false);
      setContextMenu(null);
      setStatsVisible(false);
    }
  }, [active]);

  // Shorts background play: when the window hides, a Short keeps playing only
  // when the viewer allowed it; with Shorts PiP on it pops out instead, and
  // otherwise it pauses like the video player does with background play off.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (!document.hidden) return;
      const values = useAppSettingsStore.getState().values;
      if (values[SETTINGS.SHORTS_BACKGROUND_PLAY] === "true") return;
      const video = videoRef.current;
      if (!video) return;
      if (
        values[SETTINGS.SHORTS_PIP] === "true" &&
        document.pictureInPictureEnabled &&
        !document.pictureInPictureElement
      ) {
        void video.requestPictureInPicture().catch(() => video.pause());
        return;
      }
      video.pause();
      audioRef.current?.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active]);

  useEffect(() => {
    autoAdvanceFiredRef.current = false;
  }, [active, audioUrl, autoScrollSeconds, dashUrl, playbackMode, videoUrl]);

  useEffect(() => {
    if (!settingsOpen) setSettingsPane("root");
  }, [settingsOpen]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      video.playbackRate = shortsPlaybackRate;
      video.preservesPitch = true;
    }
    if (audio) {
      audio.playbackRate = shortsPlaybackRate;
      audio.preservesPitch = true;
    }
  }, [shortsPlaybackRate, videoUrl, audioUrl]);

  useEffect(() => {
    if (!subtitlesEnabled) {
      setSelectedCaptionId("off");
      return;
    }
    setSelectedCaptionId(selectPreferredCaptionId(captions, preferredSubtitleLanguage) ?? "off");
  }, [captions, preferredSubtitleLanguage, subtitlesEnabled]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (previousRateRef.current !== null) setShortsPlaybackRate(previousRateRef.current);
    };
  }, [setShortsPlaybackRate]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    let syncTimer: number | null = null;

    const teardown = () => {
      if (syncTimer != null) {
        window.clearInterval(syncTimer);
        syncTimer = null;
      }
      try {
        dashRef.current?.destroy();
      } catch {
        dashRef.current = null;
      }
      dashRef.current = null;
      lastPositionRef.current = video.currentTime || 0;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };

    // A quality or audio-track change swaps only the source of the short
    // already playing: its position and a pause carry over, as on the main
    // player. A new short — or coming back to this one — starts over.
    const sameShort = prevActiveRef.current && prevVideoIdRef.current === videoId && active;
    prevActiveRef.current = active;
    prevVideoIdRef.current = videoId;
    const resumeTime = sameShort ? lastPositionRef.current : 0;
    const wasPaused = sameShort && userPausedRef.current;
    restorePositionRef.current = resumeTime > 0 ? resumeTime : null;

    if (!active) {
      setUserPaused(false);
      userPausedRef.current = false;
      setProgress(0);
      setDuration(0);
      teardown();
      return teardown;
    }

    if (useDirect && videoUrl) {
      setUserPaused(wasPaused);
      userPausedRef.current = wasPaused;
      teardown();
      video.src = videoUrl;
      video.loop = shouldLoop && !hasSeparateAudio;
      video.muted = hasSeparateAudio ? true : mutedRef.current;
      video.volume = volumeRef.current;

      if (audio && hasSeparateAudio && audioUrlRef.current) {
        audio.src = audioUrlRef.current;
        audio.loop = shouldLoop;
        audio.muted = mutedRef.current;
        audio.volume = volumeRef.current;
        audio.playbackRate = shortsPlaybackRate;
        audio.preservesPitch = true;
      }

      const realignAudio = (force: boolean) => {
        if (!audio || !hasSeparateAudio) return;
        const now = performance.now();
        if (!force) {
          if (Math.abs(audio.currentTime - video.currentTime) <= AUDIO_DRIFT_TOLERANCE_SECONDS) return;
          if (now - lastAudioResyncAtRef.current < AUDIO_RESYNC_MIN_INTERVAL_MS) return;
          if (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        }
        lastAudioResyncAtRef.current = now;
        try {
          audio.currentTime = video.currentTime;
        } catch {
        }
      };

      const playBoth = () => {
        if (userPausedRef.current) return;
        if (audio && hasSeparateAudio) {
          realignAudio(false);
          void audio.play().catch(() => {});
        }
        void video.play().catch(() => {});
      };

      const pauseAudio = () => {
        if (audio && hasSeparateAudio) audio.pause();
      };

      const advanceOnce = () => {
        if (autoAdvanceFiredRef.current) return;
        autoAdvanceFiredRef.current = true;
        onRequestAdvance?.();
      };

      const loopBoth = () => {
        video.currentTime = 0;
        if (audio && hasSeparateAudio) {
          lastAudioResyncAtRef.current = performance.now();
          audio.currentTime = 0;
        }
        playBoth();
      };

      const handleEnded = () => {
        if (shouldLoop) {
          loopBoth();
          return;
        }
        advanceOnce();
      };

      video.addEventListener("canplay", playBoth);
      video.addEventListener("pause", pauseAudio);
      video.addEventListener("ended", handleEnded);

      if (audio && hasSeparateAudio) {
        syncTimer = window.setInterval(() => {
          if (video.paused || audio.paused) return;
          if (audio.currentTime - video.currentTime > AUDIO_DRIFT_TOLERANCE_SECONDS) return;
          realignAudio(false);
        }, 1_000);
      }

      video.load();

      return () => {
        video.removeEventListener("canplay", playBoth);
        video.removeEventListener("pause", pauseAudio);
        video.removeEventListener("ended", handleEnded);
        teardown();
      };
    }

    if (dashUrl) {
      setUserPaused(wasPaused);
      userPausedRef.current = wasPaused;
      teardown();
      video.loop = shouldLoop;
      video.muted = mutedRef.current;
      video.volume = volumeRef.current;
      const player = createProxiedDashPlayer(dashUrl, { buffer: { bufferToKeep: 12, bufferTimeDefault: 3 } });
      const dashEvents = dashjs.MediaPlayer.events;
      const playDash = () => {
        if (userPausedRef.current) return;
        void video.play().catch(() => {});
      };
      const handleDashError = () => onError?.();
      const handleEnded = () => {
        if (shouldLoop || autoAdvanceFiredRef.current) return;
        autoAdvanceFiredRef.current = true;
        onRequestAdvance?.();
      };
      player.on(dashEvents.STREAM_INITIALIZED, playDash);
      player.on(dashEvents.ERROR, handleDashError);
      video.addEventListener("ended", handleEnded);
      player.initialize(video, dashUrl, true);
      dashRef.current = player;

      return () => {
        player.off(dashEvents.STREAM_INITIALIZED, playDash);
        player.off(dashEvents.ERROR, handleDashError);
        video.removeEventListener("ended", handleEnded);
        teardown();
      };
    }

    return teardown;
  }, [active, dashUrl, hasSeparateAudio, onRequestAdvance, playbackMode, shouldLoop, useDirect, videoId, videoUrl]);

  // Another audio language is only another audio file: the picture, its position and a pause all stay.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!active || !video || !audio || !hasSeparateAudio || !audioUrl) return;
    if (audio.getAttribute("src") === audioUrl) return;
    lastAudioResyncAtRef.current = performance.now();
    audio.src = audioUrl;
    audio.playbackRate = shortsPlaybackRate;
    audio.preservesPitch = true;
    audio.currentTime = video.currentTime;
    if (!video.paused && !userPausedRef.current) void audio.play().catch(() => {});
  }, [active, audioUrl, hasSeparateAudio, shortsPlaybackRate]);

  useEffect(() => {
    if (!active || playbackMode !== "auto_interval" || autoAdvanceFiredRef.current) return;
    const intervalSeconds = Math.min(20, Math.max(5, autoScrollSeconds));
    if (duration > 0 && duration <= intervalSeconds) return;
    if (progress < intervalSeconds) return;
    autoAdvanceFiredRef.current = true;
    onRequestAdvance?.();
  }, [active, autoScrollSeconds, duration, onRequestAdvance, playbackMode, progress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncProgress = () => {
      setProgress(video.currentTime || 0);
      const known = Number.isFinite(video.duration) && video.duration > 0;
      if (known) setDuration(video.duration);
      noteShortProgress(videoId, (video.currentTime || 0) * 1000, known ? video.duration * 1000 : 0);
    };

    // A source swap (quality change) lands back where playback was, once the
    // new source knows its duration; a seek before that is refused, so wait.
    const restorePosition = () => {
      const at = restorePositionRef.current;
      if (at === null || video.readyState < 1) return;
      restorePositionRef.current = null;
      try {
        video.currentTime = Math.min(at, video.duration || at);
      } catch {
        restorePositionRef.current = at;
      }
    };

    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("durationchange", syncProgress);
    video.addEventListener("loadedmetadata", syncProgress);
    video.addEventListener("loadedmetadata", restorePosition);
    restorePosition();
    return () => {
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("durationchange", syncProgress);
      video.removeEventListener("loadedmetadata", syncProgress);
      video.removeEventListener("loadedmetadata", restorePosition);
    };
  }, [dashUrl, videoUrl, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (hasSeparateAudio && audio) {
      if (video) video.muted = true;
      audio.muted = muted;
      if (!muted && active && !userPausedRef.current) void audio.play().catch(() => {});
    } else if (video) {
      video.muted = muted;
      if (!muted && active && !userPausedRef.current) void video.play().catch(() => {});
    }
  }, [active, audioUrl, hasSeparateAudio, muted, videoUrl]);

  const togglePlayback = useCallback(() => {
    if (!active) return;
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    if (video.paused) {
      userPausedRef.current = false;
      setUserPaused(false);
      if (audio && hasSeparateAudio) {
        lastAudioResyncAtRef.current = performance.now();
        audio.currentTime = video.currentTime;
        void audio.play().catch(() => {});
      }
      void video.play().catch(() => {});
    } else {
      userPausedRef.current = true;
      setUserPaused(true);
      video.pause();
      if (audio && hasSeparateAudio) audio.pause();
    }
  }, [active, hasSeparateAudio]);

  const selectPlaybackRate = useCallback(
    (nextRate: number) => {
      setShortsPlaybackRate(normalizePlaybackRate(nextRate));
    },
    [setShortsPlaybackRate],
  );

  const restorePlaybackRate = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressActiveRef.current && previousRateRef.current !== null) {
      setShortsPlaybackRate(previousRateRef.current);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    longPressActiveRef.current = false;
    previousRateRef.current = null;
    setIsBoosting(false);
  }, [setShortsPlaybackRate]);

  const showCopied = useCallback((label: string) => {
    setCopiedLabel(label);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedLabel(null), 1400);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || event.button !== 0) return;
      setContextMenu(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (longPressPlaybackRate === null) return;
      longPressTimerRef.current = setTimeout(() => {
        previousRateRef.current = shortsPlaybackRate;
        longPressActiveRef.current = true;
        setIsBoosting(true);
        setShortsPlaybackRate(longPressPlaybackRate);
      }, LONG_PRESS_MS);
    },
    [active, longPressPlaybackRate, shortsPlaybackRate, setShortsPlaybackRate],
  );

  const handleSurfaceClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      // With the chrome on demand, a centre tap shows or hides it instead of
      // pausing; the pause button that arrives with the chrome still pauses.
      if (controlsOnDemand) {
        onRequestChrome?.();
        return;
      }
      if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = setTimeout(() => {
        singleClickTimerRef.current = null;
        togglePlayback();
      }, DOUBLE_CLICK_WAIT_MS);
    },
    [contextMenu, controlsOnDemand, onRequestChrome, togglePlayback],
  );

  const handleSurfaceDoubleClick = useCallback(() => {
    if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
    singleClickTimerRef.current = null;
    onDoubleClickLike();
    setLikeBurst(true);
    if (likeBurstTimerRef.current) clearTimeout(likeBurstTimerRef.current);
    likeBurstTimerRef.current = setTimeout(() => setLikeBurst(false), LIKE_BURST_MS);
  }, [onDoubleClickLike]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      restorePlaybackRate();
      const rect = event.currentTarget.getBoundingClientRect();
      const menuWidth = 326;
      const menuHeight = 252;
      setContextMenu({
        x: clamp(event.clientX - rect.left, 12, Math.max(12, rect.width - menuWidth - 12)),
        y: clamp(event.clientY - rect.top, 12, Math.max(12, rect.height - menuHeight - 12)),
      });
    },
    [restorePlaybackRate],
  );

  // A Shorts link can't carry a time, so the timed link opens the short as a regular video.
  const getCurrentUrl = useCallback(
    (includeTime: boolean) => (includeTime ? youtubeWatchUrl(videoId, progress) : youtubeShortsUrl(videoId)),
    [progress, videoId],
  );

  const copyDebugInfo = useCallback(async () => {
    const video = videoRef.current;
    const copied = await copyText(JSON.stringify({
      currentTime: formatTime(progress),
      duration: formatTime(duration),
      playbackRate: shortsPlaybackRate,
      selectedQualityId,
      readyState: video?.readyState,
      networkState: video?.networkState,
      resolution: video ? `${video.videoWidth}x${video.videoHeight}` : null,
      captions: captions.length,
    }, null, 2));
    showCopied(getString(copied ? "player_debug_info_copied" : "player_debug_info_copy_failed"));
  }, [captions.length, duration, shortsPlaybackRate, progress, selectedQualityId, showCopied]);

  const togglePictureInPicture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {});
    } else {
      void video.requestPictureInPicture().catch(() => {});
    }
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (!video || duration <= 0) return;
      const nextTime = Math.min(duration, Math.max(0, seconds));
      video.currentTime = nextTime;
      if (audio && hasSeparateAudio) {
        lastAudioResyncAtRef.current = performance.now();
        audio.currentTime = nextTime;
        if (!video.paused && !userPausedRef.current) void audio.play().catch(() => {});
      }
      setProgress(nextTime);
    },
    [duration, hasSeparateAudio],
  );

  const seekIntervalSeconds = useAppSettingsStore((state) => Number(state.values[SETTINGS.DOUBLE_TAP_SEEK_SECONDS] ?? 10));
  useEffect(() => {
    if (!active) return;
    return listenForShortsKeys((action) => {
      const video = videoRef.current;
      if (action.type === "toggle") {
        togglePlayback();
        return true;
      }
      if (!video) return false;
      if (action.type === "seek") {
        seekTo(video.currentTime + action.direction * (Number.isFinite(seekIntervalSeconds) ? seekIntervalSeconds : 10));
        return true;
      }
      if (action.type === "jump") {
        seekTo((duration * action.tenths) / 10);
        return true;
      }
      return false;
    });
  }, [active, duration, seekIntervalSeconds, seekTo, togglePlayback]);

  useEffect(() => {
    if (!active) return;
    const handleExternalSeek = (event: Event) => {
      const detail = (event as CustomEvent<{ time?: number }>).detail;
      if (typeof detail?.time === "number") seekTo(detail.time);
    };
    window.addEventListener("player-seek", handleExternalSeek);
    return () => window.removeEventListener("player-seek", handleExternalSeek);
  }, [active, seekTo]);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        poster={poster}
        className={`h-full w-full bg-chrome-black ${fit === "cover" ? "object-cover" : "object-contain"}`}
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) {
            setFit(v.videoHeight >= v.videoWidth ? "cover" : "contain");
          }
        }}
        onError={(e) => {
          const v = e.currentTarget;
          if (active && v.error && v.currentSrc) onError?.();
        }}
      />
      <div
        className="absolute inset-0 z-10 cursor-default"
        onPointerDown={handlePointerDown}
        onPointerUp={restorePlaybackRate}
        onPointerCancel={restorePlaybackRate}
        onPointerLeave={restorePlaybackRate}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
        onContextMenu={handleContextMenu}
      />
      {active && (!controlsOnDemand || chromeVisible) && (
        <div className="absolute start-4 top-4 z-30 flex gap-2">
          <button
            type="button"
            aria-label={getString('shorts_short_settings')}
            onClick={(event) => {
              event.stopPropagation();
              setSettingsOpen((value) => !value);
              setContextMenu(null);
            }}
            className={cx(
              "grid h-10 w-10 place-items-center rounded-full bg-chrome-black/55 text-chrome-white transition-colors hover:bg-chrome-black/75",
              settingsOpen && "text-primary",
            )}
          >
            <Settings className={cx("h-5 w-5 transition-transform", settingsOpen && "rotate-90")} />
          </button>
          {captions.length > 0 && (
            <button
              type="button"
              aria-label={getString('shorts_short_captions')}
              onClick={(event) => {
                event.stopPropagation();
                setSettingsOpen(true);
                setSettingsPane("captions");
              }}
              className={cx(
                "grid h-10 w-10 place-items-center rounded-full bg-chrome-black/55 text-chrome-white transition-colors hover:bg-chrome-black/75",
                selectedCaptionId !== "off" && "text-primary",
              )}
            >
              <Captions className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {showAutoScrollBadge && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-chrome-black/55 px-3 py-1.5 text-xs font-semibold text-chrome-white">
          <Timer className="h-4 w-4" />
          {getString("shorts_auto_scroll_active", autoScrollRemaining)}
        </div>
      )}
      {settingsOpen && (
        <div
          className="absolute start-4 top-16 z-40 w-[min(82vw,320px)] overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover p-2 text-chrome-white"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {settingsPane !== "root" && (
            <button
              type="button"
              onClick={() => setSettingsPane("root")}
              className="mb-1 flex h-10 w-full items-center gap-2 rounded-md px-1 text-start text-sm font-bold hover:bg-chrome-white/10"
            >
              <ChevronLeft className="rtl:-scale-x-100" size={18} />
              {settingsPane === "speed"
                ? "Playback speed"
                : settingsPane === "quality"
                ? "Quality"
                : settingsPane === "audio"
                ? getString("player_menu_audio")
                : "Subtitles/CC"}
            </button>
          )}

          {settingsPane === "root" && (
            <div className="space-y-1">
              <SettingsRow
                icon={<Gauge size={18} />}
                label={getString('player_menu_speed')}
                value={shortsPlaybackRate === 1 ? "Normal" : `${shortsPlaybackRate}x`}
                onClick={() => setSettingsPane("speed")}
              />
              <SettingsRow
                icon={<Monitor size={18} />}
                label={getString('player_menu_quality')}
                value={selectedQualityLabel}
                onClick={() => setSettingsPane("quality")}
              />
              <SettingsRow
                icon={<Captions size={18} />}
                label={getString('player_menu_subtitles')}
                value={selectedCaption ? selectedCaption.label : "Off"}
                onClick={() => setSettingsPane("captions")}
              />
              {audioTracks.length > 1 && hasSeparateAudio && (
                <SettingsRow
                  icon={<AudioLines size={18} />}
                  label={getString("player_menu_audio")}
                  value={selectedAudioTrack?.label ?? getString("player_menu_audio_original")}
                  onClick={() => setSettingsPane("audio")}
                />
              )}
              {eqEditorHosted && (
                <SettingsRow
                  icon={<SlidersHorizontal size={18} />}
                  label={getString("music_equalizer")}
                  value={getString(!videoEqAvailable() ? "eq_state_unavailable" : eqActive ? "eq_state_on" : "eq_state_off")}
                  onClick={() => {
                    setSettingsOpen(false);
                    openEqEditor(true);
                  }}
                />
              )}
              <SettingsToggleRow
                label={getString("settings_ambient_mode")}
                checked={ambientEnabled}
                onChange={(checked) =>
                  void setSettingValue(SETTINGS.AMBIENT_MODE_ENABLED, checked ? "true" : "false")
                }
              />
            </div>
          )}

          {settingsPane === "audio" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              {audioTracks.map((track) => (
                <MenuChoice
                  key={track.id}
                  checked={selectedAudioTrack?.id === track.id}
                  label={track.label}
                  detail={track.languageCode ?? undefined}
                  onClick={() => {
                    onSelectAudioTrack(track.id);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}

          {settingsPane === "speed" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              {speedSliderEnabled && (
                <div className="rounded-md px-3 py-3 text-sm text-chrome-zinc-100">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-chrome-zinc-300">
                    <span>{getString('player_menu_speed_label')}</span>
                    <span className="font-mono text-primary">{shortsPlaybackRate}x</span>
                  </div>
                  <input
                    aria-label={getString('player_menu_speed')}
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={shortsPlaybackRate}
                    onChange={(event) => selectPlaybackRate(Number(event.target.value))}
                    className="h-1 w-full accent-primary"
                  />
                </div>
              )}
              {(speedOptions.length ? speedOptions : DEFAULT_SPEED_OPTIONS).map((speed) => (
                <MenuChoice
                  key={speed}
                  checked={shortsPlaybackRate === speed}
                  label={speed === 1 ? "Normal" : `${speed}x`}
                  onClick={() => {
                    selectPlaybackRate(speed);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}

          {settingsPane === "quality" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedQualityId === "auto"}
                label={getString('player_menu_quality_auto')}
                onClick={() => {
                  onSelectQuality("auto");
                  setSettingsPane("root");
                  setSettingsOpen(false);
                }}
              />
              {groupedQualityEnabled
                ? groupQualitiesByLabel(qualities).map(([label, variants]) => (
                    <div key={label}>
                      <div className="px-3 pb-1 pt-2 text-xs font-bold text-chrome-zinc-400">
                        {label}
                      </div>
                      {variants.map((quality) => (
                        <MenuChoice
                          key={quality.id}
                          checked={
                            selectedQualityId === quality.id ||
                            (variants.length === 1 && selectedQualityId === quality.qualityLabel)
                          }
                          label={codecShortName(quality.mimeType) ?? quality.qualityLabel}
                          detail={variantDetail(quality)}
                          onClick={() => {
                            onSelectQuality(quality);
                            setSettingsPane("root");
                            setSettingsOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  ))
                : qualities.map((quality) => (
                    <MenuChoice
                      key={quality.id}
                      checked={
                        selectedQualityId === quality.id ||
                        selectedQualityId === quality.qualityLabel
                      }
                      label={quality.qualityLabel}
                      detail={quality.isVideoOnly ? "video" : undefined}
                      onClick={() => {
                        onSelectQuality(quality);
                        setSettingsPane("root");
                        setSettingsOpen(false);
                      }}
                    />
                  ))}
            </div>
          )}

          {settingsPane === "captions" && (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1 select-scrollbar-hidden">
              <MenuChoice
                checked={selectedCaptionId === "off"}
                label={getString('subscription_notifications_off')}
                onClick={() => {
                  setSelectedCaptionId("off");
                  setSettingsPane("root");
                }}
              />
              {captions.filter((caption) => !caption.isTranslation).map((caption) => (
                <MenuChoice
                  key={caption.id}
                  checked={selectedCaptionId === caption.id}
                  label={caption.label}
                  detail={caption.isAutoGenerated ? "auto" : undefined}
                  onClick={() => {
                    setSelectedCaptionId(caption.id);
                    setSettingsPane("root");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <SubtitleOverlay
        captions={captions}
        selectedCaptionId={selectedCaptionId}
        currentTime={progress}
        shouldShowControls={settingsOpen}
        uprightVideo={fit === "cover"}
      />
      {likeBurst && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span className="grid h-20 w-20 animate-ping place-items-center rounded-full bg-chrome-black/60 text-chrome-white [animation-iteration-count:1]">
            <ThumbsUp className="h-10 w-10" fill="currentColor" />
          </span>
        </div>
      )}
      {isBoosting && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-30 -translate-x-1/2 rounded-full bg-chrome-black/80 px-5 py-2 text-sm font-bold text-chrome-white">
          {longPressPlaybackRate}x
        </div>
      )}
      {userPaused && (
        <button
          type="button"
          aria-label={getString('download_play')}
          onClick={togglePlayback}
          className="absolute inset-0 z-20 grid place-items-center bg-chrome-black/10 text-chrome-white"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-chrome-black/80">
            <Play className="ms-1 h-8 w-8" fill="currentColor" />
          </span>
        </button>
      )}
      {active && duration > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-chrome-black/55 to-transparent px-3 pb-2 pt-6">
          <MediaScrubber
            progress={progress}
            duration={duration}
            onSeek={seekTo}
            variant="edge"
            ariaLabel={getString('shorts_seek_short')}
          />
        </div>
      )}
      {contextMenu && (
        <div
          className="absolute z-50 w-[306px] overflow-hidden rounded-xl border border-chrome-white/10 bg-background p-2 text-chrome-white"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuButton
            icon={<Pause size={20} />}
            label={userPaused ? "Play" : "Pause"}
            onClick={() => {
              togglePlayback();
              setContextMenu(null);
            }}
          />
          {/* WebKitGTK has no picture-in-picture, so the item would do nothing on Linux. */}
          {document.pictureInPictureEnabled && (
            <ContextMenuButton
              icon={<PictureInPicture2 size={20} />}
              label={getString('player_menu_miniplayer')}
              onClick={() => {
                togglePictureInPicture();
                setContextMenu(null);
              }}
            />
          )}
          <ContextMenuButton
            icon={<Link size={20} />}
            label={getString('player_menu_copy_url')}
            onClick={() => {
              void copyText(getCurrentUrl(false)).then((copied) => showCopied(getString(copied ? "player_video_url_copied" : "player_url_copy_failed")));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Link size={20} />}
            label={getString('player_menu_copy_url_at_time')}
            onClick={() => {
              void copyText(getCurrentUrl(true)).then((copied) => showCopied(getString(copied ? "player_timed_url_copied" : "player_url_copy_failed")));
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Bug size={20} />}
            label={getString('player_menu_copy_debug')}
            onClick={() => {
              void copyDebugInfo();
              setContextMenu(null);
            }}
          />
          <ContextMenuButton
            icon={<Info size={20} />}
            label={getString('player_menu_stats')}
            onClick={() => {
              setStatsVisible((value) => !value);
              setContextMenu(null);
            }}
          />
        </div>
      )}
      {copiedLabel && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-50 -translate-x-1/2 rounded-full bg-chrome-black/85 px-4 py-2 text-xs font-bold text-chrome-white">
          {copiedLabel}
        </div>
      )}
      {statsVisible && (
        <StatsForNerds
          videoRef={videoRef}
          currentTime={progress}
          duration={duration}
          playbackRate={shortsPlaybackRate}
          qualityLabel={selectedQualityLabel}
          mimeType={selectedVariant?.mimeType}
          bitrate={selectedVariant?.bitrate}
          captionCount={captions.length}
          compact
          className="end-4 top-16"
        />
      )}
      <audio ref={audioRef} crossOrigin="anonymous" preload="auto" />
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-start text-sm text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="max-w-[44%] truncate text-end text-chrome-zinc-300">{value}</span>
    </button>
  );
}

function SettingsToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-chrome-zinc-100">
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function MenuChoice({
  checked,
  label,
  detail,
  onClick,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium text-chrome-zinc-100 hover:bg-chrome-white/10"
    >
      <span className="min-w-0 truncate text-start">
        {label}
        {detail && <span className="ms-1 text-xs text-chrome-zinc-400">{detail}</span>}
      </span>
      {checked && <Check size={17} />}
    </button>
  );
}

function ContextMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-11 w-full items-center gap-4 rounded-lg px-3 text-start text-sm font-bold text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
      onClick={onClick}
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
