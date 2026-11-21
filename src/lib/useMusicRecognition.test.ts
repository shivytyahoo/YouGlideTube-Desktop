import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendApiError } from "./api/errors";
import {
  MicDeniedError,
  type MicCapture,
  type RecognitionResult,
} from "./recognition";
import { useMusicRecognition } from "./useMusicRecognition";

const captureMicAudio = vi.fn();
const recognizeSong = vi.fn();
const isMicCaptureAvailable = vi.fn(() => true);

vi.mock("./recognition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./recognition")>()),
  isMicCaptureAvailable: () => isMicCaptureAvailable(),
  captureMicAudio: (...args: unknown[]) => captureMicAudio(...args),
  recognizeSong: (...args: unknown[]) => recognizeSong(...args),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const songResult: RecognitionResult = {
  trackId: "12345",
  title: "Test Song",
  artist: "Test Artist",
  youtubeVideoId: "dQw4w9WgXcQ",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let latest!: ReturnType<typeof useMusicRecognition>;

function Probe() {
  latest = useMusicRecognition();
  return null;
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(Probe));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
  isMicCaptureAvailable.mockReturnValue(true);
});

describe("useMusicRecognition", () => {
  it("runs listening -> processing -> success", async () => {
    const capture = deferred<MicCapture>();
    const lookup = deferred<RecognitionResult>();
    captureMicAudio.mockReturnValueOnce(capture.promise);
    recognizeSong.mockReturnValueOnce(lookup.promise);

    act(() => {
      latest.start();
    });
    expect(latest.status).toEqual({ state: "listening", progress: 0 });

    await act(async () => {
      capture.resolve({ pcmBase64: "AAAA", sampleRate: 48000 });
    });
    expect(latest.status).toEqual({ state: "processing" });
    expect(recognizeSong).toHaveBeenCalledWith("AAAA", 48000);

    await act(async () => {
      lookup.resolve(songResult);
    });
    expect(latest.status).toEqual({ state: "success", result: songResult });
  });

  it("reports listening progress from the capture", async () => {
    const capture = deferred<MicCapture>();
    captureMicAudio.mockImplementationOnce((options: {
      onProgress?: (fraction: number) => void;
    }) => {
      options.onProgress?.(0.5);
      return capture.promise;
    });
    recognizeSong.mockResolvedValue(songResult);

    act(() => {
      latest.start();
    });
    expect(latest.status).toEqual({ state: "listening", progress: 0.5 });

    await act(async () => {
      capture.resolve({ pcmBase64: "AAAA", sampleRate: 48000 });
    });
  });

  it("maps a no-match lookup to the noMatch state", async () => {
    captureMicAudio.mockResolvedValue({ pcmBase64: "AAAA", sampleRate: 48000 });
    recognizeSong.mockRejectedValue(
      new BackendApiError("m", "recognitionNoMatch", null),
    );

    act(() => {
      latest.start();
    });
    await act(async () => {});
    expect(latest.status).toEqual({
      state: "noMatch",
      messageKey: "music_recognition_no_match",
    });
  });

  it("maps a denied mic to the mic-denied error state", async () => {
    captureMicAudio.mockRejectedValue(new MicDeniedError());

    act(() => {
      latest.start();
    });
    await act(async () => {});
    expect(latest.status).toEqual({
      state: "error",
      messageKey: "music_recognition_mic_denied",
    });
  });

  it("reports mic-unavailable without starting a capture", () => {
    isMicCaptureAvailable.mockReturnValue(false);

    act(() => {
      latest.start();
    });
    expect(captureMicAudio).not.toHaveBeenCalled();
    expect(latest.status).toEqual({
      state: "error",
      messageKey: "music_recognition_mic_unavailable",
    });
  });

  it("cancel during listening returns to idle and ignores the late result", async () => {
    const capture = deferred<MicCapture>();
    captureMicAudio.mockReturnValueOnce(capture.promise);
    recognizeSong.mockResolvedValue(songResult);

    act(() => {
      latest.start();
    });
    act(() => {
      latest.cancel();
    });
    expect(latest.status).toEqual({ state: "idle" });

    await act(async () => {
      capture.resolve({ pcmBase64: "AAAA", sampleRate: 48000 });
    });
    expect(latest.status).toEqual({ state: "idle" });
    expect(recognizeSong).not.toHaveBeenCalled();
  });
});
