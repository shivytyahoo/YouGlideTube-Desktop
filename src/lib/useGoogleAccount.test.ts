import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "./api/account";
import {
  GOOGLE_ACCOUNT_SWITCHED_EVENT,
  GOOGLE_SIGN_IN_CANCELLED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
  GOOGLE_SIGN_IN_FAILED_EVENT,
  accountRowLabel,
  accountSummaryToInfo,
  googleAccountDisplayName,
  googleAccountInitial,
  invokeErrorMessage,
  useGoogleAccount,
} from "./useGoogleAccount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.fn();
const listen = vi.fn();
const unlisten = vi.fn();
const listAccounts = vi.fn();
const addAccount = vi.fn();
const refreshHomeFeed = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("./api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/account")>()),
  listAccounts: (...args: unknown[]) => listAccounts(...args),
  addAccount: (...args: unknown[]) => addAccount(...args),
  switchAccount: vi.fn(),
  removeAccount: vi.fn(),
}));
vi.mock("./api/homeFeed", () => ({
  refreshHomeFeed: (...args: unknown[]) => refreshHomeFeed(...args),
}));

describe("useGoogleAccount", () => {
  it("names the backend sign-in events", () => {
    expect(GOOGLE_SIGN_IN_COMPLETED_EVENT).toBe("google-sign-in-completed");
    expect(GOOGLE_SIGN_IN_FAILED_EVENT).toBe("google-sign-in-failed");
    expect(GOOGLE_SIGN_IN_CANCELLED_EVENT).toBe("google-sign-in-cancelled");
    expect(GOOGLE_ACCOUNT_SWITCHED_EVENT).toBe("google-account-switched");
  });

  it("reads the backend ErrorResponse message", () => {
    expect(invokeErrorMessage({ message: "No signed-in session", kind: "validation" })).toBe(
      "No signed-in session",
    );
  });

  it("falls back to the Error message", () => {
    expect(invokeErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to a generic message for anything else", () => {
    expect(invokeErrorMessage("weird")).toBe("Sign-in failed");
    expect(invokeErrorMessage(undefined)).toBe("Sign-in failed");
  });

  it("prefers the name, then the handle, then the email as the display name", () => {
    expect(googleAccountDisplayName(null)).toBeNull();
    expect(googleAccountDisplayName({})).toBeNull();
    expect(googleAccountDisplayName({ email: "a@example.com" })).toBe("a@example.com");
    expect(googleAccountDisplayName({ email: "a@example.com", channelHandle: "@shivyt" })).toBe("@shivyt");
    expect(googleAccountDisplayName({ name: "Shivam", channelHandle: "@shivyt" })).toBe("Shivam");
  });

  it("labels a saved account by name, handle, email — or its short id, never a generic label", () => {
    const base: AccountSummary = {
      id: "abcdef1234567890",
      name: null,
      email: null,
      channelHandle: null,
      thumbnailUrl: null,
      isActive: false,
    };
    expect(accountRowLabel({ ...base, name: "Shivam" })).toBe("Shivam");
    expect(accountRowLabel({ ...base, channelHandle: "@shivyt" })).toBe("@shivyt");
    expect(accountRowLabel({ ...base, email: "shivam@example.com" })).toBe("shivam@example.com");
    expect(accountRowLabel(base)).toBe("Account abcdef12");
  });

  it("takes the avatar initial from the display name, 'Y' until known", () => {
    expect(googleAccountInitial(null)).toBe("Y");
    expect(googleAccountInitial({})).toBe("Y");
    expect(googleAccountInitial({ email: "shivam@example.com" })).toBe("S");
    expect(googleAccountInitial({ channelHandle: "@shivyt" })).toBe("@");
    expect(googleAccountInitial({ name: "shivam" })).toBe("S");
  });

  it("maps a listed saved account to the display identity", () => {
    expect(accountSummaryToInfo(null)).toBeNull();
    expect(
      accountSummaryToInfo({
        id: "abc",
        name: "Shivam",
        email: "shivam@example.com",
        channelHandle: "@shivyt",
        thumbnailUrl: "https://example.com/photo.jpg",
        isActive: true,
      }),
    ).toEqual({
      name: "Shivam",
      email: "shivam@example.com",
      channelHandle: "@shivyt",
      thumbnailUrl: "https://example.com/photo.jpg",
    });
    // An account whose identity never arrived maps to empty fields.
    expect(
      accountSummaryToInfo({
        id: "abc",
        name: null,
        email: null,
        channelHandle: null,
        thumbnailUrl: null,
        isActive: false,
      }),
    ).toEqual({ name: null, email: null, channelHandle: null, thumbnailUrl: null });
  });

  it("reads the display name off a saved account summary", () => {
    const named: AccountSummary = {
      id: "abc",
      name: "Shivam",
      email: "shivam@example.com",
      channelHandle: "@shivyt",
      thumbnailUrl: null,
      isActive: true,
    };
    expect(googleAccountDisplayName(named)).toBe("Shivam");
    const handleOnly: AccountSummary = {
      id: "abc",
      name: null,
      email: null,
      channelHandle: "@shivyt",
      thumbnailUrl: null,
      isActive: false,
    };
    expect(googleAccountDisplayName(handleOnly)).toBe("@shivyt");
  });
});

/**
 * The sign-in lifecycle: cancelling or failing an Add-account while a
 * session exists must re-read the real status instead of claiming
 * signed-out, and pressing Sign in with a live session must not
 * dead-end on "waiting".
 */
describe("useGoogleAccount sign-in lifecycle", () => {
  let signedInFlag = false;
  let signOutFails = false;
  let latest: ReturnType<typeof useGoogleAccount>;
  let root: Root;
  let host: HTMLDivElement;
  const handlers: Record<string, (event: { payload?: unknown }) => void> = {};

  function Harness() {
    latest = useGoogleAccount();
    return null;
  }

  async function renderHook() {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await vi.waitFor(() => expect(handlers[GOOGLE_SIGN_IN_CANCELLED_EVENT]).toBeDefined());
  }

  async function renderSignedIn() {
    signedInFlag = true;
    await renderHook();
    await vi.waitFor(() => expect(latest.status).toBe("signed-in"));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    signedInFlag = false;
    signOutFails = false;
    for (const key of Object.keys(handlers)) delete handlers[key];
    listAccounts.mockResolvedValue([]);
    addAccount.mockResolvedValue(undefined);
    refreshHomeFeed.mockResolvedValue(undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "get_auth_status") {
        return Promise.resolve({ signedIn: signedInFlag, account: { name: "Shivam" } });
      }
      if (command === "sign_out" && signOutFails) {
        return Promise.reject(new Error("sign-out refused"));
      }
      return Promise.resolve(undefined);
    });
    listen.mockImplementation((event: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[event] = handler;
      return Promise.resolve(unlisten);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("re-reads the real status when Add-account is cancelled while signed in", async () => {
    await renderSignedIn();
    await act(async () => {
      await latest.startAddAccount();
    });
    expect(latest.status).toBe("signing-in");
    await act(async () => {
      handlers[GOOGLE_SIGN_IN_CANCELLED_EVENT]?.({});
    });
    expect(latest.status).toBe("signed-in");
  });

  it("re-reads the real status and keeps the error when a sign-in fails while signed in", async () => {
    await renderSignedIn();
    await act(async () => {
      await latest.startAddAccount();
    });
    expect(latest.status).toBe("signing-in");
    await act(async () => {
      handlers[GOOGLE_SIGN_IN_FAILED_EVENT]?.({ payload: "The window closed early" });
    });
    expect(latest.status).toBe("signed-in");
    expect(latest.error).toBe("The window closed early");
  });

  it("still reads signed-out when a first sign-in is cancelled with no session", async () => {
    await renderHook();
    await act(async () => {
      await latest.startSignIn();
    });
    expect(latest.status).toBe("signing-in");
    await act(async () => {
      handlers[GOOGLE_SIGN_IN_CANCELLED_EVENT]?.({});
    });
    expect(latest.status).toBe("signed-out");
  });

  it("does not dead-end when Sign in is pressed while a session already exists", async () => {
    await renderSignedIn();
    invoke.mockClear();
    await act(async () => {
      await latest.startSignIn();
    });
    expect(invoke).not.toHaveBeenCalledWith("start_google_sign_in");
    expect(latest.status).toBe("signed-in");
  });

  it("cancelSignIn closes the login window", async () => {
    await renderHook();
    invoke.mockClear();
    await act(async () => {
      await latest.cancelSignIn();
    });
    expect(invoke).toHaveBeenCalledWith("cancel_google_sign_in");
  });

  it("signOut reports success, and failure when the backend refuses", async () => {
    await renderSignedIn();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await latest.signOut();
    });
    expect(ok).toBe(true);
    expect(latest.status).toBe("signed-in");

    signOutFails = true;
    await act(async () => {
      ok = await latest.signOut();
    });
    expect(ok).toBe(false);
    expect(latest.error).toBe("sign-out refused");
  });
});
