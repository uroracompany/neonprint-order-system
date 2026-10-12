import { beforeEach, describe, expect, it, vi } from "vitest";

const getFreshAccessTokenMock = vi.hoisted(() => vi.fn());
const expireAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/authManager", () => ({
  getFreshAccessToken: getFreshAccessTokenMock,
  expireAuthSession: expireAuthSessionMock,
  isInvalidRefreshTokenError: (error) => /invalid refresh token/i.test(String(error?.message || "")),
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
    expect(getFreshAccessTokenMock).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      rejectedAccessToken: "old-token",
    });
    expect(expireAuthSessionMock).not.toHaveBeenCalled();
  });

  it("coalesces a burst of late 401s and reuses one newly refreshed token", async () => {
    const requestCount = 12;
    const earlyResponses = Array.from({ length: requestCount / 2 }, () => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    });
    const lateResponses = Array.from({ length: requestCount / 2 }, () => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    });
    const refreshGate = (() => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return { promise, resolve };
    })();
    const initialResponseGates = [...earlyResponses, ...lateResponses];
    let currentToken = "old-token";
    let refreshCalls = 0;
    let fetchCalls = 0;
    let refreshInFlight = null;

    getFreshAccessTokenMock.mockImplementation(async (options = {}) => {
      if (!options.forceRefresh) return currentToken;
      if (currentToken !== options.rejectedAccessToken) return currentToken;
      if (!refreshInFlight) {
        refreshCalls += 1;
        refreshInFlight = refreshGate.promise.then(() => {
          currentToken = "new-token";
          refreshInFlight = null;
          return currentToken;
        });
      }
      return refreshInFlight;
    });
    globalThis.fetch.mockImplementation(async (path) => {
      const callIndex = fetchCalls++;
      if (callIndex < requestCount) return initialResponseGates[callIndex].promise;
      return makeResponse(200, { ok: true, path });
    });

    const { adminApiFetch } = await loadAdminApi();
    const requests = Array.from({ length: requestCount }, (_, index) => (
      adminApiFetch(`/api/order/${index}`, { action: "read" })
    ));
    await vi.waitFor(() => expect(fetchCalls).toBe(requestCount));

    earlyResponses.forEach(({ resolve }) => resolve(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" })));
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    refreshGate.resolve();
    await vi.waitFor(() => expect(fetchCalls).toBe(requestCount + earlyResponses.length));

    // These original-token failures arrive only after the first refresh has
    // completed; they must reuse new-token without rotating it again.
    lateResponses.forEach(({ resolve }) => resolve(makeResponse(401, { code: "SESSION_EXPIRED", error: "expired" })));

    const results = await Promise.all(requests);
    expect(results.every(({ response }) => response.status === 200)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(fetchCalls).toBe(requestCount * 2);
    expect(expireAuthSessionMock).not.toHaveBeenCalled();
  });

  it("expires the local session after the single retry also returns 401", async () => {
    getFreshAccessTokenMock
      .mockResolvedValueOnce("old-token")
      .mockResolvedValueOnce("new-token")
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
