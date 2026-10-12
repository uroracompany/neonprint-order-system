import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn((url, key, options) => ({ url, key, options })));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

const loadClient = async () => {
  vi.resetModules();
  createClientMock.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("VITE_AUTH_SESSION_STORAGE_KEY", "np_auth_remember_test");
  return import("../../supabaseClient.js");
};

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase hybrid auth storage", () => {
  it("enables the Supabase SDK browser auto-refresh scheduler", async () => {
    await loadClient();

    expect(createClientMock.mock.calls[0][2].auth.autoRefreshToken).toBe(true);
  });

  it("queues the automatic refresh lock instead of failing immediately when it is busy", async () => {
    const originalLocks = navigator.locks;
    const request = vi.fn(async (name, options, callback) => {
      expect(name).toBe("lock:np-auth-session");
      expect(options.mode).toBe("exclusive");
      expect(options.ifAvailable).toBeUndefined();
      return callback({ name });
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    try {
      await loadClient();
      const lock = createClientMock.mock.calls[0][2].auth.lock;

      await expect(lock("lock:np-auth-session", 0, async () => "session-read"))
        .resolves.toBe("session-read");
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      if (originalLocks === undefined) {
        delete navigator.locks;
      } else {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: originalLocks,
        });
      }
    }
  });

  it("stores sessions in sessionStorage by default", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;

    storage.setItem("np-auth-session", "session-value");

    expect(window.sessionStorage.getItem("np-auth-session")).toBe("session-value");
    expect(window.localStorage.getItem("np-auth-session")).toBeNull();
    expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
  });

  it("keeps a remembered session and preference outside the current tab's session-only mode", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;

    client.setAuthSessionPersistence(true);
    window.localStorage.setItem("np-auth-session", "other-tab-session");
    client.setAuthSessionPersistence(false);
    storage.setItem("np-auth-session", "current-tab-session");

    expect(window.localStorage.getItem("np_auth_remember_test")).toBe("1");
    expect(window.localStorage.getItem("np-auth-session")).toBe("other-tab-session");
    expect(window.sessionStorage.getItem("np-auth-session")).toBe("current-tab-session");
    expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
  });

  it("preserves the prior remembered session after rejecting a temporary login locally", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;

    client.setAuthSessionPersistence(true);
    window.localStorage.setItem("np-auth-session", "remembered-session");
    client.setAuthSessionPersistence(false);
    storage.setItem("np-auth-session", "temporary-session");
    storage.removeItem("np-auth-session");
    client.setAuthSessionPersistence(true);

    expect(window.localStorage.getItem("np-auth-session")).toBe("remembered-session");
    expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
    expect(client.isAuthSessionPersistenceEnabled()).toBe(true);
  });

  it("stores sessions in localStorage only when remember session is enabled", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;

    client.setAuthSessionPersistence(true);
    storage.setItem("np-auth-session", "remembered-session");

    expect(window.localStorage.getItem("np_auth_remember_test")).toBe("1");
    expect(window.localStorage.getItem("np-auth-session")).toBe("remembered-session");
    expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
    expect(client.isAuthSessionPersistenceEnabled()).toBe(true);
  });

  it("clears current and legacy Supabase auth tokens on sign-out cleanup", async () => {
    const client = await loadClient();

    window.localStorage.setItem("np_auth_remember_test", "1");
    window.localStorage.setItem("np-auth-session", "current");
    window.localStorage.setItem("sb-old-ref-auth-token", "legacy");
    window.sessionStorage.setItem("np-auth-session", "session");

    client.clearAuthSessionStorage();

    expect(window.localStorage.getItem("np_auth_remember_test")).toBeNull();
    expect(window.localStorage.getItem("np-auth-session")).toBeNull();
    expect(window.localStorage.getItem("sb-old-ref-auth-token")).toBeNull();
    expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
  });

  it("removes only the selected tab storage on local-session cleanup", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;
    window.localStorage.setItem("np-auth-session", "other-tab-session");
    window.sessionStorage.setItem("np-auth-session", "current-tab-session");

    storage.removeItem("np-auth-session");

    expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
    expect(window.localStorage.getItem("np-auth-session")).toBe("other-tab-session");
    expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
  });
});
