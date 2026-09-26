import {
  clearAuthSessionStorage,
  isAuthSessionPersistenceEnabled,
  setAuthSessionPersistence,
  supabase,
} from "../../supabaseClient";

const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TOKEN_REFRESH_RETRY_MS = 15_000;
const TOKEN_REFRESH_BACKOFF_MAX_MS = 120_000;
// Supabase Auth uses a token bucket with a burst capacity. When a company
// shares one public IP, sessions created around the same time can otherwise
// all refresh in the same second and hit that burst limit even when the
// configured five-minute quota is high.
const TOKEN_REFRESH_JITTER_MAX_MS = 90_000;
const TOKEN_REFRESH_RETRY_JITTER_MAX_MS = 10_000;
const MIN_REFRESH_SCHEDULE_DELAY_MS = 1_000;
const USER_CACHE_TTL_MS = 30_000;
const AUTH_REFRESH_LOCK_NAME = "np-auth-refresh-session";
const AUTH_REFRESH_CHANNEL_NAME = "np-auth-refresh-coordination";

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
let refreshFailureCount = 0;
let refreshBlockedUntil = 0;
let refreshCoordinationChannel = null;
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

const getBoundedJitterMs = (maxMs) => {
  if (!Number.isFinite(maxMs) || maxMs <= 0) return 0;
  const random = Number(Math.random());
  if (!Number.isFinite(random) || random <= 0) return 0;
  return Math.floor(Math.min(random, 0.999999) * (maxMs + 1));
};

const isSessionExpired = (session) => {
  const expiresAt = getSessionExpiryMs(session);
  return expiresAt !== null && expiresAt <= Date.now();
};

const canUseBrowserEvents = () => typeof window !== "undefined" && typeof document !== "undefined";

const canUseRefreshCoordination = () => (
  typeof globalThis !== "undefined"
  && typeof globalThis.BroadcastChannel === "function"
);

const getRefreshCoordinationChannel = () => {
  if (!canUseRefreshCoordination()) return null;
  if (refreshCoordinationChannel) return refreshCoordinationChannel;

  try {
    refreshCoordinationChannel = new globalThis.BroadcastChannel(AUTH_REFRESH_CHANNEL_NAME);
    refreshCoordinationChannel.addEventListener("message", ({ data }) => {
      if (data?.type === "rate_limited" && Number.isFinite(Number(data.retryAt))) {
        refreshBlockedUntil = Math.max(refreshBlockedUntil, Number(data.retryAt));
        refreshFailureCount = Math.max(refreshFailureCount, Number(data.failureCount) || 1);
      }

      if (data?.type === "refresh_succeeded") {
        refreshBlockedUntil = 0;
        refreshFailureCount = 0;
      }
    });
  } catch {
    refreshCoordinationChannel = null;
  }

  return refreshCoordinationChannel;
};

const broadcastRefreshEvent = (event) => {
  try {
    getRefreshCoordinationChannel()?.postMessage(event);
  } catch {
    // BroadcastChannel is optional; auth must work when it is unavailable.
  }
};

const isRefreshRateLimitError = (error) => {
  const status = Number(error?.status);
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return status === 429
    || code === "over_request_rate_limit"
    || code === "rate_limit_exceeded"
    || /too many requests|rate.?limit|429/.test(message);
};

const getRetryAfterMs = (error) => {
  const directValue = error?.retryAfter ?? error?.retry_after;
  const headerValue = error?.headers?.get?.("retry-after")
    ?? error?.context?.headers?.get?.("retry-after")
    ?? error?.context?.response?.headers?.get?.("retry-after");
  const value = Number(directValue ?? headerValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 86_400 ? value : value * 1_000;
};

const createRefreshRateLimitError = () => Object.assign(
  new Error("La sesión está temporalmente limitada. Reintentaremos automáticamente."),
  {
    code: "AUTH_REFRESH_RATE_LIMITED",
    status: 429,
    retryAt: refreshBlockedUntil,
  },
);

const registerRefreshRateLimit = (error) => {
  refreshFailureCount = Math.min(refreshFailureCount + 1, 8);
  const exponentialDelay = Math.min(
    TOKEN_REFRESH_BACKOFF_MAX_MS,
    TOKEN_REFRESH_RETRY_MS * (2 ** (refreshFailureCount - 1)),
  );
  const retryDelay = Math.min(
    TOKEN_REFRESH_BACKOFF_MAX_MS,
    (getRetryAfterMs(error) || exponentialDelay) + getBoundedJitterMs(TOKEN_REFRESH_RETRY_JITTER_MAX_MS),
  );
  refreshBlockedUntil = Math.max(refreshBlockedUntil, Date.now() + retryDelay);
  broadcastRefreshEvent({
    type: "rate_limited",
    retryAt: refreshBlockedUntil,
    failureCount: refreshFailureCount,
  });
};

const resetRefreshBackoff = () => {
  refreshFailureCount = 0;
  refreshBlockedUntil = 0;
  broadcastRefreshEvent({ type: "refresh_succeeded" });
};

const getRefreshCooldownMs = () => Math.max(0, refreshBlockedUntil - Date.now());

const runWithRefreshLock = async (task) => {
  const locks = globalThis?.navigator?.locks;
  if (typeof locks?.request !== "function") return task();
  return locks.request(AUTH_REFRESH_LOCK_NAME, { mode: "exclusive" }, task);
};

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

  if (refreshTimer) clearTimeout(refreshTimer);
  const retryDelay = Math.min(
    Math.max(1_000, expiresAt - Date.now()),
    Math.max(TOKEN_REFRESH_RETRY_MS, getRefreshCooldownMs()),
  );
  refreshTimer = setTimeout(() => {
    void maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: true }).catch(() => undefined);
  }, retryDelay);
};

