/**
 * Voice search, the desktop stand-in for Android's `RecognizerIntent`
 * spoken query (SearchScreen.kt / MusicSearchScreen.kt).
 *
 * The desktop webviews expose no Web Speech `SpeechRecognition` (WebView2
 * and WKWebView both omit it), so on Windows the mic goes through the
 * backend instead: the `voice_search_listen` command listens once on the
 * OS speech recognizer and returns the recognised text. Where the
 * backend has no native recognizer (macOS/Linux) the web recognizer is
 * still tried, and only when neither exists does the caller hear that
 * voice search is unavailable.
 */
import { invokeBackend, BackendApiError } from "./api/errors";
import type { StringKey } from "./i18n/index";
import { IS_WINDOWS_RUNTIME } from "./platform";

/** The web speech recognizer, where the platform's webview exposes one. */
export interface SpeechRecognitionInstance {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this webview exposes a speech recognizer at all. */
export function isVoiceSearchAvailable(): boolean {
  return speechRecognitionCtor() !== null;
}

export interface VoiceSearchHandle {
  stop: () => void;
}

export interface VoiceSearchOptions {
  lang?: string;
  onTranscript: (text: string) => void;
  /** The backend error, when the failure came from the native listener. */
  onError: (error?: unknown) => void;
  onEnd?: () => void;
}

/** Which search surface the mic belongs to, for the error message. */
export type VoiceSearchScope = "search" | "music";

/**
 * The strings.json key for a voice-search failure: a denied microphone
 * and "didn't catch that" each get their own message; everything else
 * is the generic "not available" one.
 */
export function voiceSearchErrorKey(error: unknown, scope: VoiceSearchScope): StringKey {
  if (error instanceof BackendApiError) {
    switch (error.kind) {
      case "voiceSearchDenied":
        return scope === "music" ? "music_search_voice_mic_denied" : "search_voice_mic_denied";
      case "voiceSearchNoSpeech":
        return scope === "music" ? "music_search_voice_no_speech" : "search_voice_no_speech";
      default:
        break;
    }
  }
  return scope === "music" ? "music_search_voice_unavailable" : "search_voice_unavailable";
}

/**
 * Starts one spoken query and returns a handle to stop it, or null when
 * no recognizer exists at all. A recognised result is delivered once,
 * trimmed, through `onTranscript`, like Android's
 * `EXTRA_RESULTS.firstOrNull()`; recognition errors go to `onError`.
 */
export function startVoiceSearch(options: VoiceSearchOptions): VoiceSearchHandle | null {
  if (IS_WINDOWS_RUNTIME) return startNativeVoiceSearch(options);
  return startWebVoiceSearch(options);
}

/**
 * One spoken query through the backend's OS recognizer. The command
 * resolves when the user finishes speaking (or cancels); the handle's
 * `stop()` cancels the in-flight listen. When the backend reports that
 * this platform has no native recognizer — or the command does not
 * exist yet — the web recognizer is tried instead.
 */
function startNativeVoiceSearch(options: VoiceSearchOptions): VoiceSearchHandle {
  let stopped = false;
  let settled = false;
  let webHandle: VoiceSearchHandle | null = null;
  const finish = () => {
    if (settled) return;
    settled = true;
    options.onEnd?.();
  };
  const lang =
    options.lang ?? ((typeof navigator !== "undefined" && navigator.language) || "en-US");
  void invokeBackend<string | null>("voice_search_listen", { lang })
    .then((transcript) => {
      if (stopped) return;
      const spoken = transcript?.trim();
      if (spoken) options.onTranscript(spoken);
      finish();
    })
    .catch((error) => {
      if (stopped) return;
      if (isNativeUnsupported(error)) {
        webHandle = startWebVoiceSearch({ ...options, onEnd: finish });
        if (!webHandle) options.onError?.(error);
        return;
      }
      options.onError?.(error);
      finish();
    });
  return {
    stop: () => {
      stopped = true;
      webHandle?.stop();
      finish();
      void Promise.resolve(invokeBackend("voice_search_cancel")).catch(() => undefined);
    },
  };
}

/** The backend has no native recognizer here, or the command is missing. */
function isNativeUnsupported(error: unknown): boolean {
  return (
    error instanceof BackendApiError &&
    (error.kind === "voiceSearchUnsupported" || error.kind === "unknown")
  );
}

/**
 * One spoken query through the webview's speech recognizer, or null when
 * the webview exposes none (or starting it throws).
 */
function startWebVoiceSearch(options: VoiceSearchOptions): VoiceSearchHandle | null {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.lang = options.lang ?? ((typeof navigator !== "undefined" && navigator.language) || "en-US");
  recognizer.onresult = (event) => {
    const spoken = event.results[0]?.[0]?.transcript?.trim();
    if (spoken) options.onTranscript(spoken);
  };
  recognizer.onerror = () => options.onError();
  recognizer.onend = () => options.onEnd?.();
  try {
    recognizer.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        recognizer.stop();
      } catch {
        // Already ended: nothing left to stop.
      }
    },
  };
}
