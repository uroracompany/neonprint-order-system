import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";

export async function handleAdminDeleteUser(payload, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const userId = String(payload?.userId || "").trim();

  if (!userId) {
    return jsonResponse(400, { error: "El ID del usuario es obligatorio." });
  }

  if (auth.user?.id === userId) {
    return jsonResponse(403, {
      error: "No puedes eliminar tu propia cuenta de administrador mientras tengas la sesión iniciada.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    return jsonResponse(400, {
      error: `No se pudo eliminar el usuario: ${error.message}`,
    });
  }

  return jsonResponse(200, {
    message: "Usuario eliminado correctamente.",
  });
}
