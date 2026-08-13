import { createClient } from "@supabase/supabase-js";
import { getPasswordPolicyError, getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";
import { requireAdmin } from "./auth-middleware.js";

export async function handleChangeUserPassword(payload, env = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;

  const auth = await requireAdmin(env.authHeader || "", env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  }

  const { supabaseUrl, serviceRoleKey } = envResult;

  const userId = String(payload?.userId || "").trim();
  const newPassword = payload?.newPassword === undefined ? "" : String(payload.newPassword);

  if (!userId || !newPassword) {
    return jsonResponse(400, { error: "ID de usuario y contrasena requeridos." });
  }

  const passwordPolicyError = getPasswordPolicyError(newPassword);
  if (passwordPolicyError) {
    return jsonResponse(400, { error: passwordPolicyError });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) {
    return internalError("No se pudo actualizar la contrasena del usuario.", "USER_PASSWORD_UPDATE_FAILED");
  }

  return jsonResponse(200, { message: "Contrasena actualizada correctamente." });
}
