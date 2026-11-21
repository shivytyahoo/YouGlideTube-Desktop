/** The setup steps in order, as on Android: Welcome, Sign in, Channels, Ready. */
export type OnboardingStep = "welcome" | "signin" | "channels" | "ready";

export function onboardingSteps(): OnboardingStep[] {
  return ["welcome", "signin", "channels", "ready"];
}

/**
 * The bar counts only the two middle steps (Sign in, Channels), as on Android:
 * share done, or null when it is hidden (Welcome and Ready).
 */
export function onboardingProgress(steps: OnboardingStep[], step: OnboardingStep): number | null {
  const counted: OnboardingStep[] = steps.filter((item) => item === "signin" || item === "channels");
  const index = counted.indexOf(step);
  return index < 0 ? null : ((index + 1) / counted.length) * 100;
}
