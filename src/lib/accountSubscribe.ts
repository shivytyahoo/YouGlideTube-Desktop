import { listen } from "@tauri-apps/api/event";
import { getAccountSignedIn, setChannelSubscribed } from "./api/account";
import { confirmAction } from "./dialogs";
import { getString } from "./i18n/index";
import { GOOGLE_SIGN_IN_COMPLETED_EVENT } from "./useGoogleAccount";
import { useUiStore } from "../store/useUiStore";
import {
  useSubscriptionStore,
  type UnsubscribedChannel,
} from "../store/useSubscriptionStore";

/**
 * The subscribe/unsubscribe path every button in the app shares
 * (video cards, the channel Subscribe button, Shorts, the Subscriptions
 * manage view).
 *
 * Signed in, the server is the source of truth: the local subscription
 * is written first (with the real channel name, so the backend's
 * fallback-cache update keeps it instead of storing ""), then the
 * server call confirms it; a failed server call rolls the local write
 * back rather than leaving UI and server out of sync.
 *
 * Signed out, subscribing is gated on Android's sign-in dialog: the
 * gate offers Sign in, and a confirmed sign-in finishes the subscribe
 * once the session lands. Unsubscribing while signed out just removes
 * the local subscription, as before.
 */

function showSubscribeFailed() {
  useUiStore.getState().showToast({
    variant: "error",
    message: getString("account_subscribe_failed"),
  });
}

interface PendingSubscribe {
  channelId: string;
  channelName: string;
  avatarUrl?: string;
}

let pendingSubscribe: PendingSubscribe | null = null;
let signInListenerInstalled = false;

async function flushPendingSubscribe() {
  const pending = pendingSubscribe;
  pendingSubscribe = null;
  if (!pending) return;
  const store = useSubscriptionStore.getState();
  await store.subscribe(pending.channelId, pending.channelName, pending.avatarUrl, { learn: true });
  try {
    await setChannelSubscribed(pending.channelId, true);
  } catch {
    await store.unsubscribe(pending.channelId, { learn: true });
    showSubscribeFailed();
  }
}

function ensureSignInListener() {
  if (signInListenerInstalled) return;
  signInListenerInstalled = true;
  listen(GOOGLE_SIGN_IN_COMPLETED_EVENT, () => {
    void flushPendingSubscribe();
  }).catch(() => {
    // No Tauri event bridge (e.g. jsdom tests): the pending subscribe
    // simply never fires.
    signInListenerInstalled = false;
  });
}

/** True when the subscription state changed. */
export async function toggleSubscription(
  channelId: string,
  channelName: string,
  avatarUrl?: string,
): Promise<boolean> {
  const signedIn = await getAccountSignedIn();
  const store = useSubscriptionStore.getState();
  const active = store.isSubscribed(channelId);

  if (!signedIn && !active) {
    const go = await confirmAction({
      title: getString("sign_in_to_subscribe_title"),
      message: getString("sign_in_to_subscribe_message"),
      confirmLabel: getString("sign_in"),
    });
    if (!go) return false;
    pendingSubscribe = { channelId, channelName, avatarUrl };
    ensureSignInListener();
    useUiStore.getState().openSignInDialog();
    return false;
  }

  if (active) {
    const removed = await store.unsubscribe(channelId, { learn: true });
    if (!signedIn) return true;
    try {
      await setChannelSubscribed(channelId, false);
      return true;
    } catch {
      if (removed) await store.restoreSubscription(removed, { learn: true });
      showSubscribeFailed();
      return false;
    }
  }

  await store.subscribe(channelId, channelName, avatarUrl, { learn: true });
  if (!signedIn) return true;
  try {
    await setChannelSubscribed(channelId, true);
    return true;
  } catch {
    await store.unsubscribe(channelId, { learn: true });
    showSubscribeFailed();
    return false;
  }
}

/**
 * Unsubscribes, through the server when signed in. Returns what was
 * removed, so the caller can offer Undo; null when nothing changed or
 * the server refused (the local state was rolled back).
 */
export async function unsubscribeChannel(
  channelId: string,
): Promise<UnsubscribedChannel | null> {
  const signedIn = await getAccountSignedIn();
  const store = useSubscriptionStore.getState();
  const removed = await store.unsubscribe(channelId, { learn: true });
  if (!removed || !signedIn) return removed;
  try {
    await setChannelSubscribed(channelId, false);
    return removed;
  } catch {
    await store.restoreSubscription(removed, { learn: true });
    showSubscribeFailed();
    return null;
  }
}

/** Undoes an unsubscribe, through the server when signed in. */
export async function restoreSubscription(removed: UnsubscribedChannel): Promise<void> {
  const signedIn = await getAccountSignedIn();
  const store = useSubscriptionStore.getState();
  await store.restoreSubscription(removed, { learn: true });
  if (!signedIn) return;
  try {
    await setChannelSubscribed(removed.channel.id, true);
  } catch {
    await store.unsubscribe(removed.channel.id, { learn: true });
    showSubscribeFailed();
  }
}
