import { describe, expect, it } from "vitest";
import { homeOriginLabel, homeReasonLine } from "./homeOrigin";

describe("homeOriginLabel", () => {
  it("names the server home feed for server cards", () => {
    expect(homeOriginLabel({ kind: "server" })).toBe("From your YouTube home feed");
    expect(homeOriginLabel({ kind: "subscription" })).toBe("From a channel you follow");
    expect(homeOriginLabel({ kind: "search", detail: "Music" })).toBe("From a search for Music");
  });
});

describe("homeReasonLine", () => {
  it("speaks only for channels the viewer keeps watching", () => {
    expect(homeReasonLine({ kind: "channelMemory" })).toBe("From a channel you watch");
    expect(homeReasonLine({ kind: "subscription" })).toBeUndefined();
    expect(homeReasonLine(undefined)).toBeUndefined();
  });
});
