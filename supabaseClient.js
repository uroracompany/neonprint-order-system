import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const AUTH_SESSION_STORAGE_KEY =
  import.meta.env.VITE_AUTH_SESSION_STORAGE_KEY || "np_auth_remember";

const AUTH_STORAGE_KEY = "np-auth-session";
const AUTH_SESSION_MODE_KEY = `${AUTH_SESSION_STORAGE_KEY}:session-mode`;
const temporaryAuthValues = new Map();
const temporaryMemoryStorage = {
  getItem(key) {
    return temporaryAuthValues.get(String(key)) ?? null;
  },
  setItem(key, value) {
    temporaryAuthValues.set(String(key), String(value));
  },
  removeItem(key) {
    temporaryAuthValues.delete(String(key));
  },
};
let sessionOnlyModeActive = false;
let sessionOnlyStorage = null;

const getBrowserStorage = (name) => {
  try {
    if (typeof window === "undefined") return null;
    return window[name] || null;
  } catch {
    return null;
  }
};

const getLocalStorage = () => getBrowserStorage("localStorage");
const getSessionStorage = () => getBrowserStorage("sessionStorage");

const readRememberPreference = () => {
  const localStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();
  if (!localStorage) return false;
  // A session-only choice belongs to this browser tab. It must not overwrite
  // the shared remember preference used by other tabs.
  if (sessionStorage && getAuthItem(sessionStorage, AUTH_SESSION_MODE_KEY) === "1") return false;
  return getAuthItem(localStorage, AUTH_SESSION_STORAGE_KEY) === "1";
};

const removeAuthItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch {
    // Storage can be blocked in private or hardened browser modes.
    return false;
  }
};

const setAuthItem = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
    return Boolean(storage);
  } catch {
    // Supabase will keep the in-memory session if persistent storage fails.
    return false;
  }
};

const selectTemporarySessionStorage = () => {
  const sessionStorage = getSessionStorage();
  temporaryAuthValues.clear();
  if (setAuthItem(sessionStorage, AUTH_SESSION_MODE_KEY, "1")) {
    sessionOnlyStorage = sessionStorage;
  } else {
    sessionOnlyStorage = temporaryMemoryStorage;
  }
};

const getAuthItem = (storage, key) => {
  try {
    return storage?.getItem?.(key) || null;
  } catch {
    return null;
  }
};

const isSupabaseAuthKey = (key) => (
  key === AUTH_STORAGE_KEY || (/^sb-.+-auth-token$/.test(String(key || "")))
);

const clearAuthKeysFrom = (storage) => {
  if (!storage) return;
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(Boolean);
    keys.filter(isSupabaseAuthKey).forEach((key) => removeAuthItem(storage, key));
  } catch {
    removeAuthItem(storage, AUTH_STORAGE_KEY);
  }
};

const getSelectedStorage = () => {
  if (sessionOnlyModeActive) return sessionOnlyStorage || temporaryMemoryStorage;
  const localStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();
  if (readRememberPreference()) return localStorage || sessionStorage;
  return sessionStorage || localStorage;
};

const getFallbackStorage = () => {
  const localStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();
  if (readRememberPreference()) return sessionStorage || localStorage;
  return localStorage || sessionStorage;
};

/**
 * Supabase's automatic refresh tick uses acquireTimeout=0, which maps to
 * `ifAvailable: true` in its default Web Locks adapter. That is appropriate
 * for a best-effort tick, but it rejects while another tab or a hot-reloaded
 * client is reading the same session and can bubble up as an unhandled error.
 * Keep the browser lock for cross-tab safety, but queue that best-effort work.
 */
const authBrowserLock = async (name, acquireTimeout, fn) => {
  const lockManager = globalThis?.navigator?.locks;
  if (!lockManager?.request) return fn();

  const controller = acquireTimeout > 0 ? new globalThis.AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), acquireTimeout)
    : null;

  let callbackStarted = false;
  const run = async () => {
    callbackStarted = true;
    return fn();
  };

  try {
    const options = controller
      ? { mode: "exclusive", signal: controller.signal }
      : { mode: "exclusive" };

    try {
      return await lockManager.request(name, options, run);
    } catch (error) {
      // Recover only a request that timed out while waiting for the lock.
      // An AbortError from the callback itself must remain the caller's error.
      if (!controller || callbackStarted || error?.name !== "AbortError") throw error;
      return await lockManager.request(name, { mode: "exclusive", steal: true }, run);
    }
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
};

export const authSessionStorage = {
  getItem(key) {
    if (sessionOnlyModeActive) return getAuthItem(sessionOnlyStorage || temporaryMemoryStorage, key);
    const selectedValue = getAuthItem(getSelectedStorage(), key);
    if (selectedValue) return selectedValue;

    if (readRememberPreference()) {
      return getAuthItem(getFallbackStorage(), key);
    }

    return null;
  },
  setItem(key, value) {
    if (sessionOnlyModeActive) {
      setAuthItem(sessionOnlyStorage || temporaryMemoryStorage, key, value);
      return;
    }
    // Do not delete the fallback store here. It may belong to another tab
    // with a different persistence choice and must survive local cleanup.
    setAuthItem(getSelectedStorage(), key, value);
  },
  removeItem(key) {
    if (sessionOnlyModeActive) {
      removeAuthItem(sessionOnlyStorage || temporaryMemoryStorage, key);
      return;
    }
    // Remove only the storage selected for this client session. A local signout
    // must not erase a separate session held by another tab/storage mode.
    removeAuthItem(getSelectedStorage(), key);
  },
};

