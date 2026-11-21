import { useEffect, useRef, useState } from "react";
import { motion, type Transition } from "framer-motion";
import { Button } from "./ui/Button";
import { getString } from "../lib/i18n/index";
import { useGoogleAccount } from "../lib/useGoogleAccount";

const SURFACE_SPRING: Transition = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 };

interface GoogleSignInDialogProps {
  onClose: () => void;
}

/**
 * The sign-in dialog, mirroring the CMP app's `SignInDialog` (which mirrors
 * the YouGlideTube mobile app): Option 1 signs in with Google in a browser
 * window, Option 2 pastes a cookie header. The account itself lives in
 * Settings → Google account (Android's `AccountScreen.kt`); this dialog
 * is only the sign-in entry point. The dialog closes itself once the
 * session is captured.
 */
export function GoogleSignInDialog({ onClose }: GoogleSignInDialogProps) {
  const { status, error, startSignIn, signInWithCookie } = useGoogleAccount();
  const [cookieText, setCookieText] = useState("");
  const [cookieWorking, setCookieWorking] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const signingIn = status === "signing-in";

  useEffect(() => {
    if (status === "signed-in") onClose();
  }, [status, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
  }, [onClose]);

  const saveCookie = async () => {
    if (!cookieText.trim()) return;
    setCookieWorking(true);
    await signInWithCookie(cookieText.trim());
    setCookieWorking(false);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-chrome-black/70 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
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
            <Button onClick={() => void startSignIn()} disabled={signingIn}>
              {getString(signingIn ? "sign_in_waiting" : "sign_in_with_google")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-chrome-neutral-400">
            {getString("sign_in_refused_note")}
          </p>

          <h3 className="mt-6 text-sm font-semibold text-chrome-neutral-200">
            {getString("sign_in_option_cookie")}
          </h3>
          <p className="mt-1 text-sm text-chrome-neutral-400">
            {getString("sign_in_option_cookie_desc")}
          </p>
          <textarea
            value={cookieText}
            onChange={(event) => setCookieText(event.target.value)}
            placeholder={getString("sign_in_cookie_placeholder")}
            rows={2}
            spellCheck={false}
            className="mt-3 w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 font-mono text-xs text-chrome-neutral-200 focus:outline-none"
          />
          <div className="mt-2">
            <Button
              onClick={() => void saveCookie()}
              disabled={cookieWorking || !cookieText.trim()}
            >
              {getString("sign_in_with_cookie")}
            </Button>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-chrome-red-400">
              {error}
            </p>
          )}

          <p className="mt-5 text-xs text-chrome-neutral-400">{getString("sign_in_note")}</p>

          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              {getString("sign_in_close")}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
