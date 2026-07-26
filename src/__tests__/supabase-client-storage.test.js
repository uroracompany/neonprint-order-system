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
  it("stores sessions in sessionStorage by default", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;

    storage.setItem("np-auth-session", "session-value");

    expect(window.sessionStorage.getItem("np-auth-session")).toBe("session-value");
    expect(window.localStorage.getItem("np-auth-session")).toBeNull();
    expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
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
});
