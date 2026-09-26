import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";
import { requireAdmin } from "./auth-middleware.js";

export async function handleGetUserEmail(payload, env = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;

  const auth = await requireAdmin(env.authHeader || "", env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  }

  const { supabaseUrl, serviceRoleKey } = envResult;

  const userId = payload?.userId;
  if (!userId) {
    return jsonResponse(400, {
      error: "Se requiere el ID del usuario.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (authError) {
    return internalError("No se pudo consultar el correo del usuario.", "USER_EMAIL_LOOKUP_FAILED");
  }

  return jsonResponse(200, {
    email: authData?.user?.email || null,
  });
}
