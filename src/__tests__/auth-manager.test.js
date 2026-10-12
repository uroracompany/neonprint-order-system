import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));
const clearAuthSessionStorageMock = vi.hoisted(() => vi.fn());

vi.mock("../../supabaseClient", () => ({
  clearAuthSessionStorage: clearAuthSessionStorageMock,
  isAuthSessionPersistenceEnabled: vi.fn(() => false),
  setAuthSessionPersistence: vi.fn(),
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

afterEach(() => {
  vi.useRealTimers();
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
    expect(authMock.getSession).toHaveBeenCalledTimes(2);
  });

  it("deduplica refresh explícitos y reutiliza el token tras un 401 tardío", async () => {
    let session = makeSession({ access_token: "old-token" });
    const refreshRequest = deferred();
    authMock.getSession.mockImplementation(async () => ({ data: { session }, error: null }));
    authMock.refreshSession.mockReturnValue(refreshRequest.promise);

    const manager = await loadManager();
    const refreshes = Array.from({ length: 8 }, () => manager.getFreshAccessToken({
      forceRefresh: true,
      rejectedAccessToken: "old-token",
    }));
    await vi.waitFor(() => expect(authMock.refreshSession).toHaveBeenCalledTimes(1));
    session = makeSession({ access_token: "latest-token" });
    refreshRequest.resolve({ data: { session }, error: null });
    await expect(Promise.all(refreshes)).resolves.toEqual(Array(8).fill("latest-token"));

    // A 401 that arrives after the shared refresh completed reuses the newer
    // session instead of consuming its refresh token again.
    await expect(manager.getFreshAccessToken({
      forceRefresh: true,
      rejectedAccessToken: "old-token",
    })).resolves.toBe("latest-token");
    expect(authMock.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("no cierra una sesión válida cuando Supabase responde 429 y aplica backoff", async () => {
    vi.useFakeTimers();
    const session = makeSession({ expires_at: Math.floor(Date.now() / 1000) + 30 });
    authMock.getSession.mockResolvedValue({ data: { session }, error: null });
    authMock.refreshSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error("Too Many Requests"), { status: 429, code: "over_request_rate_limit" }),
    });
    authMock.signOut.mockResolvedValue({ error: null });

    const manager = await loadManager();
    await expect(manager.maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true }))
      .rejects.toMatchObject({ status: 429 });

    expect(authMock.signOut).not.toHaveBeenCalled();
    await expect(manager.maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true }))
      .rejects.toMatchObject({ status: 429 });
    expect(authMock.refreshSession).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

    await expect(manager.getFreshAccessToken()).rejects.toThrow("Tu sesión expiró");
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
    expect(clearAuthSessionStorageMock).toHaveBeenCalledTimes(1);
    expect(authMock.getSession).toHaveBeenCalledTimes(2);
  });

  it("no borra otras pestañas al limpiar una sesión local", async () => {
    authMock.signOut.mockResolvedValue({ error: null });
    const manager = await loadManager();

    await manager.signOutAuth({ scope: "local" });

    expect(authMock.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(clearAuthSessionStorageMock).not.toHaveBeenCalled();
  });

  it("no inicia timers propios y deja la renovación programada al cliente de Supabase", async () => {
    vi.useFakeTimers();
    authMock.getSession.mockResolvedValue({ data: { session: makeSession() }, error: null });
    const manager = await loadManager();
    await manager.getAuthSession();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(authMock.refreshSession).not.toHaveBeenCalled();
  });

  it("invalidates locally when the refresh token is invalid", async () => {
    authMock.getSession.mockResolvedValue({
      data: { session: makeSession({ expires_at: Math.floor(Date.now() / 1000) + 10 }) },
      error: null,
    });
    authMock.refreshSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { code: "refresh_token_not_found", status: 400 }),
    });
    authMock.signOut.mockResolvedValue({ error: null });

    const manager = await loadManager();
    const listener = vi.fn();
    manager.subscribeToAuthInvalidation(listener);

    await expect(manager.maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true }))
      .rejects.toThrow("Invalid Refresh Token");

    expect(authMock.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(listener).toHaveBeenCalledWith({ notice: "SESSION_EXPIRED" });
  });

  it("coalesces concurrent automatic session invalidations", async () => {
    const signOutRequest = deferred();
    authMock.signOut.mockReturnValue(signOutRequest.promise);

    const manager = await loadManager();
    const listener = vi.fn();
    manager.subscribeToAuthInvalidation(listener);

    const attempts = [manager.expireAuthSession(), manager.expireAuthSession(), manager.expireAuthSession()];
    await vi.waitFor(() => {
      expect(authMock.signOut).toHaveBeenCalledTimes(1);
    });
    signOutRequest.resolve({ error: null });

    await Promise.all(attempts);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
