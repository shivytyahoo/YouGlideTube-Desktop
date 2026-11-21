import { Check, CircleUserRound, LogOut, Settings, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { getString } from "../../lib/i18n/index";
import {
  accountRowLabel,
  googleAccountDisplayName,
  googleAccountInitial,
  useGoogleAccount,
  type GoogleAccountInfo,
} from "../../lib/useGoogleAccount";

/**
 * The account popup behind the top-bar avatar — YouTube desktop's account
 * menu, in desktop form: the current account's info, every saved account
 * to switch between, Add account, a row opening the Google account
 * settings page, and Sign out.
 *
 * The avatar itself never opens this menu while signed out (the top bar
 * shows the "Sign in" button instead). Switching and sign-out stay in
 * the menu on failure and show the error here, so the user can retry.
 */
export function AccountMenu({
  anchor,
  onClose,
  onAddAccount,
}: {
  anchor: MenuAnchor;
  onClose: () => void;
  onAddAccount: () => void;
}) {
  const { account, accounts, error, switchAccount, signOut } = useGoogleAccount();
  const navigate = useNavigate();

  const displayName = googleAccountDisplayName(account);
  const detail = account?.channelHandle ?? account?.email ?? null;

  const switchTo = async (id: string) => {
    if (await switchAccount(id)) onClose();
  };

  const openAccountSettings = () => {
    onClose();
    navigate("/settings", { state: { settingsCategory: "account" } });
  };

  const doSignOut = async () => {
    if (await signOut()) onClose();
  };

  return (
    <AnchoredPortalMenu
      anchor={anchor}
      onClose={onClose}
      closeOnScroll={false}
      className="z-[70] flex max-h-[70vh] w-[22rem] flex-col overflow-y-auto rounded-2xl border border-chrome-neutral-800 bg-surface-container-high"
    >
      <div className="flex items-center gap-3 border-b border-chrome-neutral-800 px-4 py-3">
        <AccountAvatar account={account} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div dir="auto" className="truncate text-sm font-medium text-chrome-neutral-200">
            {displayName ?? getString("account_status_signed_in")}
          </div>
          {detail && (
            <div dir="auto" className="mt-0.5 truncate text-xs text-chrome-neutral-400">
              {detail}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="border-b border-chrome-neutral-800 px-4 py-2 text-sm text-chrome-red-400">
          {error}
        </p>
      )}

      {accounts.length > 0 && (
        <div role="menu" aria-label={getString("account_menu_switch")} className="py-1">
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-chrome-neutral-500">
            {getString("account_menu_switch")}
          </p>
          {accounts.map((saved) => {
            const savedDetail = saved.channelHandle ?? saved.email ?? null;
            return (
              <button
                key={saved.id}
                type="button"
                role="menuitem"
                disabled={saved.isActive}
                onClick={() => void switchTo(saved.id)}
                className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-70"
              >
                <AccountAvatar
                  account={{
                    name: saved.name,
                    email: saved.email,
                    channelHandle: saved.channelHandle,
                    thumbnailUrl: saved.thumbnailUrl,
                  }}
                  size="h-9 w-9"
                />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm text-chrome-neutral-200">
                    {accountRowLabel(saved)}
                  </span>
                  {savedDetail && (
                    <span dir="auto" className="mt-0.5 block truncate text-xs text-chrome-neutral-400">
                      {savedDetail}
                    </span>
                  )}
                </span>
                {saved.isActive && (
                  <Check size={18} className="shrink-0 text-primary" aria-label={getString("account_status_signed_in")} />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="border-t border-chrome-neutral-800 py-1">
        <button
          type="button"
          role="menuitem"
          onClick={onAddAccount}
          className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <UserPlus className="h-5 w-5 shrink-0 text-chrome-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-chrome-neutral-200">{getString("account_add_account")}</span>
            <span className="mt-0.5 block truncate text-xs text-chrome-neutral-400">
              {getString("account_add_account_subtitle")}
            </span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={openAccountSettings}
          className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <Settings className="h-5 w-5 shrink-0 text-chrome-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-chrome-neutral-200">{getString("account_menu_settings")}</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={doSignOut}
          className="flex w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <LogOut className="h-5 w-5 shrink-0 text-chrome-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-chrome-red-400">{getString("account_sign_out")}</span>
            <span className="mt-0.5 block truncate text-xs text-chrome-neutral-400">
              {getString("account_sign_out_subtitle")}
            </span>
          </span>
        </button>
      </div>
    </AnchoredPortalMenu>
  );
}

/**
 * Photo when present, else the first letter of the real display name —
 * never a placeholder initial. With no name at all, a plain user icon:
 * the account is signed in, just not identified yet.
 */
function AccountAvatar({ account, size }: { account: GoogleAccountInfo | null; size: string }) {
  const displayName = googleAccountDisplayName(account);
  if (account?.thumbnailUrl) {
    return (
      <img src={account.thumbnailUrl} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    );
  }
  if (displayName) {
    return (
      <span
        className={`grid ${size} shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-[var(--color-on-primary)]`}
      >
        {googleAccountInitial(account)}
      </span>
    );
  }
  return <CircleUserRound className={`${size} shrink-0 text-chrome-neutral-400`} />;
}
