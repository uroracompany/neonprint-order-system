import { expireAuthSession, getFreshAccessToken, isInvalidRefreshTokenError } from "./authManager";
import { isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE } from "./errorUtils";
import { getApiErrorCode, getApiErrorMessage } from "./authFeedback";

const SESSION_FAILURE_CODES = new Set(["SESSION_EXPIRED", "AUTH_REQUIRED"]);

const isRateLimitError = (error) => (
  Number(error?.status) === 429
  || String(error?.code || "").toLowerCase() === "auth_rate_limited"
  || /too many requests|rate.?limit|\b429\b/i.test(String(error?.message || ""))
);

const isNetworkFailure = (error) => /fetch failed|network|connection|timeout/i
  .test(String(error?.message || ""));

const isTokenError = (result) =>
  /token|jwt|expir|invalid/i.test(String(result?.error || result?.message || ""));

const isSessionFailure = (response, result) => (
  response?.status === 401
  && (SESSION_FAILURE_CODES.has(String(result?.code || "").toUpperCase()) || isTokenError(result))
);

async function clearInvalidSession() {
  try {
    await expireAuthSession();
  } catch {
    // If signOut cannot reach Supabase, the caller still receives the 401 response.
  }
}

async function postJson(path, payload, accessToken) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload || {}),
    });
  } catch (networkError) {
    return {
      response: { ok: false, status: 0, statusText: "Network Error" },
      result: { error: isTimeoutError(networkError) ? FRIENDLY_TIMEOUT_MESSAGE : `Error de conexión con el servidor: ${networkError?.message || "fetch failed"}` },
    };
  }

  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { error: text || "Respuesta invalida del servidor." };
  }

  return { response, result };
}

export async function adminApiFetch(path, payload = {}) {
  let accessToken;
  try {
    accessToken = await getFreshAccessToken();
  } catch (error) {
    const isExpiredSession = isInvalidRefreshTokenError(error)
      || /sesion expiro|sesión expiró|token|jwt|invalid/i.test(String(error?.message || ""));
    if (isExpiredSession) await clearInvalidSession();
    const status = isRateLimitError(error) ? 429 : isExpiredSession ? 401 : 0;
    const result = {
      code: getApiErrorCode({ status, error }),
      error: getApiErrorMessage({ status, error }),
    };
    return { response: { ok: false, status, statusText: "Authentication Error" }, result };
  }
  let output = await postJson(path, payload, accessToken);

  if (isSessionFailure(output.response, output.result)) {
    let sessionInvalidated = false;
    let retryToken = null;
    try {
      retryToken = await getFreshAccessToken({
        forceRefresh: true,
        rejectedAccessToken: accessToken,
      });
      output = await postJson(path, payload, retryToken);
    } catch (error) {
      const invalidRefresh = isInvalidRefreshTokenError(error)
        || /sesion expiro|sesión expiró|invalid refresh token|refresh token.*not found/i.test(String(error?.message || ""));
      if (invalidRefresh) {
        await clearInvalidSession();
        sessionInvalidated = true;
      }
      const status = isRateLimitError(error) ? 429 : isNetworkFailure(error) ? 0 : 401;
      output = {
        response: { ok: false, status, statusText: status === 429 ? "Too Many Requests" : "Authentication Error" },
        result: {
          code: getApiErrorCode({ status, error }) || (status === 401 ? "SESSION_EXPIRED" : null),
          error: getApiErrorMessage({ status, error }),
        },
      };
    }

    if (!sessionInvalidated && isSessionFailure(output.response, output.result)) {
      // A late 401 for the retry token must not expire a newer session that
      // another request already refreshed. Never issue a second API retry.
      try {
        const latestToken = await getFreshAccessToken();
        if (latestToken === retryToken) {
          await clearInvalidSession();
          output.result = {
            ...output.result,
            code: "SESSION_EXPIRED",
            error: "Tu sesión expiró. Inicia sesión nuevamente.",
          };
        }
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearInvalidSession();
          output.result = {
            ...output.result,
            code: "SESSION_EXPIRED",
            error: "Tu sesión expiró. Inicia sesión nuevamente.",
          };
        }
      }
    }
  }

  if (!output.response.ok && isTimeoutError(output.result)) {
    output.result = { ...output.result, error: FRIENDLY_TIMEOUT_MESSAGE };
  }

  if (!output.response.ok) {
    const backendCode = output.result?.code || null;
    output.result = {
      ...output.result,
      code: backendCode || getApiErrorCode({ status: output.response.status, result: output.result }),
      backendCode,
      error: getApiErrorMessage({ status: output.response.status, result: output.result }),
    };
  }

  return output;
}

export { isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE };
