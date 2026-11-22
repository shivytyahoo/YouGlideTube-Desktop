import { describe, expect, it } from "vitest";

import { effectiveFallbackCodec } from "./codecPreference";

describe("effectiveFallbackCodec", () => {
  it("uses the chosen fallback when it differs from the preferred codec", () => {
    expect(effectiveFallbackCodec("H.264", "AV1")).toBe("AV1");
  });

  it("never returns the preferred codec", () => {
    expect(effectiveFallbackCodec("H.264", "H.264")).toBe("VP9");
    expect(effectiveFallbackCodec("VP9", "Auto")).toBe("H.264");
    expect(effectiveFallbackCodec("AV1", "Auto")).toBe("H.264");
  });
});
