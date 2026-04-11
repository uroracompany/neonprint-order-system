import { createClient } from "@supabase/supabase-js";

function jsonResponse(status, body) {
  return { status, body };
}

function getEnvValue(env, key, fallback) {
  return env[key] || (fallback ? env[fallback] : undefined);
}

export async function handleGetUserEmail(payload, env = {}) {
  // Support both VITE_ prefix in dev and direct key in production
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  console.log("📧 GetUserEmail handler called");
  console.log("📋 Payload:", payload);
  console.log("🔑 Has URL:", !!supabaseUrl);
  console.log("🔑 Has Key:", !!serviceRoleKey);

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

  console.log("🔄 Fetching user:", userId);
  
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);

  console.log(" result:", { data: !!authData, error: authError });

  if (authError) {
    return jsonResponse(400, {
      error: authError.message,
    });
  }

  return jsonResponse(200, {
    email: authData?.user?.email || null,
  });
}