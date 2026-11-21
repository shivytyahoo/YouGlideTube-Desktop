import { Check } from "lucide-react";
import { getPlural, getString } from "../../lib/i18n/index";
import { useGoogleAccount } from "../../lib/useGoogleAccount";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";

/**
 * All set, as on Android: the account and channel counts as tappable chips,
 * each jumping back to the step that set it.
 */
export function ReadyStep({
  onJumpToSignIn,
  onJumpToChannels,
}: {
  onJumpToSignIn: () => void;
  onJumpToChannels: () => void;
}) {
  const { status } = useGoogleAccount();
  const channelCount = useSubscriptionStore((state) => state.subscriptions.length);
  const signedIn = status === "signed-in";

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <span className="mb-8 grid h-16 w-16 place-items-center rounded-full bg-surface-container-high text-primary">
        <Check size={32} />
      </span>
      <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
        {getString("onboarding_ready_title")}
      </h1>
      <p className="text-lg text-chrome-neutral-400">{getString("onboarding_ready_subtitle")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest cursor-pointer"
          onClick={onJumpToSignIn}
        >
          {signedIn ? getString("onboarding_ready_signed_in") : getString("onboarding_ready_guest")}
        </button>
        <button
          className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium tabular-nums text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest cursor-pointer"
          onClick={onJumpToChannels}
        >
          {getPlural("onboarding_ready_channels", channelCount)}
        </button>
      </div>
    </div>
  );
}

export default ReadyStep;
