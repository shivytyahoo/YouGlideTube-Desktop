import { useState } from "react";
import { CheckCircle2, CircleUserRound } from "lucide-react";
import { GoogleSignInDialog } from "../GoogleSignInDialog";
import { getString } from "../../lib/i18n/index";
import { useGoogleAccount } from "../../lib/useGoogleAccount";

/**
 * Second step, as on Android: sign in with Google so the feed, subscriptions
 * and history come from the account. Skippable — the account can be added
 * later from Settings.
 */
export function SignInStep() {
  const { status } = useGoogleAccount();
  const [signInOpen, setSignInOpen] = useState(false);
  const signedIn = status === "signed-in";

  return (
    <div className="flex w-full flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-surface-container-high text-primary">
          <CircleUserRound size={36} />
        </span>
        <div>
          <h1 className="mb-1 text-4xl font-semibold tracking-tight text-chrome-neutral-100">
            {getString("onboarding_signin_title")}
          </h1>
          <p className="text-lg text-chrome-neutral-400">{getString("onboarding_signin_subtitle")}</p>
        </div>
      </div>

      {signedIn ? (
        <div className="flex items-center gap-3 rounded-2xl bg-primary-container px-5 py-4 text-on-primary-container">
          <CheckCircle2 size={22} className="shrink-0 text-primary" />
          <div>
            <p className="font-semibold">{getString("onboarding_signin_signed_in")}</p>
            <p className="text-sm opacity-80">{getString("onboarding_signin_signed_in_subtitle")}</p>
          </div>
        </div>
      ) : (
        <button
          className="w-full rounded-full bg-primary px-8 py-3.5 font-bold text-sm text-chrome-white transition-all duration-300 hover:bg-primary active:scale-95 cursor-pointer"
          onClick={() => setSignInOpen(true)}
        >
          {getString("onboarding_signin_google")}
        </button>
      )}

      {signInOpen && <GoogleSignInDialog onClose={() => setSignInOpen(false)} />}
    </div>
  );
}

export default SignInStep;
