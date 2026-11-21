import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, type Transition } from "framer-motion";
import { Button } from "./ui/Button";
import { getString } from "../lib/i18n/index";
import { useGoogleAccount } from "../lib/useGoogleAccount";

const SURFACE_SPRING: Transition = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 };

interface GoogleSignInDialogProps {
  onClose: () => void;
  /**
   * "add-account" opens the same sign-in while signed in: the captured
   * session joins the saved accounts instead of replacing the current
   * one. Defaults to a first sign-in.
   */
  mode?: "sign-in" | "add-account";
}

/**
 * The sign-in dialog, mirroring the CMP app's `SignInDialog` (which mirrors
 * the YouGlideTube mobile app): sign in with Google in a browser window.
 * The account itself lives in Settings → Google account (Android's
 * `AccountScreen.kt`); this dialog is only the sign-in entry point. The
 * dialog closes itself once the session is captured — but only after a
 * sign-in was attempted here, since in add-account mode the status is
 * already signed-in when it opens.
 *
 * Rendered into document.body: the top bar's glass backdrop-filter makes
 * its header the containing block for position:fixed descendants, so an
 * inline dialog would centre on the 56px header instead of the viewport.
 */
export function GoogleSignInDialog({ onClose, mode = "sign-in" }: GoogleSignInDialogProps) {
  const { status, error, startSignIn, startAddAccount, cancelSignIn } = useGoogleAccount();
  const [attempted, setAttempted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const signingIn = status === "signing-in";

  /**
   * Dismissing the dialog cancels the login window too, so it does not
   * keep polling behind the closed dialog. Only while a WebView sign-in
   * is actually in progress — a plain dismissal has no window to close.
   */
  const handleClose = useCallback(() => {
    if (signingIn) void cancelSignIn();
    onClose();
  }, [signingIn, cancelSignIn, onClose]);

  useEffect(() => {
    if (attempted && status === "signed-in") onClose();
  }, [attempted, status, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const buttons = [...(cardRef.current?.querySelectorAll("button") ?? [])];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.shiftKey ? buttons.length - 1 : 1;
        buttons[(current + step) % buttons.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleClose]);

  const startWebViewSignIn = () => {
    setAttempted(true);
    void (mode === "add-account" ? startAddAccount() : startSignIn());
  };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-chrome-black/70 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={handleClose}
      role="presentation"
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-dialog-title"
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={SURFACE_SPRING}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container"
      >
        <div className="max-h-[80vh] overflow-y-auto p-6">
          <h2 id="sign-in-dialog-title" className="text-lg font-bold text-chrome-neutral-100">
            {getString("sign_in")}
          </h2>

          <h3 className="mt-5 text-sm font-semibold text-chrome-neutral-200">
            {getString("sign_in_option_webview")}
          </h3>
          <p className="mt-1 text-sm text-chrome-neutral-400">
            {getString("sign_in_option_webview_desc")}
          </p>
          <div className="mt-3">
            <Button onClick={startWebViewSignIn} disabled={signingIn}>
              {getString(signingIn ? "sign_in_waiting" : "sign_in_with_google")}
            </Button>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-chrome-red-400">
              {error}
            </p>
          )}

          <p className="mt-5 text-xs text-chrome-neutral-400">{getString("sign_in_note")}</p>

          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={handleClose}>
              {getString("sign_in_close")}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
