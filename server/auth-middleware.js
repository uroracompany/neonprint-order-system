import { createClient } from "@supabase/supabase-js";

export function jsonResponse(status, body) {
  return { status, body };
}

function getBearerToken(token = "") {
  return String(token).replace(/^Bearer\s+/i, "").trim();
}

function debugAuth(message, details = {}, env = process.env) {
  if (env.ADMIN_AUTH_DEBUG !== "1") return;
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/token|secret|key|email/i.test(key))
  );
  console.warn(`[admin-auth] ${message}`, safeDetails);
}

function isAuthConnectivityError(error) {
  const message = String(error?.message || "");
  return /fetch failed|network|timeout|certificate|TLS|SSL/i.test(message);
}

export async function verifyAdmin(token, supabaseUrl, _anonKey, serviceRoleKey = "", env = process.env) {
  const accessToken = getBearerToken(token);

  if (!accessToken) {
    debugAuth("missing-token", {}, env);
    return { authorized: false, status: 401, error: "Token de autenticacion requerido." };
  }

  if (!supabaseUrl || !serviceRoleKey) {
    debugAuth("missing-config", { hasUrl: Boolean(supabaseUrl), hasServiceRole: Boolean(serviceRoleKey) }, env);
    return { authorized: false, status: 500, error: "Configuracion de Supabase incompleta." };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  const user = authData?.user;

  if (authError && isAuthConnectivityError(authError)) {
    debugAuth("auth-connectivity-error", { authError: authError?.message }, env);
    return {
      authorized: false,
      status: 503,
      error: "No se pudo validar la sesion con Supabase Auth. Revisa la conexion TLS/certificados del servidor local.",
    };
  }

  if (authError || !user?.id) {
    debugAuth("invalid-token", { authError: authError?.message }, env);
    return { authorized: false, status: 401, error: "Tu sesion expiro o no es valida. Inicia sesion nuevamente." };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    debugAuth("profile-not-found", { userId: user.id, profileError: profileError?.message }, env);
    return { authorized: false, status: 403, error: "Se requieren permisos de administrador." };
  }

  if (profile.role !== "admin") {
    debugAuth("not-admin", { userId: user.id, role: profile.role }, env);
    return { authorized: false, status: 403, error: "Se requieren permisos de administrador." };
  }

  debugAuth("authorized-admin", { userId: user.id }, env);
  return { authorized: true, user, profile };
}

export async function requireAdmin(authHeader = "", env = process.env) {
  return verifyAdmin(
    authHeader,
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env
  );
}
