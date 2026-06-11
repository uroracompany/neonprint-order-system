import { getFreshAccessToken, signOutAuth } from "./authManager";
import { isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE } from "./errorUtils";

const isTokenError = (result) =>
  /token|jwt|expir|invalid/i.test(String(result?.error || result?.message || ""));

async function clearInvalidAdminSession() {
  try {
    await signOutAuth();
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
  let accessToken = await getFreshAccessToken();
  let output = await postJson(path, payload, accessToken);

  if (output.response.status === 401 && isTokenError(output.result)) {
    accessToken = await getFreshAccessToken({ forceRefresh: true });
    output = await postJson(path, payload, accessToken);

    if (output.response.status === 401 && isTokenError(output.result)) {
      await clearInvalidAdminSession();
      output.result = {
        ...output.result,
        error: "Tu sesion ya no es valida. Cierra sesion e inicia sesion nuevamente.",
      };
    }
  }

  if (!output.response.ok && isTimeoutError(output.result)) {
    output.result = { ...output.result, error: FRIENDLY_TIMEOUT_MESSAGE };
  }

  return output;
}

export { isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE };
