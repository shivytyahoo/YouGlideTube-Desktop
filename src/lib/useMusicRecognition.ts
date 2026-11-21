import { useCallback, useEffect, useRef, useState } from "react";
import { BackendApiError } from "./api/errors";
import type { StringKey } from "./i18n/index";
import {
  MicCancelledError,
  captureMicAudio,
  isMicCaptureAvailable,
  recognitionErrorKey,
  recognizeSong,
  type RecognitionResult,
} from "./recognition";

/**
 * One recognition run, as Android's `RecognitionStatus` models it: idle,
 * listening (with progress over the 12s window), processing, then the
 * result — or no-match / error with a message key.
 */
export type MusicRecognitionStatus =
  | { state: "idle" }
  | { state: "listening"; progress: number }
  | { state: "processing" }
  | { state: "success"; result: RecognitionResult }
  | { state: "noMatch"; messageKey: StringKey }
  | { state: "error"; messageKey: StringKey };

/**
 * Owns one recognition run: mic capture, then the backend lookup. Cancel
 * abandons the run (a lookup already in flight finishes unheard — its
 * result is discarded, never shown). Unmount cancels too.
 */
export function useMusicRecognition() {
  const [status, setStatus] = useState<MusicRecognitionStatus>({ state: "idle" });
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    if (!isMicCaptureAvailable()) {
      setStatus({
        state: "error",
        messageKey: "music_recognition_mic_unavailable",
      });
      return;
    }
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ state: "listening", progress: 0 });

    void (async () => {
      try {
        const capture = await captureMicAudio({
          signal: controller.signal,
          onProgress: (fraction) => {
            if (runIdRef.current === runId) {
              setStatus({ state: "listening", progress: fraction });
            }
          },
        });
        if (runIdRef.current !== runId) return;
        setStatus({ state: "processing" });
        const result = await recognizeSong(capture.pcmBase64, capture.sampleRate);
        if (runIdRef.current !== runId) return;
        setStatus({ state: "success", result });
      } catch (error) {
        if (runIdRef.current !== runId) return;
        if (error instanceof MicCancelledError) {
          setStatus({ state: "idle" });
          return;
        }
        if (
          error instanceof BackendApiError &&
          error.kind === "recognitionNoMatch"
        ) {
          setStatus({ state: "noMatch", messageKey: "music_recognition_no_match" });
          return;
        }
        setStatus({ state: "error", messageKey: recognitionErrorKey(error) });
      }
    })();
  }, []);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus({ state: "idle" });
  }, []);

  const reset = useCallback(() => setStatus({ state: "idle" }), []);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  return { status, start, cancel, reset };
}
