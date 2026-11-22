import { Logo } from "../common/Logo";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";

/**
 * The signed-out empty state, as on Android: the logo, "You're signed out",
 * a sign-in button and a way to search instead of an error or a retry.
 */
export function HomeGuestBanner({ onSignIn, onSearch }: { onSignIn: () => void; onSearch: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-chrome-zinc-800 bg-chrome-zinc-900/10 p-8 py-24 text-center">
      <Logo size={76} />
      <div>
        <h3 className="font-bold text-chrome-zinc-300">{getString("home_guest_title")}</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-chrome-zinc-500">{getString("home_guest_message")}</p>
      </div>
      <Button onClick={onSignIn}>{getString("home_guest_sign_in")}</Button>
      <button
        type="button"
        onClick={onSearch}
        className="rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {getString("search")}
      </button>
    </div>
  );
}
