import { beforeEach, describe, expect, it, vi } from "vitest";

const getFreshAccessTokenMock = vi.hoisted(() => vi.fn());
const expireAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/authManager", () => ({
  getFreshAccessToken: getFreshAccessTokenMock,
  expireAuthSession: expireAuthSessionMock,
}));

const makeResponse = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 401 ? "Unauthorized" : "Error",
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

const loadAdminApi = async () => {
  vi.resetModules();
  return import("../utils/adminApi.js");
};

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = vi.fn();
  expireAuthSessionMock.mockResolvedValue(undefined);
});

describe("adminApiFetch authentication failures", () => {
  it("refreshes and retries once after a structured expired-session 401", async () => {
    getFreshAccessTokenMock
      .mockResolvedValueOnce("old-token")
      .mockResolvedValueOnce("new-token");
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { adminApiFetch } = await loadAdminApi();
    const { response, result } = await adminApiFetch("/api/admin", { action: "list-orders" });

    expect(response.status).toBe(200);
    expect(result).toEqual({ ok: true });
    expect(getFreshAccessTokenMock).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(expireAuthSessionMock).not.toHaveBeenCalled();
  });

  it("expires the local session after the single retry also returns 401", async () => {
    getFreshAccessTokenMock
      .mockResolvedValueOnce("old-token")
      .mockResolvedValueOnce("new-token");
    globalThis.fetch
      .mockResolvedValueOnce(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" }))
      .mockResolvedValueOnce(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" }));

    const { adminApiFetch } = await loadAdminApi();
    const { response, result } = await adminApiFetch("/api/admin", { action: "list-orders" });

    expect(response.status).toBe(401);
    expect(result.code).toBe("SESSION_EXPIRED");
    expect(expireAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("expires only once when the forced refresh itself fails", async () => {
    getFreshAccessTokenMock
      .mockResolvedValueOnce("old-token")
      .mockRejectedValueOnce(new Error("invalid refresh token"));
    globalThis.fetch.mockResolvedValueOnce(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" }));

    const { adminApiFetch } = await loadAdminApi();
    const { response, result } = await adminApiFetch("/api/admin", { action: "list-orders" });

    expect(response.status).toBe(401);
    expect(result.code).toBe("SESSION_EXPIRED");
    expect(expireAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 500])("does not sign out for HTTP %i", async (status) => {
    getFreshAccessTokenMock.mockResolvedValue("current-token");
    globalThis.fetch.mockResolvedValue(makeResponse(status, { code: status === 403 ? "FORBIDDEN" : "INTERNAL" }));

    const { adminApiFetch } = await loadAdminApi();
    const { response } = await adminApiFetch("/api/admin", { action: "list-orders" });

    expect(response.status).toBe(status);
    expect(expireAuthSessionMock).not.toHaveBeenCalled();
  });
});
