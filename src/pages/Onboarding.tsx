import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setSetting } from "../lib/api/db";
import { Logo } from "../components/common/Logo";
import WelcomeStep from "../components/onboarding/WelcomeStep";
import SignInStep from "../components/onboarding/SignInStep";
import ChannelsStep from "../components/onboarding/ChannelsStep";
import { ReadyStep } from "../components/onboarding/ReadyStep";
import { onboardingProgress, onboardingSteps } from "../lib/onboardingSteps";
import { getString } from "../lib/i18n/index";

/**
 * The setup flow, as on Android: Welcome, Sign in, Channels, Ready. The two
 * middle steps are the only ones the progress bar counts, and both are
 * skippable. No interests, artists, alerts or import step — Android's onboarding
 * has none of those.
 */
export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [steps] = useState(() => onboardingSteps());
  const step = steps[currentStep] ?? "welcome";
  const lastStep = steps.length - 1;

  const finish = async () => {
    try {
      await setSetting("onboarding_completed", "true");
      navigate("/");
    } catch (e) {
      console.error("Failed to complete onboarding", e);
      navigate("/");
    }
  };

  const handleNext = async () => {
    if (currentStep < lastStep) {
      setCurrentStep(currentStep + 1);
    } else {
      await finish();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const progressPercentage = onboardingProgress(steps, step);
  const isMiddleStep = step === "signin" || step === "channels";
  const nextLabel =
    step === "welcome"
      ? getString("onboarding_welcome_get_started")
      : step === "ready"
        ? getString("onboarding_start_watching")
        : getString("onboarding_continue");

  return (
    <div className="w-full h-full overflow-hidden flex flex-col bg-surface font-sans relative">
      {/* Absolute Top Progress Bar (middle steps only) */}
      {progressPercentage !== null && (
        <div className="absolute top-0 start-0 end-0 h-[2px] bg-chrome-zinc-800/50 z-50">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      )}

      {/* Header with Logo */}
      <div className="absolute top-0 start-0 z-40 flex items-center gap-4 p-8">
        <Logo size={40} showText={true} />
      </div>

      {/* Skip (middle steps only, top-right) */}
      {isMiddleStep && (
        <div className="absolute top-0 end-0 z-40 p-8">
          <button
            className="text-chrome-neutral-500 hover:text-chrome-neutral-300 font-semibold text-sm transition-colors cursor-pointer"
            onClick={finish}
          >
            {getString("onboarding_skip")}
          </button>
        </div>
      )}

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto w-full pt-32 pb-16">
        <div className="max-w-5xl mx-auto px-8 lg:px-12 w-full">

          {step === "welcome" && <WelcomeStep />}

          {step === "signin" && <SignInStep />}

          {step === "channels" && <ChannelsStep />}

          {step === "ready" && (
            <ReadyStep
              onJumpToSignIn={() => setCurrentStep(steps.indexOf("signin"))}
              onJumpToChannels={() => setCurrentStep(steps.indexOf("channels"))}
            />
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="w-full bg-surface border-t border-chrome-neutral-800/50 z-40">
        <div className="max-w-5xl mx-auto px-8 lg:px-12 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {currentStep > 0 && (
              <button
                className="text-chrome-neutral-500 hover:text-chrome-neutral-300 font-semibold text-sm transition-colors cursor-pointer flex items-center gap-2"
                onClick={handleBack}
              >
                <span>&larr;</span> {getString("onboarding_back")}
              </button>
            )}
          </div>

          <button
            className="px-8 py-3 rounded-full font-bold text-sm transition-all duration-300 bg-primary text-chrome-white hover:bg-primary active:scale-95 cursor-pointer"
            onClick={handleNext}
          >
            {nextLabel} {step !== "ready" && <span>&rarr;</span>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
