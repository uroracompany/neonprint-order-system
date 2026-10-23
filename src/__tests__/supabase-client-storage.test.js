import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn((url, key, options) => ({ url, key, options })));

const overrideWindowStorage = (name, overrides) => {
  const original = window[name];
  const descriptor = Object.getOwnPropertyDescriptor(window, name);
  const wrapped = new Proxy(original, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return (...args) => overrides[property](target, ...args);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  Object.defineProperty(window, name, { configurable: true, value: wrapped });
  return () => Object.defineProperty(window, name, descriptor);
};

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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("recovers a positive-timeout lock acquisition with steal and clears its timer", async () => {
    const originalLocks = navigator.locks;
    const timerId = 731;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockReturnValue(timerId);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    const request = vi.fn()
      .mockRejectedValueOnce(new DOMException("Lock wait aborted", "AbortError"))
      .mockImplementationOnce(async (name, options, callback) => {
        expect(name).toBe("lock:np-auth-session");
        expect(options).toEqual({ mode: "exclusive", steal: true });
        return callback({ name });
      });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    try {
      await loadClient();
      const lock = createClientMock.mock.calls[0][2].auth.lock;
      const fn = vi.fn(async () => "recovered-session");

      await expect(lock("lock:np-auth-session", 25, fn)).resolves.toBe("recovered-session");

      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    } finally {
      if (originalLocks === undefined) {
        delete navigator.locks;
      } else {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: originalLocks,
        });
      }
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("propagates non-abort lock errors and still clears the timeout", async () => {
    const originalLocks = navigator.locks;
    const timerId = 947;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockReturnValue(timerId);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    const lockError = new Error("Lock manager unavailable");
    const request = vi.fn().mockRejectedValue(lockError);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    try {
      await loadClient();
      const lock = createClientMock.mock.calls[0][2].auth.lock;

      await expect(lock("lock:np-auth-session", 25, async () => "unused"))
        .rejects.toBe(lockError);

      expect(request).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    } finally {
      if (originalLocks === undefined) {
        delete navigator.locks;
      } else {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: originalLocks,
        });
      }
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
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

  it("copies the active session before enabling persistence and removing the temporary copy", async () => {
    const client = await loadClient();
    const events = [];
    const restoreSession = overrideWindowStorage("sessionStorage", {
      getItem: (target, key) => {
        events.push(`session:get:${key}`);
        return target.getItem(key);
      },
      removeItem: (target, key) => {
        events.push(`session:remove:${key}`);
        return target.removeItem(key);
      },
    });
    const restoreLocal = overrideWindowStorage("localStorage", {
      getItem: (target, key) => {
        events.push(`local:get:${key}`);
        return target.getItem(key);
      },
      setItem: (target, key, value) => {
        events.push(`local:set:${key}`);
        return target.setItem(key, value);
      },
    });

    try {
      window.sessionStorage.setItem("np-auth-session", "validated-session");
      client.setAuthSessionPersistence(true);

      expect(window.localStorage.getItem("np-auth-session")).toBe("validated-session");
      expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
      expect(events.indexOf("session:get:np-auth-session"))
        .toBeLessThan(events.indexOf("local:set:np-auth-session"));
      expect(events.indexOf("local:set:np-auth-session"))
        .toBeLessThan(events.indexOf("local:set:np_auth_remember_test"));
      expect(events.indexOf("local:set:np_auth_remember_test"))
        .toBeLessThan(events.indexOf("session:remove:np-auth-session"));
    } finally {
      restoreLocal();
      restoreSession();
    }
  });

  it("keeps the validated session tab-scoped when persistent storage writes fail", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;
    storage.setItem("np-auth-session", "validated-session");
    const restoreLocal = overrideWindowStorage("localStorage", {
      setItem: (target, key, value) => {
        if (key === "np-auth-session") throw new DOMException("blocked", "SecurityError");
        return target.setItem(key, value);
      },
    });

    try {
      expect(() => client.setAuthSessionPersistence(true)).not.toThrow();

      expect(window.sessionStorage.getItem("np-auth-session")).toBe("validated-session");
      expect(window.sessionStorage.getItem("np_auth_remember_test:session-mode")).toBe("1");
      expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
      expect(storage.getItem("np-auth-session")).toBe("validated-session");
    } finally {
      restoreLocal();
    }
  });

  it("keeps session-only mode when reading the candidate session fails", async () => {
    const client = await loadClient();
    window.sessionStorage.setItem("np-auth-session", "validated-session");
    const restoreSession = overrideWindowStorage("sessionStorage", {
      getItem: (target, key) => {
        if (key === "np-auth-session") throw new DOMException("blocked", "SecurityError");
        return target.getItem(key);
      },
    });

    try {
      expect(() => client.setAuthSessionPersistence(true)).not.toThrow();

      expect(window.localStorage.getItem("np-auth-session")).toBeNull();
      expect(window.localStorage.getItem("np_auth_remember_test")).toBeNull();
      expect(window.sessionStorage.getItem("np_auth_remember_test:session-mode")).toBe("1");
      expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
    } finally {
      restoreSession();
    }
  });

  it("restores a prior remembered session when enabling the preference write fails", async () => {
    const client = await loadClient();
    window.localStorage.setItem("np_auth_remember_test", "1");
    window.localStorage.setItem("np-auth-session", "previous-session");
    client.setAuthSessionPersistence(false);
    window.sessionStorage.setItem("np-auth-session", "validated-session");
    const restoreLocal = overrideWindowStorage("localStorage", {
      setItem: (target, key, value) => {
        if (key === "np_auth_remember_test") throw new DOMException("blocked", "QuotaExceededError");
        return target.setItem(key, value);
      },
    });

    try {
      expect(() => client.setAuthSessionPersistence(true)).not.toThrow();

      expect(window.localStorage.getItem("np-auth-session")).toBe("previous-session");
      expect(window.localStorage.getItem("np_auth_remember_test")).toBe("1");
      expect(window.sessionStorage.getItem("np-auth-session")).toBe("validated-session");
      expect(window.sessionStorage.getItem("np_auth_remember_test:session-mode")).toBe("1");
      expect(client.isAuthSessionPersistenceEnabled()).toBe(false);
    } finally {
      restoreLocal();
    }
  });

  it("continues using sessionStorage when localStorage cannot be acquired", async () => {
    const client = await loadClient();
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); },
    });

    try {
      const storage = createClientMock.mock.calls[0][2].auth.storage;
      expect(() => storage.setItem("np-auth-session", "tab-session")).not.toThrow();
      expect(window.sessionStorage.getItem("np-auth-session")).toBe("tab-session");
      expect(() => client.setAuthSessionPersistence(true)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  });

  it("stages in tab memory when sessionStorage is blocked and promotes only after validation", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;
    window.localStorage.setItem("np_auth_remember_test", "1");
    window.localStorage.setItem("np-auth-session", "remembered-session");
    const descriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); },
    });

    try {
      client.setAuthSessionPersistence(false);
      storage.setItem("np-auth-session", "candidate-session");

      expect(window.localStorage.getItem("np-auth-session")).toBe("remembered-session");
      expect(storage.getItem("np-auth-session")).toBe("candidate-session");

      storage.removeItem("np-auth-session");
      expect(storage.getItem("np-auth-session")).toBeNull();
      expect(window.localStorage.getItem("np-auth-session")).toBe("remembered-session");

      storage.setItem("np-auth-session", "validated-session");
      client.setAuthSessionPersistence(true);

      expect(window.localStorage.getItem("np-auth-session")).toBe("validated-session");
      expect(client.isAuthSessionPersistenceEnabled()).toBe(true);
      expect(storage.getItem("np-auth-session")).toBe("validated-session");
      client.clearAuthSessionStorage();
      expect(window.localStorage.getItem("np-auth-session")).toBeNull();
      expect(storage.getItem("np-auth-session")).toBeNull();
    } finally {
      Object.defineProperty(window, "sessionStorage", descriptor);
    }
  });

  it("uses tab memory when writing the session-only marker is denied", async () => {
    const client = await loadClient();
    const storage = createClientMock.mock.calls[0][2].auth.storage;
    window.localStorage.setItem("np_auth_remember_test", "1");
    window.localStorage.setItem("np-auth-session", "remembered-session");
    const restoreSession = overrideWindowStorage("sessionStorage", {
      setItem: (target, key, value) => {
        if (key === "np_auth_remember_test:session-mode") {
          throw new DOMException("blocked", "SecurityError");
        }
        return target.setItem(key, value);
      },
    });

    try {
      client.setAuthSessionPersistence(false);
      storage.setItem("np-auth-session", "candidate-session");

      expect(window.localStorage.getItem("np-auth-session")).toBe("remembered-session");
      expect(storage.getItem("np-auth-session")).toBe("candidate-session");

      client.setAuthSessionPersistence(true);
      expect(window.localStorage.getItem("np-auth-session")).toBe("candidate-session");
      expect(client.isAuthSessionPersistenceEnabled()).toBe(true);
    } finally {
      restoreSession();
    }
  });

  it("clears current and legacy Supabase auth tokens on sign-out cleanup", async () => {
    const client = await loadClient();

    window.localStorage.setItem("np_auth_remember_test", "1");
    window.localStorage.setItem("np-auth-session", "current");
    window.localStorage.setItem("sb-old-ref-auth-token", "legacy");
    window.sessionStorage.setItem("np-auth-session", "session");
    window.sessionStorage.setItem("np_auth_remember_test:session-mode", "1");

    client.clearAuthSessionStorage();

    expect(window.localStorage.getItem("np_auth_remember_test")).toBeNull();
    expect(window.localStorage.getItem("np-auth-session")).toBeNull();
    expect(window.localStorage.getItem("sb-old-ref-auth-token")).toBeNull();
    expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
    expect(window.sessionStorage.getItem("np_auth_remember_test:session-mode")).toBeNull();
  });

  it("clears accessible session data when localStorage access fails during global cleanup", async () => {
    const client = await loadClient();
    window.sessionStorage.setItem("np-auth-session", "current-tab-session");
    window.sessionStorage.setItem("np_auth_remember_test:session-mode", "1");
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("blocked", "SecurityError"); },
    });

    try {
      expect(() => client.clearAuthSessionStorage()).not.toThrow();
      expect(window.sessionStorage.getItem("np-auth-session")).toBeNull();
      expect(window.sessionStorage.getItem("np_auth_remember_test:session-mode")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
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
