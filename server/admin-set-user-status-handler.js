import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import {
  getSupabaseAdminEnv,
  isMissingEmailColumnError,
  jsonResponse,
  normalizeUserProfile,
} from "./admin-user-utils.js";

export async function handleAdminSetUserStatus(payload, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const userId = String(payload?.userId || "").trim();
  const nextStatus = payload?.employment_status;

  if (!userId || typeof nextStatus !== "boolean") {
    return jsonResponse(400, {
      error: "ID de usuario y estado laboral booleano son obligatorios.",
    });
  }

  if (!nextStatus && auth.user?.id === userId) {
    return jsonResponse(403, {
      error: "No puedes desactivar tu propia cuenta de administrador.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ employment_status: nextStatus })
    .eq("id", userId)
    .select("id,name,email,role,employment_status")
    .single();

  if (isMissingEmailColumnError(error)) {
    const fallback = await supabaseAdmin
      .from("profiles")
      .update({ employment_status: nextStatus })
      .eq("id", userId)
      .select("id,name,role,employment_status")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return jsonResponse(400, {
      error: `No se pudo actualizar el estado del usuario: ${error.message}`,
    });
  }

  return jsonResponse(200, {
    message: nextStatus ? "Usuario activado correctamente." : "Usuario desactivado correctamente.",
    user: normalizeUserProfile(data, { id: userId, employment_status: nextStatus }),
  });
}
