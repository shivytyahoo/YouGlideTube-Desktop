import { useState } from "react";
import { Check, CircleUserRound, LogIn, LogOut, UserPlus, X } from "lucide-react";
import { Button } from "../../ui/Button";
import { SettingItem } from "../SettingItem";
import { SettingsGroup } from "../SettingsGroup";
import { GoogleSignInDialog } from "../../GoogleSignInDialog";
import { getString } from "../../../lib/i18n/index";
import type { AccountSummary } from "../../../lib/api/account";
import {
  accountRowLabel,
  googleAccountDisplayName,
  googleAccountInitial,
  useGoogleAccount,
  type GoogleAccountInfo,
} from "../../../lib/useGoogleAccount";

/**
 * The "Google account" settings tab — Android's `AccountScreen.kt`, in
 * desktop form: status row, one row per saved account (tap to switch, the
 * active one marked), Sign in / Add account / Sign out rows, and the
 * notice text, all with Android's verbatim strings.
 *
 * Sign-out is immediate with no confirmation, like Android: it signs out
 * of the ACTIVE account, and the next saved account (if any) becomes
 * active. A non-active account can be removed with the × on its row.
 */
export function AccountTab() {
  const { status, account, accounts, error, signOut, switchAccount, removeAccount } =
    useGoogleAccount();
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInMode, setSignInMode] = useState<"sign-in" | "add-account">("sign-in");
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const signedIn = status === "signed-in";

  const displayName = googleAccountDisplayName(account);
  const subtitle = account?.channelHandle ?? account?.email ?? null;

  /** Add account: open the sign-in dialog in add mode; the current account stays saved. */
  const addAccount = () => {
    setSignInMode("add-account");
    setSignInOpen(true);
  };

  const openSignIn = () => {
    setSignInMode("sign-in");
    setSignInOpen(true);
  };

  const switchTo = async (id: string) => {
    setSwitchingId(id);
    await switchAccount(id);
    setSwitchingId(null);
  };

  const remove = async (id: string) => {
    setRemovingId(id);
    await removeAccount(id);
    setRemovingId(null);
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

        {signedIn &&
          accounts.map((saved) => (
            <AccountRow
              key={saved.id}
              saved={saved}
              // The active row shows the live identity (just fetched) rather
              // than the disk snapshot, so the real name appears the moment
              // the menu answers — even before the saved list refreshes.
              live={saved.isActive ? account : null}
              disabled={switchingId !== null || removingId !== null}
              onSelect={() => void switchTo(saved.id)}
              onRemove={() => void remove(saved.id)}
            />
          ))}

        {signedIn ? (
          <>
            <SettingItem
              title={getString("account_add_account")}
              description={getString("account_add_account_subtitle")}
              icon={<UserPlus className="h-5 w-5" />}
              onSelect={addAccount}
            />
            <SettingItem
              title={getString("account_sign_out")}
              description={getString(
                accounts.length > 1 ? "account_sign_out_next_subtitle" : "account_sign_out_subtitle",
              )}
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
            onSelect={openSignIn}
          >
            <Button variant="secondary" size="sm" onClick={openSignIn}>
              {getString("account_sign_in")}
            </Button>
          </SettingItem>
        )}
      </SettingsGroup>

      <p className="max-w-2xl text-sm text-chrome-neutral-400">
        {getString(signedIn ? "account_body_signed_in" : "account_body_signed_out")}
      </p>

      {error && (
        <p role="alert" className="text-sm text-chrome-red-400">
          {error}
        </p>
      )}

      {signInOpen && <GoogleSignInDialog mode={signInMode} onClose={() => setSignInOpen(false)} />}
    </div>
  );
}

/**
 * One saved account: Android's `AccountScreen` option row — the display
 * name, the channel handle (else email) under it, selected when active.
 * Tap switches to it; the × removes a non-active account. The row is a
 * plain div (not a SettingItem) so the remove button is not nested inside
 * another button.
 *
 * `live` is the just-fetched identity for the active account: it wins
 * over the disk snapshot, so the real name shows the moment the account
 * menu answers. A row with no identity at all shows the short account id
 * instead of a generic label — the server simply hasn't identified it yet.
 */
function AccountRow({
  saved,
  live,
  disabled,
  onSelect,
  onRemove,
}: {
  saved: AccountSummary;
  live: GoogleAccountInfo | null;
  disabled: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const shown: AccountSummary = live
    ? {
        ...saved,
        name: live.name ?? saved.name,
        email: live.email ?? saved.email,
        channelHandle: live.channelHandle ?? saved.channelHandle,
        thumbnailUrl: live.thumbnailUrl ?? saved.thumbnailUrl,
      }
    : saved;
  const name = accountRowLabel(shown);
  const detail = shown.channelHandle ?? shown.email ?? null;
  const displayName = googleAccountDisplayName(shown);
  return (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors duration-200 ease-out hover:bg-surface-row-hover">
      <button
        type="button"
        disabled={disabled || saved.isActive}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-70"
      >
        {shown.thumbnailUrl ? (
          <img
            src={shown.thumbnailUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : displayName ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-sm font-medium text-chrome-neutral-200">
            {googleAccountInitial(shown)}
          </span>
        ) : (
          <CircleUserRound className="h-10 w-10 shrink-0 text-chrome-neutral-400" />
        )}
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-medium text-chrome-neutral-200">
            {name}
          </span>
          {detail && (
            <span dir="auto" className="mt-0.5 block truncate text-xs text-chrome-neutral-400">
              {detail}
            </span>
          )}
        </span>
      </button>
      {saved.isActive ? (
        <Check size={18} className="shrink-0 text-primary" aria-label={getString("account_status_signed_in")} />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={getString("account_remove_account")}
          title={getString("account_remove_account")}
          className="shrink-0 rounded-full p-1.5 text-chrome-neutral-500 hover:bg-surface-container-high hover:text-chrome-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
