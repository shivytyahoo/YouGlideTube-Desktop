import { describe, expect, it } from "vitest";

import { adjustCountText, parseCountText } from "./utils";

describe("parseCountText", () => {
  it("reads plain counts with thousands separators", () => {
    expect(parseCountText("12,345")).toBe(12345);
    expect(parseCountText("42")).toBe(42);
    expect(parseCountText("1,234,567")).toBe(1234567);
  });

  it("expands the K/M/B/T suffixes formatCount writes", () => {
    expect(parseCountText("1.2K")).toBe(1200);
    expect(parseCountText("12K")).toBe(12000);
    expect(parseCountText("1.2M")).toBe(1200000);
    expect(parseCountText("1.2B")).toBe(1200000000);
    expect(parseCountText("1.5k")).toBe(1500);
  });

  it("returns null when the text is not a count", () => {
    expect(parseCountText("")).toBeNull();
    expect(parseCountText(null)).toBeNull();
    expect(parseCountText(undefined)).toBeNull();
    expect(parseCountText("No likes yet")).toBeNull();
    expect(parseCountText("1.2K likes")).toBe(1200);
  });
});

describe("adjustCountText", () => {
  it("flips a displayed count by the delta", () => {
    expect(adjustCountText("42", 1)).toBe("43");
    expect(adjustCountText("42", -1)).toBe("41");
    expect(adjustCountText("1", -1)).toBe("0");
    expect(adjustCountText("0", -1)).toBe("0");
  });

  it("keeps the compact form, rounding back like YouTube", () => {
    expect(adjustCountText("1.2K", 1)).toBe("1.2K");
    expect(adjustCountText("2.2K", -1)).toBe("2.2K");
  });

  it("leaves text that is not a count alone", () => {
    expect(adjustCountText("No likes yet", 1)).toBe("No likes yet");
    expect(adjustCountText(null, 1)).toBeNull();
    expect(adjustCountText(undefined, 1)).toBeNull();
  });
});
