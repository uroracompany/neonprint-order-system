import { describe, expect, it } from "vitest";
import {
  AUTH_NOTICE,
  getApiErrorCode,
  getApiErrorMessage,
  getLoginErrorCode,
} from "../utils/authFeedback";

describe("auth feedback", () => {
  it("keeps authentication, authorization and technical errors separate", () => {
    expect(getApiErrorCode({ status: 401, result: { code: "SESSION_EXPIRED" } })).toBe(AUTH_NOTICE.SESSION_EXPIRED);
    expect(getApiErrorCode({ status: 403, result: { code: "FORBIDDEN" } })).toBe(AUTH_NOTICE.FORBIDDEN);
    expect(getApiErrorCode({ status: 403, result: { code: "PROFILE_UNAVAILABLE" } })).toBe(AUTH_NOTICE.PROFILE_UNAVAILABLE);
    expect(getApiErrorMessage({ status: 0, error: new Error("fetch failed") })).toMatch(/no pudimos conectarnos/i);
  });

  it("does not treat network or profile failures as invalid credentials", () => {
    expect(getLoginErrorCode(new Error("fetch failed"))).toBe(AUTH_NOTICE.NETWORK);
    expect(getLoginErrorCode({ code: "PROFILE_UNAVAILABLE" })).toBe(AUTH_NOTICE.PROFILE_UNAVAILABLE);
    expect(getLoginErrorCode({ status: 400, message: "Invalid login credentials" })).toBe(AUTH_NOTICE.INVALID_CREDENTIALS);
  });
});
