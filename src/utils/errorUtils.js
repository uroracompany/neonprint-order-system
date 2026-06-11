const TIMEOUT_PATTERNS = [
  "El servicio no respondió a tiempo",
  "La operación tardó más de lo esperado",
  "timeout",
  "timed out",
  "Timeout",
  "TimedOut",
  "Network Error",
  "network error",
  "fetch failed",
  "abort",
  "AbortError",
];

export const FRIENDLY_TIMEOUT_MESSAGE =
  "La operación tardó más de lo esperado en completarse. Por favor, inténtalo nuevamente.";

export function isTimeoutError(err) {
  if (!err) return false;
  const message =
    typeof err === "string"
      ? err
      : err.message || err.error || err.statusText || "";
  return TIMEOUT_PATTERNS.some((p) => message.includes(p));
}

export function getFriendlyError(err) {
  if (isTimeoutError(err)) return FRIENDLY_TIMEOUT_MESSAGE;
  return null;
}