export function isAuthSessionPersistenceEnabled() {
  return !sessionOnlyModeActive && readRememberPreference();
}

export function setAuthSessionPersistence(remember) {
  const localStorage = getLocalStorage();
  const wasSessionOnly = sessionOnlyModeActive;
  let activeTemporaryStorage = sessionOnlyStorage || temporaryMemoryStorage;

  if (remember) {
    // Supabase writes the active session to sessionStorage during login. Copy
    // that exact serialized value from the active temporary store before
    // making localStorage authoritative.
    let activeSession;
    if (wasSessionOnly) {
      try {
        activeSession = activeTemporaryStorage.getItem(AUTH_STORAGE_KEY);
      } catch {
        return;
      }
    } else {
      const sessionStorage = getSessionStorage();
      if (!localStorage || !sessionStorage) {
        setAuthItem(sessionStorage, AUTH_SESSION_MODE_KEY, "1");
        return;
      }
      try {
        activeSession = sessionStorage.getItem(AUTH_STORAGE_KEY);
      } catch {
        setAuthItem(sessionStorage, AUTH_SESSION_MODE_KEY, "1");
        return;
      }
    }
    if (activeSession) {
      if (!localStorage) return;
      if (!wasSessionOnly) {
        sessionOnlyModeActive = true;
        selectTemporarySessionStorage();
        setAuthItem(sessionOnlyStorage, AUTH_STORAGE_KEY, activeSession);
        activeTemporaryStorage = sessionOnlyStorage;
      } else if (activeTemporaryStorage !== temporaryMemoryStorage
        && !setAuthItem(activeTemporaryStorage, AUTH_SESSION_MODE_KEY, "1")) {
        temporaryAuthValues.clear();
        temporaryAuthValues.set(AUTH_STORAGE_KEY, activeSession);
        sessionOnlyStorage = temporaryMemoryStorage;
        activeTemporaryStorage = temporaryMemoryStorage;
      }
      let previousLocalSession = null;
      let hadPreviousLocalSession = false;
      let localSessionRead = false;
      let previousPreference = null;
      let preferenceRead = false;
      let candidateWritten = false;
      try {
        previousLocalSession = localStorage.getItem(AUTH_STORAGE_KEY);
        localSessionRead = true;
        hadPreviousLocalSession = previousLocalSession !== null;
        previousPreference = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
        preferenceRead = true;
        localStorage.setItem(AUTH_STORAGE_KEY, activeSession);
        candidateWritten = true;
        localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
      } catch {
        // Roll back a partially copied candidate when possible. The in-memory
        // mode remains active so this client continues reading temporary data.
        if (localSessionRead && candidateWritten) {
          try {
            if (hadPreviousLocalSession) localStorage.setItem(AUTH_STORAGE_KEY, previousLocalSession);
            else localStorage.removeItem(AUTH_STORAGE_KEY);
          } catch {
            // Storage may reject rollback too; never prevent the current login.
          }
        }
        if (preferenceRead) {
          try {
            if (previousPreference === null) localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
            else localStorage.setItem(AUTH_SESSION_STORAGE_KEY, previousPreference);
          } catch {
            // Keep this tab scoped even if preference rollback is also blocked.
          }
        }
        sessionOnlyModeActive = true;
        return;
      }
      if (activeTemporaryStorage === temporaryMemoryStorage) {
        temporaryAuthValues.clear();
        sessionOnlyModeActive = false;
        sessionOnlyStorage = null;
      } else if (removeAuthItem(activeTemporaryStorage, AUTH_SESSION_MODE_KEY)) {
        removeAuthItem(activeTemporaryStorage, AUTH_STORAGE_KEY);
        temporaryAuthValues.clear();
        sessionOnlyModeActive = false;
        sessionOnlyStorage = null;
      }
      return;
    }

    if (!localStorage) return;
    try {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
      if (wasSessionOnly && activeTemporaryStorage !== temporaryMemoryStorage) {
        if (!removeAuthItem(activeTemporaryStorage, AUTH_SESSION_MODE_KEY)) return;
      } else if (!wasSessionOnly) {
        removeAuthItem(getSessionStorage(), AUTH_SESSION_MODE_KEY);
      }
      if (wasSessionOnly) {
        temporaryAuthValues.clear();
        sessionOnlyStorage = null;
      }
      sessionOnlyModeActive = false;
    } catch {
      sessionOnlyModeActive = wasSessionOnly;
    }
    return;
  }

  sessionOnlyModeActive = true;
  selectTemporarySessionStorage();
}

export function clearAuthSessionStorage() {
  const localStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();
  clearAuthKeysFrom(localStorage);
  clearAuthKeysFrom(sessionStorage);
  removeAuthItem(localStorage, AUTH_SESSION_STORAGE_KEY);
  removeAuthItem(sessionStorage, AUTH_SESSION_MODE_KEY);
  temporaryAuthValues.clear();
  sessionOnlyModeActive = false;
  sessionOnlyStorage = null;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Keep one refresh authority: Supabase's browser SDK manages refresh timing,
    // foreground visibility and its cross-tab lock for this stable client.
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: authSessionStorage,
    storageKey: AUTH_STORAGE_KEY,
    lock: authBrowserLock,
  },
});
