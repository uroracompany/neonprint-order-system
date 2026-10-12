import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const AUTH_SESSION_STORAGE_KEY =
  import.meta.env.VITE_AUTH_SESSION_STORAGE_KEY || "np_auth_remember";

const AUTH_STORAGE_KEY = "np-auth-session";
const AUTH_SESSION_MODE_KEY = `${AUTH_SESSION_STORAGE_KEY}:session-mode`;

const hasBrowserStorage = () => typeof window !== "undefined" && window.localStorage && window.sessionStorage;

const readRememberPreference = () => {
  if (!hasBrowserStorage()) return false;
  // A session-only choice belongs to this browser tab. It must not overwrite
  // the shared remember preference used by other tabs.
  if (window.sessionStorage.getItem(AUTH_SESSION_MODE_KEY) === "1") return false;
  return window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY) === "1";
};

const removeAuthItem = (storage, key) => {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Storage can be blocked in private or hardened browser modes.
  }
};

const setAuthItem = (storage, key, value) => {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Supabase will keep the in-memory session if persistent storage fails.
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
  if (!hasBrowserStorage()) return null;
  return readRememberPreference() ? window.localStorage : window.sessionStorage;
};

const getFallbackStorage = () => {
  if (!hasBrowserStorage()) return null;
  return readRememberPreference() ? window.sessionStorage : window.localStorage;
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

  try {
    const options = controller
      ? { mode: "exclusive", signal: controller.signal }
      : { mode: "exclusive" };

    return await lockManager.request(name, options, async () => fn());
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
};

export const authSessionStorage = {
  getItem(key) {
    const selectedValue = getAuthItem(getSelectedStorage(), key);
    if (selectedValue) return selectedValue;

    if (readRememberPreference()) {
      return getAuthItem(getFallbackStorage(), key);
    }

    return null;
  },
  setItem(key, value) {
    // Do not delete the fallback store here. It may belong to another tab
    // with a different persistence choice and must survive local cleanup.
    setAuthItem(getSelectedStorage(), key, value);
  },
  removeItem(key) {
    // Remove only the storage selected for this client session. A local signout
    // must not erase a separate session held by another tab/storage mode.
    removeAuthItem(getSelectedStorage(), key);
  },
};

export function isAuthSessionPersistenceEnabled() {
  return readRememberPreference();
}

export function setAuthSessionPersistence(remember) {
  if (!hasBrowserStorage()) return;

  if (remember) {
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    removeAuthItem(window.sessionStorage, AUTH_SESSION_MODE_KEY);
    return;
  }

  setAuthItem(window.sessionStorage, AUTH_SESSION_MODE_KEY, "1");
}

export function clearAuthSessionStorage() {
  if (!hasBrowserStorage()) return;
  clearAuthKeysFrom(window.localStorage);
  clearAuthKeysFrom(window.sessionStorage);
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  removeAuthItem(window.sessionStorage, AUTH_SESSION_MODE_KEY);
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
