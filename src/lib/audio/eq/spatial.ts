import type { EqSpatialSound } from "./models";

/**
 * The stereo stage that sits after the filters in the equalizer chain: a mid/side matrix for
 * width, a panner for balance, and a compressor for night mode. The numbers here are the only
 * place the stage is tuned; the chain only moves parameters.
 */

/** How much the side channel is turned up for each width step; OFF leaves it alone. */
export function spatialWidth(sound: EqSpatialSound): number {
  switch (sound) {
    case "OFF":
      return 1;
    case "LOW":
      return 1.25;
    case "MEDIUM":
      return 1.6;
    case "HIGH":
      return 2;
  }
}

/**
 * The two gains of the mid/side matrix. Mid is (L+R)/2 and side is (L−R)/2, so with width 1 the
 * matrix rebuilds the input exactly: L = mid + side, R = mid − side.
 */
export function midSideGains(width: number): { mid: number; side: number } {
  return { mid: 0.5, side: 0.5 * width };
}

/** Left is −1, right is +1, centre is 0. */
export const clampBalance = (value: number): number =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;

export interface NightCompressor {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSeconds: number;
  releaseSeconds: number;
  /** Make-up gain, in dB: compression alone only makes everything quieter. */
  makeupGainDb: number;
}

/**
 * Night mode: a compressor that tames loud parts and, with make-up gain, lifts quiet ones so
 * dialogue stays audible at low volume. Off is a ratio of 1, which passes the signal through.
 */
export function nightCompressor(on: boolean): NightCompressor {
  return on
    ? { thresholdDb: -24, kneeDb: 18, ratio: 4, attackSeconds: 0.003, releaseSeconds: 0.25, makeupGainDb: 4 }
    : { thresholdDb: 0, kneeDb: 0, ratio: 1, attackSeconds: 0.003, releaseSeconds: 0.25, makeupGainDb: 0 };
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
