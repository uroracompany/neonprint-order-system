import { createClient } from "@supabase/supabase-js";

const ALLOWED_ROLES = new Set(["admin", "seller", "designer", "quote", "printer", "delivery"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(status, body) {
  return { status, body };
}

function getEnvValue(env, key, fallback) {
  return env[key] || (fallback ? env[fallback] : undefined);
}

export async function handleAdminUpdateUser(payload, env = process.env) {
  const supabaseUrl = getEnvValue(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = getEnvValue(env, "SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [
      !supabaseUrl ? "SUPABASE_URL" : null,
      !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter(Boolean);

    return jsonResponse(500, {
      error: `Falta configurar ${missing.join(" y ")} en el entorno del servidor.`,
    });
  }

  const userId = String(payload?.userId || "").trim();
  const name = String(payload?.name || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const role = String(payload?.role || "").trim();
  const password = String(payload?.password || "").trim();

  if (!userId || !name || !email || !role) {
    return jsonResponse(400, {
      error: "ID, nombre, email y rol son obligatorios.",
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return jsonResponse(400, {
      error: "El correo electrónico no tiene un formato válido.",
    });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return jsonResponse(400, {
      error: "El rol seleccionado no es válido.",
    });
  }

  if (password && password.length < 6) {
    return jsonResponse(400, {
      error: "La contraseña debe tener al menos 6 caracteres.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const duplicateQuery = supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .neq("id", userId)
    .limit(1);

  const { data: duplicateProfiles, error: duplicateError } = await duplicateQuery;

  if (duplicateError) {
    return jsonResponse(400, {
      error: `No se pudo validar el correo: ${duplicateError.message}`,
    });
  }

  if (Array.isArray(duplicateProfiles) && duplicateProfiles.length > 0) {
    return jsonResponse(409, {
      error: "Ya existe otro usuario con ese correo electrónico.",
    });
  }

  const { error: getUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (getUserError) {
    return jsonResponse(404, {
      error: getUserError.message,
    });
  }

  const authPayload = {
    email,
    user_metadata: {
      lastname: name,
      name,
      display_name: name,
    },
  };

  if (password) {
    authPayload.password = password;
  }

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authPayload);

  if (authError) {
    return jsonResponse(400, {
      error: authError.message,
    });
  }

  const profilePayload = {
    name,
    email,
    role,
  };

  const { data: profileData, error: profileError } = await supabaseAdmin
    .from("profiles")
    .update(profilePayload)
    .eq("id", userId)
    .select("id,name,email,role,employment_status")
    .single();

  if (profileError) {
    return jsonResponse(400, {
      error: `Auth fue actualizado, pero no se pudo actualizar el perfil: ${profileError.message}`,
    });
  }

  return jsonResponse(200, {
    message: "Empleado actualizado correctamente.",
    user: {
      id: userId,
      name: profileData?.name || name,
      email: profileData?.email || email,
      role: profileData?.role || role,
      employment_status: profileData?.employment_status,
    },
  });
}