const scheduleSessionMaintenance = (session) => {
  clearSessionTimers();

  const expiresAt = getSessionExpiryMs(session);
  if (!expiresAt) return;

  const refreshLeadTime = TOKEN_REFRESH_BUFFER_MS + getBoundedJitterMs(TOKEN_REFRESH_JITTER_MAX_MS);
  const refreshDelay = Math.max(MIN_REFRESH_SCHEDULE_DELAY_MS, expiresAt - Date.now() - refreshLeadTime);
  refreshTimer = setTimeout(() => {
    if (cachedSession !== session) return;
    void maintainAuthSession({ forceRefresh: true, invalidateAtExpiry: false }).catch(() => {
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

export async function refreshAuthSession({ forceRefresh = false } = {}) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = enqueueAuthOperation("refreshSession", async () => {
    return runWithRefreshLock(async () => {
      // Another tab may have refreshed while this request waited for the
      // shared lock. Re-read storage before consuming the refresh token.
      const latestResult = await supabase.auth.getSession();
      if (latestResult.error) throw latestResult.error;
      const latestSession = latestResult.data?.session || null;
      const latestSessionIsNewer = Boolean(
        latestSession?.access_token
        && (!cachedSession?.access_token || latestSession.access_token !== cachedSession.access_token)
      );
      if (
        latestSession?.access_token
        && isSessionFreshEnough(latestSession)
        && (!forceRefresh || latestSessionIsNewer)
      ) {
        setCachedAuthSession(latestSession);
        resetRefreshBackoff();
        return cachedSession;
      }

      if (getRefreshCooldownMs() > 0) throw createRefreshRateLimitError();

      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      setCachedAuthSession(data?.session || null);
      resetRefreshBackoff();
      return cachedSession;
    });
  }).catch((error) => {
    if (isRefreshRateLimitError(error) && error?.code !== "AUTH_REFRESH_RATE_LIMITED") {
      registerRefreshRateLimit(error);
    }
    throw error;
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
    const refreshedSession = await refreshAuthSession({ forceRefresh });
    if (!refreshedSession?.access_token) {
      throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
    }
    return refreshedSession;
  } catch (error) {
    // A 429 is a temporary throttle. Keep a still-valid session alive and let
    // the scheduled backoff retry instead of logging users out.
    if (isRefreshRateLimitError(error)) {
      if (isSessionExpired(session)) await expireAuthSession();
      scheduleRetryBeforeExpiry(session);
    } else if (invalidateAtExpiry || isSessionExpired(session)) {
      await expireAuthSession();
    }
    throw error;
  }
}

export async function getFreshAccessToken({ forceRefresh = false } = {}) {
  let session = await getAuthSession();

  if (!session?.access_token && !forceRefresh) {
    throw new Error("Tu sesion expiro. Inicia sesion nuevamente.");
  }

  if (forceRefresh || !isSessionFreshEnough(session)) {
    session = await refreshAuthSession({ forceRefresh });
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
  refreshFailureCount = 0;
  refreshBlockedUntil = 0;
  try {
    refreshCoordinationChannel?.close?.();
  } catch {
    // Ignore optional coordination cleanup failures in tests/hardened browsers.
  }
  refreshCoordinationChannel = null;
  invalidationListeners.clear();
  clearCachedAuthSession();
}
