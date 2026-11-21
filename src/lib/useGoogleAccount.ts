import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { refreshHomeFeed } from "./api/homeFeed";
import {
  addAccount,
  listAccounts,
  removeAccount as removeAccountApi,
  switchAccount as switchAccountApi,
  type AccountSummary,
} from "./api/account";

/** Emitted by the backend when the login window captured a session. */
export const GOOGLE_SIGN_IN_COMPLETED_EVENT = "google-sign-in-completed";
/** Emitted when capturing failed; payload is the human-readable message. */
export const GOOGLE_SIGN_IN_FAILED_EVENT = "google-sign-in-failed";
/** Emitted when the login window was closed before any session was captured. */
export const GOOGLE_SIGN_IN_CANCELLED_EVENT = "google-sign-in-cancelled";
/**
 * Emitted by the backend when the active account changes — a switch, a
 * sign-out that leaves another account active, or a removal. Payload is
 * the new active account, or null when the app is a guest again.
 */
export const GOOGLE_ACCOUNT_SWITCHED_EVENT = "google-account-switched";

export type GoogleAccountStatus = "signed-out" | "signing-in" | "signed-in";

/**
 * The signed-in account as `account/account_menu` reports it (Android's
 * `YouTube.accountInfo()`): display name, email, channel handle, photo.
 * Everything optional — the menu answers without an account when signed out.
 */
export interface GoogleAccountInfo {
  name?: string | null;
  email?: string | null;
  channelHandle?: string | null;
  thumbnailUrl?: string | null;
}

/** Android's `SavedAccount.displayName`: name, else handle, else email. */
export function googleAccountDisplayName(account: GoogleAccountInfo | null): string | null {
  return account?.name ?? account?.channelHandle ?? account?.email ?? null;
}

/** A listed saved account as the display identity the top bar shows. */
export function accountSummaryToInfo(summary: AccountSummary | null): GoogleAccountInfo | null {
  if (!summary) return null;
  return {
    name: summary.name ?? null,
    email: summary.email ?? null,
    channelHandle: summary.channelHandle ?? null,
    thumbnailUrl: summary.thumbnailUrl ?? null,
  };
}

/** First letter of the display name for the avatar circle; "Y" until known. */
export function googleAccountInitial(account: GoogleAccountInfo | null): string {
  const first = googleAccountDisplayName(account)?.trim().charAt(0);
  return first ? first.toUpperCase() : "Y";
}

/**
 * The message of a failed `invoke`, which rejects with the backend's
 * `ErrorResponse` (`{ message, kind }`) rather than an `Error`.
 */
export function invokeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return error instanceof Error ? error.message : "Sign-in failed";
}

/**
 * The Google account state, shared by the top bar button and the Settings
 * account tab. The backend owns the sessions; this hook only mirrors them
 * and reloads the home feed when sign-in changes what the server returns.
 */
