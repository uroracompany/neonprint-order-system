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
  error: `La columna profiles.email no existe. Aplica la migracion ${PROFILES_EMAIL_MIGRATION} antes de editar usuarios.`,
});

export async function handleAdminUpdateUser(payload, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
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

  if (!ADMIN_USER_ROLE_SET.has(role)) {
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

  if (isMissingEmailColumnError(duplicateError)) {
    return missingProfilesEmailResponse();
  }

  if (duplicateError) {
    return jsonResponse(400, {
      error: `No se pudo validar el correo: ${duplicateError.message}`,
    });
  }

  if (!duplicateError && Array.isArray(duplicateProfiles) && duplicateProfiles.length > 0) {
    return jsonResponse(409, {
      error: "Ya existe otro usuario con ese correo electrónico.",
    });
  }

  const { data: previousProfile, error: previousProfileError } = await supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status")
    .eq("id", userId)
    .single();

  if (isMissingEmailColumnError(previousProfileError)) {
    return missingProfilesEmailResponse();
  }

  if (previousProfileError || !previousProfile) {
    return jsonResponse(404, {
      error: previousProfileError?.message || "No se encontro el perfil del usuario.",
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

  if (isMissingEmailColumnError(profileError)) {
    return missingProfilesEmailResponse();
  }

  if (profileError) {
    return jsonResponse(400, {
      error: `No se pudo actualizar el perfil: ${profileError.message}`,
    });
  }

  if (password) {
    authPayload.password = password;
  }

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authPayload);

  if (authError) {
    const rollbackPayload = {
      name: previousProfile.name,
      email: previousProfile.email,
      role: previousProfile.role,
    };

    const { error: rollbackError } = await supabaseAdmin
      .from("profiles")
      .update(rollbackPayload)
      .eq("id", userId);

    return jsonResponse(400, {
      error: rollbackError
        ? `No se pudo actualizar el usuario en autenticacion: ${authError.message}. Ademas no se pudo restaurar el perfil: ${rollbackError.message}`
        : `No se pudo actualizar el usuario en autenticacion: ${authError.message}. El perfil fue restaurado a sus valores anteriores.`,
    });
  }

  return jsonResponse(200, {
    message: "Empleado actualizado correctamente.",
    user: normalizeUserProfile(profileData, { id: userId, name, email, role }),
  });
}
