import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";

export async function handleChangeUserPassword(payload, env = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const { userId, newPassword } = payload;

  if (!userId || !newPassword) {
    return jsonResponse(400, { error: "ID de usuario y contraseña requeridos" });
  }

  if (newPassword.length < 6) {
    return jsonResponse(400, { error: "Mínimo 6 caracteres" });
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

  return jsonResponse(200, { message: "Contraseña actualizada correctamente." });
}
