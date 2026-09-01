import { supabase } from "../../supabaseClient";

// MFA reads are shared while in flight, but never cached across sessions.
const mfaPromises = new Map();

export function getAuthMfaState(userId, { force = false } = {}) {
  if (!userId) return Promise.resolve({ currentLevel: null, factors: {} });
  // A successful challenge can complete while an earlier startup read is
  // still in flight. Start a fresh read in that case so the caller cannot
  // reuse the pre-verification assurance level.
  if (force) mfaPromises.delete(userId);
  const existing = mfaPromises.get(userId);
  if (existing) return existing;

  const request = Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]).then(([aalResult, factorsResult]) => {
    if (aalResult.error) throw aalResult.error;
    if (factorsResult.error) throw factorsResult.error;
    return {
      currentLevel: aalResult.data?.currentLevel || null,
      factors: factorsResult.data || {},
    };
  }).finally(() => {
    if (mfaPromises.get(userId) === request) mfaPromises.delete(userId);
  });

  mfaPromises.set(userId, request);
  return request;
}

export function __resetAuthMfaRequests() {
  mfaPromises.clear();
}
