import { createClient } from "@supabase/supabase-js";

function jsonResponse(status, body) {
  return { status, body };
}

function getEnvValue(env, key, fallback) {
  return env[key] || (fallback ? env[fallback] : undefined);
}

export async function handleAdminCreateUser(payload, env = process.env) {
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

  const name = String(payload?.name || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "").trim();
  const role = String(payload?.role || "").trim();

  if (!name || !email || !password || !role) {
    return jsonResponse(400, {
      error: "Nombre, email, contraseña y rol son obligatorios.",
    });
  }

  if (password.length < 6) {
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

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      lastname: name,
      name,
      display_name: name,
    },
  });

  if (authError) {
    return jsonResponse(400, {
      error: authError.message,
    });
  }

  const authUserId = authData?.user?.id;
  if (!authUserId) {
    return jsonResponse(500, {
      error: "No se recibió el id del usuario creado en autenticación.",
    });
  }

  const profilePayload = {
    id: authUserId,
    name,
    role,
    employment_status: true,
  };

  const { error: profileError } = await supabaseAdmin.from("profiles").insert([profilePayload]);

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return jsonResponse(400, {
      error: `No se pudo crear el perfil: ${profileError.message}`,
    });
  }

  return jsonResponse(200, {
    message: "Usuario creado correctamente.",
    user: {
      id: authUserId,
      name,
      email,
      role,
      employment_status: true,
    },
  });
}
