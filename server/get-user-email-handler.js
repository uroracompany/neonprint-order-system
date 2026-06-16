import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";

export async function handleGetUserEmail(payload, env = {}) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
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
    return jsonResponse(400, {
      error: authError.message,
    });
  }

  return jsonResponse(200, {
    email: authData?.user?.email || null,
  });
}
