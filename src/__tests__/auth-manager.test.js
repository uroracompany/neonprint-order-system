import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    auth: authMock,
  },
}));

const makeSession = (overrides = {}) => ({
  access_token: "access-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "user-1" },
  ...overrides,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const loadManager = async () => {
  vi.resetModules();
  const manager = await import("../utils/authManager.js");
  manager.__resetAuthManagerForTests();
  return manager;
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("authManager", () => {
  it("deduplica llamadas concurrentes a getFreshAccessToken", async () => {
    const sessionRequest = deferred();
    authMock.getSession.mockReturnValue(sessionRequest.promise);

    const manager = await loadManager();
    const requests = Array.from({ length: 10 }, () => manager.getFreshAccessToken());

    await vi.waitFor(() => {
      expect(authMock.getSession).toHaveBeenCalledTimes(1);
    });

    sessionRequest.resolve({ data: { session: makeSession() }, error: null });

    await expect(Promise.all(requests)).resolves.toEqual(Array(10).fill("access-token"));
    expect(authMock.refreshSession).not.toHaveBeenCalled();
  });

  it("serializa refreshSession cuando la sesión está cerca de expirar", async () => {
    const refreshRequest = deferred();
    authMock.getSession.mockResolvedValue({
      data: { session: makeSession({ access_token: "old-token", expires_at: Math.floor(Date.now() / 1000) + 10 }) },
      error: null,
    });
    authMock.refreshSession.mockReturnValue(refreshRequest.promise);

    const manager = await loadManager();
    const requests = Array.from({ length: 10 }, () => manager.getFreshAccessToken());

    await vi.waitFor(() => {
      expect(authMock.refreshSession).toHaveBeenCalledTimes(1);
    });

    refreshRequest.resolve({ data: { session: makeSession({ access_token: "new-token" }) }, error: null });

    await expect(Promise.all(requests)).resolves.toEqual(Array(10).fill("new-token"));
    expect(authMock.getSession).toHaveBeenCalledTimes(1);
  });

  it("limpia la caché de sesión al cerrar sesión", async () => {
    authMock.getSession
      .mockResolvedValueOnce({ data: { session: makeSession() }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    authMock.signOut.mockResolvedValue({ error: null });

    const manager = await loadManager();

    await expect(manager.getFreshAccessToken()).resolves.toBe("access-token");
    expect(authMock.getSession).toHaveBeenCalledTimes(1);

    await manager.signOutAuth();

    await expect(manager.getFreshAccessToken()).rejects.toThrow("Tu sesion expiro");
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
    expect(authMock.getSession).toHaveBeenCalledTimes(2);
  });
});
