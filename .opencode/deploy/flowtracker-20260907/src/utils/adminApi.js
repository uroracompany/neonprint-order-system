import { expireAuthSession, getFreshAccessToken } from "./authManager";
import { isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE } from "./errorUtils";
import { getApiErrorCode, getApiErrorMessage } from "./authFeedback";

const SESSION_FAILURE_CODES = new Set(["SESSION_EXPIRED", "AUTH_REQUIRED"]);

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
    const isExpiredSession = /sesion expiro|sesión expiró|token|jwt|invalid/i.test(String(error?.message || ""));
    if (isExpiredSession) await clearInvalidSession();
    const status = isExpiredSession ? 401 : 0;
    const result = {
      code: getApiErrorCode({ status, error }),
      error: getApiErrorMessage({ status, error }),
    };
    return { response: { ok: false, status, statusText: "Authentication Error" }, result };
  }
  let output = await postJson(path, payload, accessToken);

  if (isSessionFailure(output.response, output.result)) {
    let sessionInvalidated = false;
    try {
      accessToken = await getFreshAccessToken({ forceRefresh: true });
      output = await postJson(path, payload, accessToken);
    } catch {
      await clearInvalidSession();
      sessionInvalidated = true;
      output = {
        response: { ok: false, status: 401, statusText: "Authentication Error" },
        result: { code: "SESSION_EXPIRED", error: "Tu sesion expiro. Inicia sesion nuevamente." },
      };
    }

    if (!sessionInvalidated && isSessionFailure(output.response, output.result)) {
      await clearInvalidSession();
      output.result = {
        ...output.result,
        code: "SESSION_EXPIRED",
        error: "Tu sesion expiro. Inicia sesion nuevamente.",
      };
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
