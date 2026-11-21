import { useState } from "react";
import { CircleUserRound, LogIn, LogOut, UserPlus } from "lucide-react";
import { Button } from "../../ui/Button";
import { SettingItem } from "../SettingItem";
import { SettingsGroup } from "../SettingsGroup";
import { GoogleSignInDialog } from "../../GoogleSignInDialog";
import { getString } from "../../../lib/i18n/index";
import {
  googleAccountDisplayName,
  useGoogleAccount,
} from "../../../lib/useGoogleAccount";

/**
 * The "Google account" settings tab — Android's `AccountScreen.kt`, in
 * desktop form: status row, the signed-in account entry, Sign in /
 * Add account / Sign out rows, and the notice text, all with Android's
 * verbatim strings.
 *
 * Sign-out is immediate with no confirmation, like Android. Multi-account
 * switching is not supported yet (the app stores one Google session):
 * "Add account" signs the current account out and opens the sign-in
 * dialog, replacing the session — the tab says so.
 */
export function AccountTab() {
  const { status, account, error, signOut } = useGoogleAccount();
  const [signInOpen, setSignInOpen] = useState(false);
  const signedIn = status === "signed-in";

  const displayName = googleAccountDisplayName(account);
  const subtitle = account?.channelHandle ?? account?.email ?? null;

  /** Add account: replace the single stored session with a new sign-in. */
  const addAccount = async () => {
    await signOut();
    setSignInOpen(true);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("account_title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-chrome-neutral-400">{getString("account_summary")}</p>
      </div>

      <SettingsGroup title={getString("account_title")}>
        <div className="flex items-center gap-3 px-5 py-3">
          <CircleUserRound className="h-10 w-10 shrink-0 text-chrome-neutral-400" />
          <div className="min-w-0 flex-1">
            <div dir="auto" className="truncate text-sm font-medium text-chrome-neutral-200">
              {signedIn
                ? (displayName ?? getString("account_status_signed_in"))
                : getString("account_status_signed_out")}
            </div>
            {signedIn && subtitle && (
              <div dir="auto" className="mt-0.5 truncate text-xs text-chrome-neutral-400">{subtitle}</div>
            )}
            {!signedIn && (
              <div className="mt-0.5 text-xs text-chrome-neutral-400">{getString("account_sign_in_subtitle")}</div>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-chrome-neutral-300">
            {getString(signedIn ? "account_status_signed_in" : "account_status_signed_out")}
          </span>
        </div>

        {signedIn ? (
          <>
            <SettingItem
              title={getString("account_add_account")}
              description={getString("account_add_account_subtitle")}
              icon={<UserPlus className="h-5 w-5" />}
              onSelect={() => void addAccount()}
            />
            <SettingItem
              title={getString("account_sign_out")}
              description={getString("account_sign_out_subtitle")}
              icon={<LogOut className="h-5 w-5" />}
              titleClassName="text-chrome-red-400"
              onSelect={() => void signOut()}
            />
          </>
        ) : (
          <SettingItem
            title={getString("account_sign_in")}
            description={getString("account_sign_in_subtitle")}
            icon={<LogIn className="h-5 w-5" />}
            onSelect={() => setSignInOpen(true)}
          >
            <Button variant="secondary" size="sm" onClick={() => setSignInOpen(true)}>
              {getString("account_sign_in")}
            </Button>
          </SettingItem>
        )}
      </SettingsGroup>

      {signedIn && (
        <p className="text-xs text-chrome-neutral-400">{getString("account_replace_note")}</p>
      )}

      <p className="max-w-2xl text-sm text-chrome-neutral-400">
        {getString(signedIn ? "account_body_signed_in" : "account_body_signed_out")}
      </p>

      {error && (
        <p role="alert" className="text-sm text-chrome-red-400">
          {error}
        </p>
      )}

      {signInOpen && <GoogleSignInDialog onClose={() => setSignInOpen(false)} />}
    </div>
  );
}
