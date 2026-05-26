import { createClient } from "@supabase/supabase-js";

function jsonResponse(status, body) {
  return { status, body };
}

export async function handleGetUserEmail(payload, env = {}) {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      error: "Configuración de Supabase incompleta.",
    });
  }

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
