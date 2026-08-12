import {
  clearAuthSessionStorage,
  isAuthSessionPersistenceEnabled,
  setAuthSessionPersistence,
  supabase,
} from "../../supabaseClient";

const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TOKEN_REFRESH_RETRY_MS = 15_000;
const MIN_REFRESH_SCHEDULE_DELAY_MS = 1_000;
const USER_CACHE_TTL_MS = 30_000;

let authQueue = Promise.resolve();
let sessionPromise = null;
let refreshPromise = null;
let userPromise = null;
let cachedSession = null;
let cachedUser = null;
let lastUserCheckedAt = 0;
let pendingAuthNotice = null;
let refreshTimer = null;
let expiryTimer = null;
let sessionEndPromise = null;
let monitorReferences = 0;
let monitorListenersAttached = false;
const invalidationListeners = new Set();

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

const getSessionExpiryMs = (session) => {
  const expiresAt = Number(session?.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt * 1000 : null;
};

const isSessionExpired = (session) => {
  const expiresAt = getSessionExpiryMs(session);
  return expiresAt !== null && expiresAt <= Date.now();
};

const canUseBrowserEvents = () => typeof window !== "undefined" && typeof document !== "undefined";

const clearSessionTimers = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (expiryTimer) clearTimeout(expiryTimer);
  refreshTimer = null;
  expiryTimer = null;
};

const notifyInvalidation = (notice) => {
  invalidationListeners.forEach((listener) => {
    try {
      listener({ notice });
    } catch {
      // A stale React subscription must not prevent local credential cleanup.
    }
  });
};

const scheduleRetryBeforeExpiry = (session) => {
  if (cachedSession !== session) return;
  const expiresAt = getSessionExpiryMs(session);
  if (!expiresAt || expiresAt <= Date.now()) return;

  const retryDelay = Math.min(TOKEN_REFRESH_RETRY_MS, Math.max(1_000, expiresAt - Date.now()));
  refreshTimer = setTimeout(() => {
    void maintainAuthSession({ invalidateAtExpiry: true }).catch(() => undefined);
  }, retryDelay);
};

const scheduleSessionMaintenance = (session) => {
  clearSessionTimers();

  const expiresAt = getSessionExpiryMs(session);
  if (!expiresAt) return;

  const refreshDelay = Math.max(MIN_REFRESH_SCHEDULE_DELAY_MS, expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS);
  refreshTimer = setTimeout(() => {
    if (cachedSession !== session) return;
    void maintainAuthSession({ invalidateAtExpiry: false }).catch(() => {
      scheduleRetryBeforeExpiry(session);
    });
  }, refreshDelay);

  expiryTimer = setTimeout(() => {
    if (cachedSession !== session) return;
    void maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true }).catch(() => undefined);
  }, Math.max(0, expiresAt - Date.now()));
};

export function setCachedAuthSession(session) {
  cachedSession = session || null;
  cachedUser = session?.user || null;
  if (!session) {
    lastUserCheckedAt = 0;
    clearSessionTimers();
    return;
  }
  scheduleSessionMaintenance(session);
}

export function clearCachedAuthSession() {
  cachedSession = null;
  cachedUser = null;
  lastUserCheckedAt = 0;
  clearSessionTimers();
}

export function markAuthNotice(code) {
  pendingAuthNotice = code || null;
}

export function consumeAuthNotice() {
  const notice = pendingAuthNotice;
  pendingAuthNotice = null;
  return notice;
}

export { isAuthSessionPersistenceEnabled, setAuthSessionPersistence };

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

export async function maintainAuthSession({ forceRefresh = false, invalidateAtExpiry = false } = {}) {
  let session;
  try {
    session = await getAuthSession();
  } catch (error) {
    if (invalidateAtExpiry || isSessionExpired(cachedSession)) await expireAuthSession();
    throw error;
  }

  if (!session?.access_token) {
    if (invalidateAtExpiry || isSessionExpired(cachedSession)) await expireAuthSession();
    return null;
  }

  const requiresRefresh = forceRefresh || !isSessionFreshEnough(session);
  if (!requiresRefresh) return session;

  try {
    const refreshedSession = await refreshAuthSession();
    if (!refreshedSession?.access_token) {
      throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
    }
    return refreshedSession;
  } catch (error) {
    if (invalidateAtExpiry || isSessionExpired(session)) await expireAuthSession();
    throw error;
  }
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

async function endAuthSession({ scope = "global", notice = null, suppressRemoteError = false } = {}) {
  if (notice) markAuthNotice(notice);
  if (sessionEndPromise) return sessionEndPromise;

  sessionEndPromise = enqueueAuthOperation("signOut", async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error && !suppressRemoteError) throw error;
    } finally {
      clearCachedAuthSession();
      clearAuthSessionStorage();
      if (notice) notifyInvalidation(notice);
    }
  }).finally(() => {
    sessionEndPromise = null;
  });

  return sessionEndPromise;
}

export async function signOutAuth() {
  return endAuthSession();
}

export async function expireAuthSession() {
  return endAuthSession({
    scope: "local",
    notice: "SESSION_EXPIRED",
    suppressRemoteError: true,
  });
}

export function subscribeToAuthInvalidation(listener) {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

const revalidateWhenActive = () => {
  if (document.visibilityState && document.visibilityState !== "visible") return;
  void maintainAuthSession({ invalidateAtExpiry: true }).catch(() => undefined);
};

export function startAuthSessionMonitor() {
  if (!canUseBrowserEvents()) return () => undefined;

  monitorReferences += 1;
  if (!monitorListenersAttached) {
    window.addEventListener("focus", revalidateWhenActive);
    window.addEventListener("online", revalidateWhenActive);
    document.addEventListener("visibilitychange", revalidateWhenActive);
    monitorListenersAttached = true;
  }

  return () => {
    monitorReferences = Math.max(0, monitorReferences - 1);
    if (monitorReferences || !monitorListenersAttached) return;
    window.removeEventListener("focus", revalidateWhenActive);
    window.removeEventListener("online", revalidateWhenActive);
    document.removeEventListener("visibilitychange", revalidateWhenActive);
    monitorListenersAttached = false;
  };
}

export function __resetAuthManagerForTests() {
  authQueue = Promise.resolve();
  sessionPromise = null;
  refreshPromise = null;
  userPromise = null;
  pendingAuthNotice = null;
  sessionEndPromise = null;
  monitorReferences = 0;
  if (monitorListenersAttached && canUseBrowserEvents()) {
    window.removeEventListener("focus", revalidateWhenActive);
    window.removeEventListener("online", revalidateWhenActive);
    document.removeEventListener("visibilitychange", revalidateWhenActive);
  }
  monitorListenersAttached = false;
  invalidationListeners.clear();
  clearCachedAuthSession();
}
