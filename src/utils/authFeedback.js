export const AUTH_NOTICE = {
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  PROFILE_UNAVAILABLE: "PROFILE_UNAVAILABLE",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  MFA_REQUIRED: "MFA_REQUIRED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  INTERNAL: "INTERNAL",
};

const MESSAGES = {
  [AUTH_NOTICE.SESSION_EXPIRED]: "Tu sesión expiró. Inicia sesión nuevamente.",
  [AUTH_NOTICE.AUTH_REQUIRED]: "Inicia sesión para continuar.",
  [AUTH_NOTICE.FORBIDDEN]: "Tu usuario no tiene permisos para entrar a esa sección.",
  [AUTH_NOTICE.PROFILE_UNAVAILABLE]: "No pudimos validar tu perfil de acceso. Intenta nuevamente o contacta al administrador.",
  [AUTH_NOTICE.ACCOUNT_INACTIVE]: "Tu cuenta está desactivada. Contacta al administrador.",
  [AUTH_NOTICE.MFA_REQUIRED]: "Verifica el segundo factor para continuar.",
  [AUTH_NOTICE.INVALID_CREDENTIALS]: "Correo o contraseña incorrectos.",
  [AUTH_NOTICE.NETWORK]: "No pudimos conectarnos. Revisa tu conexión e inténtalo nuevamente.",
  [AUTH_NOTICE.TIMEOUT]: "La operación tardó más de lo esperado. Inténtalo nuevamente.",
  [AUTH_NOTICE.INTERNAL]: "Ocurrió un problema. Inténtalo nuevamente en unos minutos.",
};

export const getAuthFeedbackMessage = (code) => MESSAGES[code] || MESSAGES[AUTH_NOTICE.INTERNAL];

export const createAuthError = (code, message) => Object.assign(
  new Error(message || getAuthFeedbackMessage(code)),
  { code }
);

export const isNetworkError = (error) => /network|fetch failed|failed to fetch|connection|conexi.n/i
  .test(String(error?.message || error || ""));

export const isTimeoutError = (error) => /timeout|timed out|tardó más de lo esperado/i
  .test(String(error?.message || error || ""));

export function getLoginErrorCode(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  const status = Number(error?.status);

  if (Object.values(AUTH_NOTICE).includes(code)) return code;
  if (/profile_not_available|perfil/i.test(message)) return AUTH_NOTICE.PROFILE_UNAVAILABLE;
  if (/mfa_cancelled|second factor|segundo factor/i.test(message)) return AUTH_NOTICE.MFA_REQUIRED;
  if (/refresh_token|session|sesion|token|jwt/i.test(message)) return AUTH_NOTICE.SESSION_EXPIRED;
  if (isTimeoutError(error)) return AUTH_NOTICE.TIMEOUT;
  if (isNetworkError(error)) return AUTH_NOTICE.NETWORK;
  if ([400, 401, 404, 422].includes(status) || /invalid login credentials|invalid.*credential/i.test(message)) {
    return AUTH_NOTICE.INVALID_CREDENTIALS;
  }
  return AUTH_NOTICE.INTERNAL;
}

export function getApiErrorCode({ status, result, error } = {}) {
  const explicitCode = String(result?.code || error?.code || "").toUpperCase();
  if (Object.values(AUTH_NOTICE).includes(explicitCode)) return explicitCode;
  if (status === 401) return AUTH_NOTICE.SESSION_EXPIRED;
  if (status === 403) return AUTH_NOTICE.FORBIDDEN;
  if (status === 0) return isTimeoutError(result || error) ? AUTH_NOTICE.TIMEOUT : AUTH_NOTICE.NETWORK;
  if (status >= 500) return AUTH_NOTICE.INTERNAL;
  return null;
}

export function getApiErrorMessage({ status, result, error } = {}) {
  const code = getApiErrorCode({ status, result, error });
  if (code) return getAuthFeedbackMessage(code);
  return String(result?.error || result?.message || error?.message || MESSAGES[AUTH_NOTICE.INTERNAL]);
}
