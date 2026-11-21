import { describe, expect, it } from "vitest";
import {
  GOOGLE_SIGN_IN_CANCELLED_EVENT,
  GOOGLE_SIGN_IN_COMPLETED_EVENT,
  GOOGLE_SIGN_IN_FAILED_EVENT,
  googleAccountDisplayName,
  googleAccountInitial,
  invokeErrorMessage,
} from "./useGoogleAccount";

describe("useGoogleAccount", () => {
  it("names the backend sign-in events", () => {
    expect(GOOGLE_SIGN_IN_COMPLETED_EVENT).toBe("google-sign-in-completed");
    expect(GOOGLE_SIGN_IN_FAILED_EVENT).toBe("google-sign-in-failed");
    expect(GOOGLE_SIGN_IN_CANCELLED_EVENT).toBe("google-sign-in-cancelled");
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
});