export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleAccountStatus>("signed-out");
  const [account, setAccount] = useState<GoogleAccountInfo | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Live fetch of the display identity; best-effort, keeps the cached one on failure. */
  const refreshAccount = useCallback(async () => {
    try {
      const info = await invoke<GoogleAccountInfo>("get_account_info");
      setAccount(info);
    } catch {
      // Signed out, expired session, or offline: keep the cached identity
      // from get_auth_status (or none) rather than clearing the avatar.
    }
  }, []);

  /** The saved accounts list; best-effort, keeps the last list on failure. */
  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch {
      // Backend unavailable: keep the last known list.
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const { signedIn, account: cached } = await invoke<{
        signedIn: boolean;
        account?: GoogleAccountInfo;
      }>("get_auth_status");
      setStatus(signedIn ? "signed-in" : "signed-out");
      setAccount(cached ?? null);
      // First launch after sign-in: the cached identity may be absent
      // (signed in before this feature existed), so fetch it live once.
      if (signedIn && !cached) void refreshAccount();
    } catch {
      // Backend unavailable: keep the last known state.
    }
  }, [refreshAccount]);

  useEffect(() => {
    void refreshStatus();
    void refreshAccounts();
    let stops: Array<() => void> = [];
    let disposed = false;
    void (async () => {
      let listeners: Array<() => void>;
      try {
        listeners = await Promise.all([
          listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, () => {
            if (disposed) return;
            setStatus("signed-in");
            setError(null);
            // The feed is server-driven: reload it signed-in.
            void refreshHomeFeed().catch(() => undefined);
            void refreshAccount();
            void refreshAccounts();
          }),
          listen<AccountSummary | null>(GOOGLE_ACCOUNT_SWITCHED_EVENT, (event) => {
            if (disposed) return;
            setError(null);
            // The payload is the new active account, or null when the app
            // is a guest again; the live fetch below confirms it.
            if (event.payload) {
              setStatus("signed-in");
              setAccount(accountSummaryToInfo(event.payload));
            } else {
              setStatus("signed-out");
              setAccount(null);
            }
            void refreshStatus();
            void refreshAccounts();
            void refreshHomeFeed().catch(() => undefined);
            void refreshAccount();
          }),
          listen<string>(GOOGLE_SIGN_IN_FAILED_EVENT, (event) => {
            if (disposed) return;
            setStatus("signed-out");
            setError(event.payload || "Sign-in failed");
          }),
          listen(GOOGLE_SIGN_IN_CANCELLED_EVENT, () => {
            if (disposed) return;
            setStatus((current) => (current === "signing-in" ? "signed-out" : current));
          }),
        ]);
      } catch {
        // No Tauri event bridge (e.g. jsdom tests): the status still
        // refreshes from get_auth_status, just without live events.
        return;
      }
      if (disposed) {
        listeners.forEach((stop) => stop());
        return;
      }
      stops = listeners;
    })();
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [refreshStatus, refreshAccount, refreshAccounts]);

  /** Opens the Google sign-in window; the completed event flips the status. */
  const startSignIn = useCallback(async () => {
    setError(null);
    setStatus("signing-in");
    try {
      await invoke("start_google_sign_in");
    } catch (caught) {
      setStatus("signed-out");
      setError(invokeErrorMessage(caught));
    }
  }, []);

  /**
   * Opens the Google sign-in window to add another account. The captured
   * session joins the saved accounts and becomes active; the current
   * account stays saved. On failure the status is re-read — the current
   * account is still active.
   */
  const startAddAccount = useCallback(async () => {
    setError(null);
    setStatus("signing-in");
    try {
      await addAccount();
    } catch (caught) {
      setError(invokeErrorMessage(caught));
      void refreshStatus();
    }
  }, [refreshStatus]);

  /**
   * Makes a saved account the active one. The backend emits the switched
   * event, which reloads the server surfaces; this applies the new
   * account's identity immediately. Returns false (and sets `error`)
   * when the switch is refused, e.g. the session expired.
   */
  const switchAccount = useCallback(async (id: string) => {
    setError(null);
    try {
      const summary = await switchAccountApi(id);
      setAccount(accountSummaryToInfo(summary));
      setStatus("signed-in");
      void refreshAccounts();
      void refreshHomeFeed().catch(() => undefined);
      void refreshAccount();
      return true;
    } catch (caught) {
      setError(invokeErrorMessage(caught));
      return false;
    }
  }, [refreshAccount, refreshAccounts]);

  /**
   * Removes one saved account. Removing the active one activates the next
   * saved account, or signs out when none is left. Returns false (and
   * sets `error`) when the removal is refused.
   */
  const removeAccount = useCallback(async (id: string) => {
    setError(null);
    try {
      const next = await removeAccountApi(id);
      if (next) {
        setAccount(accountSummaryToInfo(next));
        setStatus("signed-in");
        void refreshAccount();
      } else {
        setAccount(null);
        setStatus("signed-out");
      }
      void refreshAccounts();
      void refreshHomeFeed().catch(() => undefined);
      return true;
    } catch (caught) {
      setError(invokeErrorMessage(caught));
      return false;
    }
  }, [refreshAccount, refreshAccounts]);

  /**
   * Signs out of the ACTIVE account. The next saved account (if any)
   * becomes active and the app stays signed in under it — the status is
   * re-read rather than assumed, so the top bar follows the new account.
   */
  const signOut = useCallback(async () => {
    try {
      await invoke("sign_out");
      setError(null);
      await refreshStatus();
      void refreshAccounts();
      void refreshHomeFeed().catch(() => undefined);
    } catch (caught) {
      setError(invokeErrorMessage(caught));
    }
  }, [refreshStatus, refreshAccounts]);

  /**
   * Advanced fallback: store a cookie header pasted by the user. Returns
   * false (and sets `error`) when the cookies prove no session.
   */
  const signInWithCookie = useCallback(async (cookieHeader: string) => {
    setError(null);
    try {
      await invoke("sign_in_with_cookie", { cookieHeader });
      setStatus("signed-in");
      void refreshHomeFeed().catch(() => undefined);
      void refreshAccount();
      return true;
    } catch (caught) {
      setError(invokeErrorMessage(caught));
      return false;
    }
  }, [refreshAccount]);

  return {
    status,
    account,
    accounts,
    error,
    startSignIn,
    startAddAccount,
    switchAccount,
    removeAccount,
    signOut,
    signInWithCookie,
    refreshAccount,
    refreshAccounts,
  };
}
