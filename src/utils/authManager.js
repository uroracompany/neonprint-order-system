import { supabase } from "../../supabaseClient";

const TOKEN_REFRESH_BUFFER_MS = 60_000;
const USER_CACHE_TTL_MS = 30_000;

let authQueue = Promise.resolve();
let sessionPromise = null;
let refreshPromise = null;
let userPromise = null;
let cachedSession = null;
let cachedUser = null;
let lastUserCheckedAt = 0;

const isAuthDebugEnabled = () => import.meta.env?.VITE_AUTH_DEBUG === "1";

const logAuthDebug = (operation, phase, detail = {}) => {
  if (!isAuthDebugEnabled()) return;

  const safeDetail = Object.fromEntries(
    Object.entries(detail).filter(([key]) => !/token|email|password|key/i.test(key))
  );

  console.info("[auth-manager]", operation, phase, safeDetail);
};

const enqueueAuthOperation = (operation, task) => {
  const startedAt = Date.now();
  const run = authQueue
    .catch(() => undefined)
    .then(async () => {
      logAuthDebug(operation, "start");
      try {
        const result = await task();
        logAuthDebug(operation, "end", { durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        logAuthDebug(operation, "error", {
          durationMs: Date.now() - startedAt,
          message: error?.message || "unknown",
        });
        throw error;
      }
    });

  authQueue = run.catch(() => undefined);
  return run;
};

const isSessionFreshEnough = (session) => {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 - Date.now() > TOKEN_REFRESH_BUFFER_MS;
};

export function setCachedAuthSession(session) {
  cachedSession = session || null;
  cachedUser = session?.user || null;
  if (!session) lastUserCheckedAt = 0;
}

export function clearCachedAuthSession() {
  cachedSession = null;
  cachedUser = null;
  lastUserCheckedAt = 0;
}

export async function getAuthSession({ forceRefresh = false } = {}) {
  if (!forceRefresh && isSessionFreshEnough(cachedSession)) {
    return cachedSession;
  }

  if (!forceRefresh && sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = enqueueAuthOperation("getSession", async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    setCachedAuthSession(data?.session || null);
    return cachedSession;
  }).finally(() => {
    sessionPromise = null;
  });

  return sessionPromise;
}

export async function refreshAuthSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = enqueueAuthOperation("refreshSession", async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    setCachedAuthSession(data?.session || null);
    return cachedSession;
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function getFreshAccessToken({ forceRefresh = false } = {}) {
  let session = await getAuthSession();

  if (!session?.access_token && !forceRefresh) {
    throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
  }

  if (forceRefresh || !isSessionFreshEnough(session)) {
    session = await refreshAuthSession();
  }

  if (!session?.access_token) {
    throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
  }

  return session.access_token;
}

export async function getVerifiedUser({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedUser && now - lastUserCheckedAt < USER_CACHE_TTL_MS) {
    return cachedUser;
  }

  if (!force && userPromise) return userPromise;

  userPromise = enqueueAuthOperation("getUser", async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    cachedUser = data?.user || null;
    lastUserCheckedAt = Date.now();
    return cachedUser;
  }).finally(() => {
    userPromise = null;
  });

  return userPromise;
}

export async function signOutAuth() {
  return enqueueAuthOperation("signOut", async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      clearCachedAuthSession();
    }
  });
}

export function __resetAuthManagerForTests() {
  authQueue = Promise.resolve();
  sessionPromise = null;
  refreshPromise = null;
  userPromise = null;
  clearCachedAuthSession();
}
