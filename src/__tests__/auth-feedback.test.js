import { describe, expect, it } from "vitest";
import { AUTH_NOTICE, getAuthFeedbackMessage, getLoginErrorCode } from "../utils/authFeedback";

describe("auth feedback", () => {
  it("maps throttling to a temporary message without exposing provider details", () => {
    const error = Object.assign(new Error("Too Many Requests: refresh_token leaked detail"), { status: 429 });

    expect(getLoginErrorCode(error)).toBe(AUTH_NOTICE.RATE_LIMITED);
    expect(getAuthFeedbackMessage(getLoginErrorCode(error))).toMatch(/temporalmente ocupado/i);
    expect(getAuthFeedbackMessage(getLoginErrorCode(error))).not.toMatch(/refresh_token|429/i);
  });

  it("keeps password-grant errors generic", () => {
    expect(getAuthFeedbackMessage(getLoginErrorCode({ status: 400, message: "User does not exist" })))
      .toBe("Correo o contraseña incorrectos.");
  });
});
