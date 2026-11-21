import { describe, expect, it } from "vitest";
import { onboardingProgress, onboardingSteps } from "./onboardingSteps";

describe("onboarding steps", () => {
  it("runs Welcome, Sign in, Channels, Ready, as on Android", () => {
    expect(onboardingSteps()).toEqual(["welcome", "signin", "channels", "ready"]);
  });

  it("counts only the two middle steps, as on Android", () => {
    const steps = onboardingSteps();
    expect(onboardingProgress(steps, "welcome")).toBeNull();
    expect(onboardingProgress(steps, "ready")).toBeNull();
    expect(onboardingProgress(steps, "signin")).toBe(50);
    expect(onboardingProgress(steps, "channels")).toBe(100);
  });
});
