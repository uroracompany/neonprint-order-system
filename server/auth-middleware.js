import { createClient } from "@supabase/supabase-js";

export function jsonResponse(status, body) {
  return { status, body };
}

export async function verifyAdmin(token, supabaseUrl, anonKey) {
  if (!token) {
    return { authorized: false, error: "Token de autenticación requerido." };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token.replace("Bearer ", ""));

  if (error || !user) {
    return { authorized: false, error: "Token inválido o expirado." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { authorized: false, error: "Se requieren permisos de administrador." };
  }

  return { authorized: true, user };
}
