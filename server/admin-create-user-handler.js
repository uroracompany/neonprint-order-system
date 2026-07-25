import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import {
  ADMIN_USER_ROLE_SET,
  EMAIL_PATTERN,
  getSupabaseAdminEnv,
  isMissingEmailColumnError,
  jsonResponse,
  normalizeUserProfile,
} from "./admin-user-utils.js";

const PROFILES_EMAIL_MIGRATION = "supabase/20260604_add_profiles_email_for_admin_edit.sql";

const missingProfilesEmailResponse = () => jsonResponse(500, {
  error: `La columna profiles.email no existe. Aplica la migracion ${PROFILES_EMAIL_MIGRATION} antes de crear usuarios.`,
});

export async function handleAdminCreateUser(payload, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
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

  if (!EMAIL_PATTERN.test(email)) {
    return jsonResponse(400, {
      error: "El correo electronico no tiene un formato valido.",
    });
  }

  if (!ADMIN_USER_ROLE_SET.has(role)) {
    return jsonResponse(400, {
      error: "El rol seleccionado no es valido.",
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

  const { data: duplicateProfiles, error: duplicateError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .limit(1);

  if (isMissingEmailColumnError(duplicateError)) {
    return missingProfilesEmailResponse();
  }

  if (duplicateError) {
    return jsonResponse(400, {
      error: `No se pudo validar el correo: ${duplicateError.message}`,
    });
  }

  if (Array.isArray(duplicateProfiles) && duplicateProfiles.length > 0) {
    return jsonResponse(409, {
      error: "Ya existe otro usuario con ese correo electronico.",
    });
  }

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
    email,
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
    user: normalizeUserProfile(null, { id: authUserId, name, email, role, employment_status: true }),
  });
}
