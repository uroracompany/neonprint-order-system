import { supabase } from "../../supabaseClient";

// Deduplicate only in-flight reads. Settled results are discarded so another
// login can never reuse profile data from a previous user.
const profilePromises = new Map();
const PROFILE_COLUMNS = "id, name, email, role, employment_status, deleted_at, created_at";

export function getAuthProfile(userId) {
  if (!userId) return Promise.resolve(null);
  const existing = profilePromises.get(userId);
  if (existing) return existing;

  const request = supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .single()
    .then(({ data, error }) => {
      if (error) throw error;
      return data || null;
    })
    .finally(() => {
      if (profilePromises.get(userId) === request) profilePromises.delete(userId);
    });

  profilePromises.set(userId, request);
  return request;
}

export function __resetAuthProfileRequests() {
  profilePromises.clear();
}
