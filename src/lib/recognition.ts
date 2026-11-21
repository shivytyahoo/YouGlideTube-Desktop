/**
 * Shazam-style music recognition, as Android runs it
 * (`MusicRecognitionRepository` + `ShazamClient`): record 12s of mic audio,
 * fingerprint it in the backend and ask Shazam. The webview captures through
 * Web Audio; the backend does the resampling, the DejaVu fingerprint and the
 * Shazam lookup, so no recognizer library is needed on the frontend.
 */
import { invokeBackend, BackendApiError } from "./api/errors";
import type { StringKey } from "./i18n/index";
import type { SongItem } from "../types/music";

/** One identified song, as the backend's `RecognitionResult` arrives. */
export interface RecognitionResult {
  trackId: string;
  title: string;
  artist: string;
  album?: string | null;
  coverArtUrl?: string | null;
  coverArtHqUrl?: string | null;
  genre?: string | null;
  releaseDate?: string | null;
  label?: string | null;
  lyrics?: string[] | null;
  shazamUrl?: string | null;
  appleMusicUrl?: string | null;
  spotifyUrl?: string | null;
  isrc?: string | null;
  youtubeVideoId?: string | null;
}

/** How long Android records for (`AudioRecorder.RECORDING_DURATION_MS`). */
export const RECOGNITION_LISTEN_MS = 12_000;

/** The webview exposes no mic capture at all (or has no mic). */
export class MicUnavailableError extends Error {
  constructor() {
    super("Microphone capture is not available");
    this.name = "MicUnavailableError";
  }
}

/** The user (or the OS) refused microphone access. */
export class MicDeniedError extends Error {
  constructor() {
    super("Microphone access was denied");
    this.name = "MicDeniedError";
  }
}

/** The capture was cancelled by the user. */
export class MicCancelledError extends Error {
  constructor() {
    super("Microphone capture was cancelled");
    this.name = "MicCancelledError";
  }
}

/** Whether this webview can capture microphone audio at all. */
export function isMicCaptureAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export interface MicCapture {
  /** Base64 mono 16-bit PCM, little-endian, at `sampleRate`. */
  pcmBase64: string;
  sampleRate: number;
}

export interface CaptureMicAudioOptions {
  /** Defaults to `RECOGNITION_LISTEN_MS`, Android's 12s. */
  durationMs?: number;
  /** Called with the fraction of the listen window captured so far. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Records `durationMs` of mono mic audio and returns it as base64 PCM at
 * the device sample rate; the backend resamples to 16 kHz. Raw capture (no
 * echo cancellation, noise suppression or gain) matches Android's
 * `MediaRecorder.AudioSource.MIC`. Throws `MicDeniedError`,
 * `MicUnavailableError` or `MicCancelledError`.
 */
export async function captureMicAudio(
  options: CaptureMicAudioOptions = {},
): Promise<MicCapture> {
  const durationMs = options.durationMs ?? RECOGNITION_LISTEN_MS;
  if (!isMicCaptureAvailable()) throw new MicUnavailableError();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw new MicCancelledError();
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError")
    ) {
      throw new MicDeniedError();
    }
    throw new MicUnavailableError();
  }

  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new MicUnavailableError();
  }

  const context = new AudioCtor();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  // ScriptProcessor only fires while connected; route it through a muted
  // gain so the mic is never played back through the speakers.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  const targetSamples = Math.ceil((context.sampleRate * durationMs) / 1000);
  const chunks: Float32Array[] = [];
  let collected = 0;

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };

  return new Promise<MicCapture>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      const samples = new Float32Array(collected);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      resolve({
        pcmBase64: pcmToBase64(floatToInt16Pcm(samples)),
        sampleRate: context.sampleRate,
      });
    };
    const fail = (error: Error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => fail(new MicCancelledError());
    if (options.signal) {
      if (options.signal.aborted) {
        fail(new MicCancelledError());
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(input.slice());
      collected += input.length;
      options.onProgress?.(Math.min(1, collected / targetSamples));
      if (collected >= targetSamples) finish();
    };

    // A suspended context (autoplay policy) records silence; resume it.
    if (context.state === "suspended") {
      void context.resume().catch(() => fail(new MicUnavailableError()));
    }
  });
}

/** Float [-1, 1] samples to 16-bit PCM, truncating like the native path. */
export function floatToInt16Pcm(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = Math.trunc(clamped * 32767);
  }
  return out;
}

/**
 * 16-bit PCM to base64. Desktop platforms are little-endian, which is the
 * byte order the backend expects.
 */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  // btoa chokes on huge single strings; encode in 32KB chunks.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The music-search query for a recognised song, as Android builds it. */
export function searchQueryFor(title: string, artist: string): string {
  return [title, artist].filter((part) => part.trim() !== "").join(" ");
}

/**
 * A playable song from a recognised result that carries a YouTube id, as
 * Android's `RecognitionViewModel.toMusicTrack` builds it. Null when the
 * result has no video id — then only search is offered.
 */
export function recognitionResultToSong(
  result: RecognitionResult,
): SongItem | null {
  if (!result.youtubeVideoId) return null;
  return {
    id: result.youtubeVideoId,
    title: result.title,
    artists: result.artist ? [{ name: result.artist, id: null }] : [],
    album: result.album ? { name: result.album, id: "" } : null,
    duration: 0,
    musicVideoType: null,
    thumbnail: result.coverArtHqUrl ?? result.coverArtUrl ?? "",
    explicit: false,
    videoId: result.youtubeVideoId,
    playlistId: null,
    params: null,
  };
}

/** Asks the backend to fingerprint `pcmBase64` and identify the song. */
export function recognizeSong(
  pcmBase64: string,
  sampleRate: number,
): Promise<RecognitionResult> {
  return invokeBackend<RecognitionResult>("recognize_song", {
    pcmBase64,
    sampleRate,
  });
}

/**
 * The strings.json key for a recognition failure: no-match, rate-limited
 * and offline each get their own message; everything else is generic.
 * Mic errors thrown by capture map here too; a cancel is never an error.
 */
export function recognitionErrorKey(error: unknown): StringKey {
  if (error instanceof MicDeniedError) return "music_recognition_mic_denied";
  if (error instanceof MicUnavailableError) {
    return "music_recognition_mic_unavailable";
  }
  if (error instanceof BackendApiError) {
    switch (error.kind) {
      case "recognitionNoMatch":
        return "music_recognition_no_match";
      case "rateLimited":
        return "music_recognition_busy";
      case "network":
        return "music_recognition_network";
      default:
        return "music_recognition_failed";
    }
  }
  return "music_recognition_failed";
}
