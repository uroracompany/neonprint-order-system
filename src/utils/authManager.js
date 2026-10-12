import {
  clearAuthSessionStorage,
  isAuthSessionPersistenceEnabled,
  setAuthSessionPersistence,
  supabase,
} from "../../supabaseClient";

const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TOKEN_REFRESH_RETRY_MS = 15_000;
const TOKEN_REFRESH_BACKOFF_MAX_MS = 120_000;
const TOKEN_REFRESH_RETRY_JITTER_MAX_MS = 10_000;
const USER_CACHE_TTL_MS = 30_000;

let sessionPromise = null;
let refreshPromise = null;
let userPromise = null;
let sessionEndPromise = null;
let cachedSession = null;
let cachedUser = null;
let lastUserCheckedAt = 0;
let pendingAuthNotice = null;
let refreshFailureCount = 0;
let refreshBlockedUntil = 0;
const invalidationListeners = new Set();

const isAuthDebugEnabled = () => import.meta.env?.VITE_AUTH_DEBUG === "1";

// Keep auth diagnostics deliberately allow-listed: provider messages and request
// context can contain user-supplied values and are not safe to print verbatim.
const logAuthDebug = (operation, phase, detail = {}) => {
  if (!isAuthDebugEnabled()) return;
  const safeDetail = {};
  if (Number.isFinite(detail.durationMs)) safeDetail.durationMs = detail.durationMs;
  if (Number.isFinite(detail.status)) safeDetail.status = detail.status;
  if (typeof detail.code === "string") safeDetail.code = detail.code.slice(0, 64);
  console.info("[auth-manager]", operation, phase, safeDetail);
};

const isSessionFreshEnough = (session) => {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 - Date.now() > TOKEN_REFRESH_BUFFER_MS;
};

const isRateLimitError = (error) => (
  Number(error?.status) === 429
  || ["over_request_rate_limit", "rate_limit_exceeded"].includes(String(error?.code || "").toLowerCase())
  || /too many requests|rate.?limit|\b429\b/i.test(String(error?.message || ""))
);

export const isInvalidRefreshTokenError = (error) => (
  ["refresh_token_not_found", "refresh_token_already_used", "invalid_refresh_token"]
    .includes(String(error?.code || "").toLowerCase())
  || /invalid refresh token|refresh token.*(not found|revoked|already used)/i.test(String(error?.message || ""))
);

const getRetryAfterMs = (error) => {
  const directValue = error?.retryAfter ?? error?.retry_after;
  const headerValue = error?.headers?.get?.("retry-after")
    ?? error?.context?.headers?.get?.("retry-after")
    ?? error?.context?.response?.headers?.get?.("retry-after");
  const value = Number(directValue ?? headerValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 86_400 ? value : value * 1_000;
};

const registerRateLimit = (error) => {
  refreshFailureCount = Math.min(refreshFailureCount + 1, 8);
  const exponentialDelay = Math.min(
    TOKEN_REFRESH_BACKOFF_MAX_MS,
    TOKEN_REFRESH_RETRY_MS * (2 ** (refreshFailureCount - 1)),
  );
  const randomJitter = Math.floor(Math.random() * (TOKEN_REFRESH_RETRY_JITTER_MAX_MS + 1));
  const retryDelay = Math.min(
    TOKEN_REFRESH_BACKOFF_MAX_MS,
    (getRetryAfterMs(error) || exponentialDelay) + randomJitter,
  );
  refreshBlockedUntil = Math.max(refreshBlockedUntil, Date.now() + retryDelay);
};

const resetRateLimit = () => {
  refreshFailureCount = 0;
  refreshBlockedUntil = 0;
};

const createRateLimitError = () => Object.assign(
  new Error("La autenticación está temporalmente limitada. Intenta nuevamente en unos minutos."),
  { code: "AUTH_RATE_LIMITED", status: 429, retryAt: refreshBlockedUntil },
);

const notifyInvalidation = (notice) => {
  invalidationListeners.forEach((listener) => {
    try {
      listener({ notice });
    } catch {
      // A stale React subscription must not block local credential cleanup.
    }
  });
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
  if (!forceRefresh && sessionPromise) return sessionPromise;

  const startedAt = Date.now();
  const request = supabase.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      const session = data?.session || null;
      setCachedAuthSession(session);
      logAuthDebug("getSession", "end", { durationMs: Date.now() - startedAt });
      return session;
    })
    .catch((error) => {
      logAuthDebug("getSession", "error", { durationMs: Date.now() - startedAt, status: error?.status, code: error?.code });
      throw error;
    })
    .finally(() => {
      if (sessionPromise === request) sessionPromise = null;
    });

  if (!forceRefresh) sessionPromise = request;
  return request;
}

