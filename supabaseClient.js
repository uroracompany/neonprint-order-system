import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const AUTH_SESSION_STORAGE_KEY =
  import.meta.env.VITE_AUTH_SESSION_STORAGE_KEY || "np_auth_remember";

const AUTH_STORAGE_KEY = "np-auth-session";

const hasBrowserStorage = () => typeof window !== "undefined" && window.localStorage && window.sessionStorage;

const readRememberPreference = () => {
  if (!hasBrowserStorage()) return false;
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
    setAuthItem(getSelectedStorage(), key, value);
    removeAuthItem(getFallbackStorage(), key);
  },
  removeItem(key) {
    removeAuthItem(window?.localStorage, key);
    removeAuthItem(window?.sessionStorage, key);
  },
};

export function isAuthSessionPersistenceEnabled() {
  return readRememberPreference();
}

export function setAuthSessionPersistence(remember) {
  if (!hasBrowserStorage()) return;

  if (remember) {
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function clearAuthSessionStorage() {
  if (!hasBrowserStorage()) return;
  clearAuthKeysFrom(window.localStorage);
  clearAuthKeysFrom(window.sessionStorage);
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage: authSessionStorage,
    storageKey: AUTH_STORAGE_KEY,
  },
});
