import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";
import { isMissingColumnOrRelationError } from "./admin-employee-utils.js";

const REFERENCE_CHECKS = [
  { table: "orders", fields: ["seller_id", "created_by", "designer_id", "quote_id", "quotation_id", "quote_user_id", "production_id", "delivery_id"] },
  { table: "order_production_files", fields: ["assigned_to", "created_by", "updated_by"] },
  { table: "order_production_assignments", fields: ["assigned_to", "assigned_by"] },
  { table: "order_production_user_archives", fields: ["user_id"] },
  { table: "order_event_reviews", fields: ["user_id", "reviewed_by"] },
  { table: "admin_order_operation_logs", fields: ["actor_id"] },
  { table: "admin_order_operation_requests", fields: ["requested_by", "updated_by"] },
  { table: "credit_custom_reminders", fields: ["created_by"] },
  { table: "credit_payment_receivables", fields: ["created_by"] },
];

async function countReferencesForField(supabaseAdmin, table, field, userId) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select(field, { count: "exact", head: true })
    .eq(field, userId);

  if (error && isMissingColumnOrRelationError(error)) return 0;
  if (error) throw error;
  return count || 0;
}

async function findEmployeeReferences(supabaseAdmin, userId) {
  const references = [];

  for (const check of REFERENCE_CHECKS) {
    for (const field of check.fields) {
      const count = await countReferencesForField(supabaseAdmin, check.table, field, userId);
      if (count > 0) references.push({ table: check.table, field, count });
    }
  }

  return references;
}

export async function handleAdminDeleteUser(payload, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  }

  const userId = String(payload?.userId || "").trim();

  if (!userId) {
    return jsonResponse(400, { error: "El ID del usuario es obligatorio." });
  }

  if (auth.user?.id === userId) {
    return jsonResponse(403, {
      error: "No puedes eliminar tu propia cuenta de administrador mientras tengas la sesión iniciada.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let references = [];
  try {
    references = await findEmployeeReferences(supabaseAdmin, userId);
  } catch (referenceError) {
    return jsonResponse(400, {
      error: `No se pudieron validar las referencias del empleado: ${referenceError.message}`,
    });
  }

  if (references.length > 0) {
    const totalReferences = references.reduce((sum, item) => sum + item.count, 0);
    return jsonResponse(409, {
      error: `No se puede eliminar este empleado porque tiene ${totalReferences} referencia(s) de negocio. Desactivalo para conservar la integridad historica.`,
      references,
    });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    return jsonResponse(400, {
      error: `No se pudo eliminar el usuario: ${error.message}`,
    });
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (profileError) {
    return jsonResponse(400, {
      error: `El usuario fue eliminado de autenticacion, pero no se pudo limpiar el perfil: ${profileError.message}`,
    });
  }

  return jsonResponse(200, {
    message: "Usuario eliminado correctamente.",
  });
}
