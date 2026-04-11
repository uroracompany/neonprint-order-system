import { createClient } from "@supabase/supabase-js";

function jsonResponse(status, body) {
  return { status, body };
}

export async function handleChangeUserPassword(payload, env = {}) {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Falta SUPABASE_SERVICE_ROLE_KEY" });
  }

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