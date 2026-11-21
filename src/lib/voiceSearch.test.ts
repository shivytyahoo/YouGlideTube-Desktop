import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isVoiceSearchAvailable, startVoiceSearch, type SpeechRecognitionInstance } from "./voiceSearch";

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
