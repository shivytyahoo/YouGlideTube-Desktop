/**
 * Voice search through the Web Speech API, the desktop stand-in for Android's
 * `RecognizerIntent` spoken query (SearchScreen.kt / MusicSearchScreen.kt).
 * The desktop webviews do not always expose a recognizer, so every entry
 * point goes through here: it returns null when there is none, and the
 * caller shows an honest "not available" message instead of a dead mic.
 */

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
  onError: () => void;
  onEnd?: () => void;
}

/**
 * Starts one spoken query and returns a handle to stop it, or null when the
 * webview exposes no recognizer (or starting it throws). A recognised result
 * is delivered once, trimmed, through `onTranscript`, like Android's
 * `EXTRA_RESULTS.firstOrNull()`; recognition errors go to `onError`.
 */
export function startVoiceSearch(options: VoiceSearchOptions): VoiceSearchHandle | null {
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
