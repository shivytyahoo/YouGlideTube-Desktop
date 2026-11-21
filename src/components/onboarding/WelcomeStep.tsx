import { Logo } from "../common/Logo";
import { getString } from "../../lib/i18n/index";

/** First step, as on Android: the logo, the app name, and one line each for title and subtitle. */
export function WelcomeStep() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 w-40">
        <Logo size={160} />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Logo size={28} />
        <span className="text-lg font-bold text-primary">YouGlideTube</span>
      </div>
      <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
        {getString("onboarding_welcome_title")}
      </h1>
      <p className="max-w-xl text-lg text-chrome-neutral-400">
        {getString("onboarding_welcome_subtitle")}
      </p>
    </div>
  );
}

export default WelcomeStep;
