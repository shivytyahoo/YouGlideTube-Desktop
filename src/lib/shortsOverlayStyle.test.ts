import { describe, expect, it } from "vitest";
import { parseShortsUiMode, shortsOverlayStyle } from "./shortsOverlayStyle";

describe("shortsOverlayStyle", () => {
  it("shows rail labels and a subscribe button in Default", () => {
    expect(shortsOverlayStyle("default")).toEqual({
      showRailLabels: true,
      subscribeControl: "button",
      controlsOnDemand: false,
      toastOnSave: false,
    });
  });

  it("hides rail labels, uses an icon subscribe toggle and toasts on save in Simple", () => {
    expect(shortsOverlayStyle("simple")).toEqual({
      showRailLabels: false,
      subscribeControl: "icon",
      controlsOnDemand: false,
      toastOnSave: true,
    });
  });

  it("keeps labels and the button but hides chrome on demand in Impressive", () => {
    expect(shortsOverlayStyle("impressive")).toEqual({
      showRailLabels: true,
      subscribeControl: "button",
      controlsOnDemand: true,
      toastOnSave: false,
    });
  });

  it("falls back to Default for unknown values", () => {
    expect(parseShortsUiMode(undefined)).toBe("default");
    expect(parseShortsUiMode("fancy")).toBe("default");
    expect(parseShortsUiMode("simple")).toBe("simple");
    expect(parseShortsUiMode("impressive")).toBe("impressive");
  });
});