/**
 * Refresh on demand only (for an explicit refresh or an API request rejected
 * with 401). Supabase owns scheduled refresh and cross-tab locking. The
 * rejectedAccessToken lets late 401s reuse the newer session instead of
 * rotating its refresh token again.
 */
export async function refreshAuthSession({ forceRefresh = false, rejectedAccessToken = null } = {}) {
  if (refreshPromise) return refreshPromise;

  const request = (async () => {
    const latestSession = await getAuthSession({ forceRefresh: true });
    if (rejectedAccessToken && latestSession?.access_token !== rejectedAccessToken) {
      return latestSession;
    }
    if (!forceRefresh && isSessionFreshEnough(latestSession)) return latestSession;
    if (refreshBlockedUntil > Date.now()) throw createRateLimitError();

    const startedAt = Date.now();
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      const refreshed = data?.session || null;
      setCachedAuthSession(refreshed);
      resetRateLimit();
      logAuthDebug("refreshSession", "end", { durationMs: Date.now() - startedAt });
      return refreshed;
    } catch (error) {
      logAuthDebug("refreshSession", "error", { durationMs: Date.now() - startedAt, status: error?.status, code: error?.code });
      if (isRateLimitError(error)) registerRateLimit(error);
      throw error;
    }
  })().finally(() => {
    if (refreshPromise === request) refreshPromise = null;
  });

  refreshPromise = request;
  return request;
}

export async function maintainAuthSession({ forceRefresh = false, invalidateAtExpiry = false } = {}) {
  try {
    const session = await getAuthSession();
    if (!session?.access_token) return null;
    if (!forceRefresh && isSessionFreshEnough(session)) return session;
    return await refreshAuthSession({ forceRefresh: true });
  } catch (error) {
    const expiry = Number(cachedSession?.expires_at) * 1_000;
    if (isInvalidRefreshTokenError(error) || (invalidateAtExpiry && expiry && expiry <= Date.now())) {
      await expireAuthSession();
    }
    throw error;
  }
}

export async function getFreshAccessToken({ forceRefresh = false, rejectedAccessToken = null } = {}) {
  let session = await getAuthSession();

  if (rejectedAccessToken && session?.access_token && session.access_token !== rejectedAccessToken) {
    return session.access_token;
  }

  if (!session?.access_token && !forceRefresh) {
    throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  }

  if (forceRefresh || !isSessionFreshEnough(session)) {
    session = await refreshAuthSession({
      forceRefresh,
      rejectedAccessToken: rejectedAccessToken || null,
    });
  }

  if (!session?.access_token) throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  return session.access_token;
}

export async function getVerifiedUser({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedUser && now - lastUserCheckedAt < USER_CACHE_TTL_MS) return cachedUser;
  if (!force && userPromise) return userPromise;

  const request = supabase.auth.getUser()
    .then(({ data, error }) => {
      if (error) throw error;
      cachedUser = data?.user || null;
      lastUserCheckedAt = Date.now();
      return cachedUser;
    })
    .finally(() => {
      if (userPromise === request) userPromise = null;
    });

  if (!force) userPromise = request;
  return request;
}

async function endAuthSession({ scope = "global", notice = null, suppressRemoteError = false } = {}) {
  if (notice) markAuthNotice(notice);
  if (sessionEndPromise) return sessionEndPromise;

  const request = (async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error && !suppressRemoteError) throw error;
    } finally {
      clearCachedAuthSession();
      if (scope === "global") clearAuthSessionStorage();
      if (notice) notifyInvalidation(notice);
    }
  })().finally(() => {
    if (sessionEndPromise === request) sessionEndPromise = null;
  });

  sessionEndPromise = request;
  return request;
}

export async function signOutAuth(options = {}) {
  return endAuthSession(options);
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

// Compatibility no-op for any legacy caller. Supabase's browser SDK now owns
// foreground visibility handling and scheduled refresh.
export function startAuthSessionMonitor() {
  return () => undefined;
}

export function __resetAuthManagerForTests() {
  sessionPromise = null;
  refreshPromise = null;
  userPromise = null;
  pendingAuthNotice = null;
  sessionEndPromise = null;
  refreshFailureCount = 0;
  refreshBlockedUntil = 0;
  invalidationListeners.clear();
  clearCachedAuthSession();
}
