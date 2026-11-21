import { describe, expect, it } from "vitest";
import { BackendApiError } from "./api/errors";
import {
  MicDeniedError,
  MicUnavailableError,
  floatToInt16Pcm,
  isMicCaptureAvailable,
  pcmToBase64,
  recognitionErrorKey,
  recognitionResultToSong,
  searchQueryFor,
  type RecognitionResult,
} from "./recognition";

function result(overrides: Partial<RecognitionResult> = {}): RecognitionResult {
  return {
    trackId: "12345",
    title: "Test Song",
    artist: "Test Artist",
    album: "Test Album",
    coverArtHqUrl: "https://example.test/hq.jpg",
    coverArtUrl: "https://example.test/cover.jpg",
    youtubeVideoId: "dQw4w9WgXcQ",
    ...overrides,
  };
}

describe("searchQueryFor", () => {
  it("joins title and artist, as Android does", () => {
    expect(searchQueryFor("Test Song", "Test Artist")).toBe("Test Song Test Artist");
    expect(searchQueryFor("Test Song", "")).toBe("Test Song");
    expect(searchQueryFor("", "")).toBe("");
  });
});

describe("recognitionResultToSong", () => {
  it("builds a playable song from a result with a video id", () => {
    const song = recognitionResultToSong(result());
    expect(song).not.toBeNull();
    expect(song?.videoId).toBe("dQw4w9WgXcQ");
    expect(song?.title).toBe("Test Song");
    expect(song?.artists).toEqual([{ name: "Test Artist", id: null }]);
    expect(song?.album).toEqual({ name: "Test Album", id: "" });
    expect(song?.thumbnail).toBe("https://example.test/hq.jpg");
    expect(song?.duration).toBe(0);
  });

  it("prefers the HQ cover, falls back to the standard one", () => {
    expect(
      recognitionResultToSong(result({ coverArtHqUrl: null }))?.thumbnail,
    ).toBe("https://example.test/cover.jpg");
    expect(
      recognitionResultToSong(result({ coverArtHqUrl: null, coverArtUrl: null }))
        ?.thumbnail,
    ).toBe("");
  });

  it("returns null when the result has no YouTube id", () => {
    expect(recognitionResultToSong(result({ youtubeVideoId: null }))).toBeNull();
    expect(recognitionResultToSong(result({ youtubeVideoId: "" }))).toBeNull();
  });
});

describe("floatToInt16Pcm", () => {
  it("scales and clamps float samples", () => {
    const pcm = floatToInt16Pcm(
      new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]),
    );
    expect(Array.from(pcm)).toEqual([0, 16383, -16383, 32767, -32767, 32767, -32767]);
  });
});

describe("pcmToBase64", () => {
  it("round-trips little-endian PCM bytes", () => {
    const pcm = new Int16Array([1, -2, 32767, -32768]);
    const binary = atob(pcmToBase64(pcm));
    const bytes = Array.from(binary, (ch) => ch.charCodeAt(0));
    expect(bytes).toEqual([0x01, 0x00, 0xfe, 0xff, 0xff, 0x7f, 0x00, 0x80]);
  });
});

describe("recognitionErrorKey", () => {
  it("maps each backend kind to its own message", () => {
    expect(
      recognitionErrorKey(new BackendApiError("m", "recognitionNoMatch", null)),
    ).toBe("music_recognition_no_match");
    expect(recognitionErrorKey(new BackendApiError("m", "rateLimited", null))).toBe(
      "music_recognition_busy",
    );
    expect(recognitionErrorKey(new BackendApiError("m", "network", null))).toBe(
      "music_recognition_network",
    );
    expect(recognitionErrorKey(new BackendApiError("m", "internal", null))).toBe(
      "music_recognition_failed",
    );
  });

  it("maps mic errors and unknown failures", () => {
    expect(recognitionErrorKey(new MicDeniedError())).toBe(
      "music_recognition_mic_denied",
    );
    expect(recognitionErrorKey(new MicUnavailableError())).toBe(
      "music_recognition_mic_unavailable",
    );
    expect(recognitionErrorKey(new Error("boom"))).toBe("music_recognition_failed");
  });
});

describe("isMicCaptureAvailable", () => {
  it("is false where the webview exposes no media devices", () => {
    // jsdom has no mediaDevices, like a webview without mic support.
    expect(isMicCaptureAvailable()).toBe(false);
  });
});
