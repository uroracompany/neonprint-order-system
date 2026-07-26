import { createClient } from "@supabase/supabase-js";
import { getPasswordPolicyError, getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";

export async function handleChangeUserPassword(payload, env = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
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
    return jsonResponse(400, { error: error.message });
  }

  return jsonResponse(200, { message: "Contrasena actualizada correctamente." });
}
