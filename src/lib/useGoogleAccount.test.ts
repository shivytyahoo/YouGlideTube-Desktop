import { describe, expect, it } from "vitest";
import type { AccountSummary } from "./api/account";
import {
  GOOGLE_ACCOUNT_SWITCHED_EVENT,
  GOOGLE_SIGN_IN_CANCELLED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
  GOOGLE_SIGN_IN_FAILED_EVENT,
  accountSummaryToInfo,
  googleAccountDisplayName,
  googleAccountInitial,
  invokeErrorMessage,
} from "./useGoogleAccount";

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
