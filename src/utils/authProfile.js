import { supabase } from "../../supabaseClient";

// Deduplicate only in-flight reads. Settled results are discarded so another
// login can never reuse profile data from a previous user.
const profilePromises = new Map();
const PROFILE_COLUMNS = "id, name, email, role, employment_status, deleted_at, created_at";
export const PROFILE_REQUEST_TIMEOUT_MS = 10_000;

const createProfileTimeoutError = () => Object.assign(
  new Error("La validación del perfil tardó demasiado."),
  { code: "PROFILE_TIMEOUT", status: 408 },
);

export function getAuthProfile(userId, { timeoutMs = PROFILE_REQUEST_TIMEOUT_MS } = {}) {
  if (!userId) return Promise.resolve(null);
  const existing = profilePromises.get(userId);
  if (existing) return existing;

  let timeoutId;
  const profileRequest = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .single()
    .then(({ data, error }) => {
      if (error) throw error;
      return data || null;
    });
  const timeoutRequest = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(createProfileTimeoutError()),
      Math.max(1, Number(timeoutMs) || PROFILE_REQUEST_TIMEOUT_MS),
    );
  });
  const request = Promise.race([profileRequest, timeoutRequest])
    .finally(() => {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      if (profilePromises.get(userId) === request) profilePromises.delete(userId);
    });

  profilePromises.set(userId, request);
  return request;
}

export function __resetAuthProfileRequests() {
  profilePromises.clear();
}
