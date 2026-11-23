import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { BackendApiError } from "./api/errors";
import {
  isVoiceSearchAvailable,
  startVoiceSearch,
  voiceSearchErrorKey,
  type SpeechRecognitionInstance,
} from "./voiceSearch";

vi.mock("./api/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/errors")>();
  return { ...actual, invokeBackend: vi.fn() };
});

class FakeRecognition implements SpeechRecognitionInstance {
  static last: FakeRecognition | null = null;
  lang = "";
  onresult: SpeechRecognitionInstance["onresult"] = null;
  onerror: SpeechRecognitionInstance["onerror"] = null;
  onend: SpeechRecognitionInstance["onend"] = null;
  started = false;
  stopped = false;

  constructor() {
    FakeRecognition.last = this;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  result(transcript: string): void {
    this.onresult?.({ results: [[{ transcript }]] });
  }
}

describe("voiceSearch", () => {
  beforeEach(() => {
    FakeRecognition.last = null;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    FakeRecognition.last = null;
  });

  it("reports unavailable and returns null when the webview exposes no recognizer", () => {
    expect(isVoiceSearchAvailable()).toBe(false);
    const onTranscript = vi.fn();
    expect(startVoiceSearch({ onTranscript, onError: vi.fn() })).toBeNull();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("starts recognition and delivers the spoken text once, trimmed", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    expect(isVoiceSearchAvailable()).toBe(true);
    const onTranscript = vi.fn();
    const onEnd = vi.fn();
    const handle = startVoiceSearch({ onTranscript, onError: vi.fn(), onEnd });
    expect(handle).not.toBeNull();
    expect(FakeRecognition.last?.started).toBe(true);

    FakeRecognition.last?.result("  cats  ");
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("cats");

    FakeRecognition.last?.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores a blank recognised result", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const onTranscript = vi.fn();
    startVoiceSearch({ onTranscript, onError: vi.fn() });
    FakeRecognition.last?.result("   ");
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("reports an error through onError", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const onError = vi.fn();
    startVoiceSearch({ onTranscript: vi.fn(), onError });
    FakeRecognition.last?.onerror?.();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("returns null when starting the recognizer throws", () => {
    class ThrowingRecognition extends FakeRecognition {
      override start(): void {
        throw new Error("not allowed");
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ThrowingRecognition;
    const onTranscript = vi.fn();
    expect(startVoiceSearch({ onTranscript, onError: vi.fn() })).toBeNull();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("stops the recognizer through the returned handle", () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const handle = startVoiceSearch({ onTranscript: vi.fn(), onError: vi.fn() });
    handle?.stop();
    expect(FakeRecognition.last?.stopped).toBe(true);
  });
});

describe("voiceSearchErrorKey", () => {
  it("maps a denied microphone to the mic-denied string", () => {
    const error = new BackendApiError("denied", "voiceSearchDenied", null);
    expect(voiceSearchErrorKey(error, "search")).toBe("search_voice_mic_denied");
    expect(voiceSearchErrorKey(error, "music")).toBe("music_search_voice_mic_denied");
  });

  it("maps nothing-heard to the try-again string", () => {
    const error = new BackendApiError("no speech", "voiceSearchNoSpeech", null);
    expect(voiceSearchErrorKey(error, "search")).toBe("search_voice_no_speech");
    expect(voiceSearchErrorKey(error, "music")).toBe("music_search_voice_no_speech");
  });

  it("falls back to the unavailable string for other errors", () => {
    const error = new BackendApiError("gone", "voiceSearchUnavailable", null);
    expect(voiceSearchErrorKey(error, "search")).toBe("search_voice_unavailable");
    expect(voiceSearchErrorKey(error, "music")).toBe("music_search_voice_unavailable");
    expect(voiceSearchErrorKey(new Error("boom"), "search")).toBe("search_voice_unavailable");
  });
});

describe("native voice search (Windows)", () => {
  let native: typeof import("./voiceSearch");
  let invokeBackend: Mock;
  let originalNavigator: Navigator;

  beforeEach(async () => {
    vi.resetModules();
    originalNavigator = window.navigator;
    Object.defineProperty(window, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        language: "en-US",
      },
      configurable: true,
    });
    native = await import("./voiceSearch");
    const errors = await import("./api/errors");
    invokeBackend = vi.mocked(errors.invokeBackend);
    invokeBackend.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    FakeRecognition.last = null;
  });

  it("delivers the native transcript once, trimmed, and ends", async () => {
    invokeBackend.mockResolvedValueOnce("  hello world  ");
    const onTranscript = vi.fn();
    const onEnd = vi.fn();
    const handle = native.startVoiceSearch({ onTranscript, onError: vi.fn(), onEnd });
    expect(handle).not.toBeNull();
    expect(invokeBackend).toHaveBeenCalledWith("voice_search_listen", { lang: "en-US" });

    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello world"));
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("falls back to the web recognizer when the backend has none", async () => {
    invokeBackend.mockRejectedValueOnce(
      new BackendApiError("no native recognizer", "voiceSearchUnsupported", null),
    );
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const onTranscript = vi.fn();
    const handle = native.startVoiceSearch({ onTranscript, onError: vi.fn() });
    expect(handle).not.toBeNull();

    await vi.waitFor(() => expect(FakeRecognition.last?.started).toBe(true));
    FakeRecognition.last?.result("cats");
    expect(onTranscript).toHaveBeenCalledWith("cats");
  });

  it("reports a denied microphone through onError and ends", async () => {
    const denied = new BackendApiError("denied", "voiceSearchDenied", null);
    invokeBackend.mockRejectedValueOnce(denied);
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    native.startVoiceSearch({ onTranscript, onError, onEnd });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(denied));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stop cancels the in-flight listen and drops a late transcript", async () => {
    let resolveListen!: (value: string | null) => void;
    invokeBackend.mockImplementationOnce(
      (command: string) =>
        command === "voice_search_listen"
          ? new Promise<string | null>((resolve) => {
              resolveListen = resolve;
            })
          : Promise.resolve(undefined),
    );
    const onTranscript = vi.fn();
    const onEnd = vi.fn();
    const handle = native.startVoiceSearch({ onTranscript, onError: vi.fn(), onEnd });
    expect(handle).not.toBeNull();

    handle?.stop();
    expect(invokeBackend).toHaveBeenCalledWith("voice_search_cancel");
    expect(onEnd).toHaveBeenCalledTimes(1);

    resolveListen("too late");
    await Promise.resolve();
    await Promise.resolve();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
