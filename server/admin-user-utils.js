export const ADMIN_USER_ROLES = [
  "admin",
  "seller",
  "designer",
  "quote",
  "printer",
  "digital_producer",
  "dtf_producer",
  "ploteo_producer",
  "delivery",
];

export const ADMIN_USER_ROLE_SET = new Set(ADMIN_USER_ROLES);

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export function getPasswordPolicyError(password) {
  const value = String(password || "");

  if (value.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `La contrasena debe tener al menos ${MIN_ADMIN_PASSWORD_LENGTH} caracteres.`;
  }

  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return "La contrasena debe incluir mayusculas, minusculas y numeros.";
  }

  return null;
}

export function jsonResponse(status, body) {
  return { status, body };
}

export function getEnvValue(env, key, fallback) {
  return env[key] || (fallback ? env[fallback] : undefined);
}

export function getSupabaseAdminEnv(env) {
  const supabaseUrl = getEnvValue(env, "SUPABASE_URL");
  const serviceRoleKey = getEnvValue(env, "SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl ? "SUPABASE_URL" : null,
      !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter(Boolean);

    return {
      error: jsonResponse(500, {
        error: `Falta configurar ${missing.join(" y ")} en el entorno del servidor.`,
      }),
    };
  }

  return { supabaseUrl, serviceRoleKey };
}

export function isMissingEmailColumnError(error) {
  return error?.code === "42703" || /column .*email/i.test(error?.message || "");
}

export function normalizeUserProfile(profile, fallback = {}) {
  const src = profile || fallback;
  if (!src || !src.id) return null;

  return {
    id: src.id,
    name: src.name || "",
    email: src.email || "",
    role: src.role || "",
    employment_status: src.employment_status ?? true,
    created_at: src.created_at || null,
  };
}
