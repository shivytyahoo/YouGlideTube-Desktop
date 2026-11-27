import { describe, expect, it } from "vitest";

import { clampBalance, midSideGains, nightCompressor, spatialWidth } from "./spatial";

describe("spatialWidth", () => {
  it("leaves the side alone when off and widens in steps", () => {
    expect(spatialWidth("OFF")).toBe(1);
    expect(spatialWidth("LOW")).toBe(1.25);
    expect(spatialWidth("MEDIUM")).toBe(1.6);
    expect(spatialWidth("HIGH")).toBe(2);
  });
});

describe("midSideGains", () => {
  it("rebuilds the input exactly at width 1", () => {
    // L = mid + side, R = mid − side, with mid = (L+R)/2 and side = (L−R)/2.
    const { mid, side } = midSideGains(1);
    const l = 0.8;
    const r = 0.2;
    expect(mid * (l + r) + side * (l - r)).toBeCloseTo(l, 9);
    expect(mid * (l + r) - side * (l - r)).toBeCloseTo(r, 9);
  });

  it("turns the side up and the mid down as width grows", () => {
    const { mid, side } = midSideGains(2);
    expect(mid).toBe(0.5);
    expect(side).toBe(1);
  });
});

describe("clampBalance", () => {
  it("keeps the pan inside the speakers", () => {
    expect(clampBalance(2)).toBe(1);
    expect(clampBalance(-2)).toBe(-1);
    expect(clampBalance(0.25)).toBe(0.25);
    expect(clampBalance(Number.NaN)).toBe(0);
  });
});

describe("nightCompressor", () => {
  it("compresses and lifts when on, passes through when off", () => {
    const on = nightCompressor(true);
    expect(on.ratio).toBeGreaterThan(1);
    expect(on.thresholdDb).toBeLessThan(0);
    expect(on.makeupGainDb).toBeGreaterThan(0);
    const off = nightCompressor(false);
    expect(off.ratio).toBe(1);
    expect(off.makeupGainDb).toBe(0);
  });
});
