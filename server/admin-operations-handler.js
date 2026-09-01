import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";

// Aggregate-only health data for Administration.  It deliberately returns no
// object key, receipt, token, user email or error payload.
export async function handleAdminOperationsSummary(payload = {}, env = process.env) {
  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  if (!payload || Array.isArray(payload) || Object.keys(payload).length > 0) {
    return jsonResponse(400, { error: "Esta consulta no acepta parámetros adicionales." });
  }
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const supabaseAdmin = createClient(envResult.supabaseUrl, envResult.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [pending, processing, cursors] = await Promise.all([
    supabaseAdmin.from("order_asset_deletion_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("order_asset_deletion_outbox").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabaseAdmin.from("order_asset_reconciliation_cursors").select("provider,bucket,updated_at"),
  ]);
  if (pending.error || processing.error || cursors.error) {
    return internalError("No se pudo obtener el estado operativo.", "OPERATIONS_SUMMARY_FAILED");
  }
  return jsonResponse(200, {
    generated_at: new Date().toISOString(),
    outbox: { pending: pending.count || 0, processing: processing.count || 0 },
    reconciliation: (cursors.data || []).map((cursor) => ({
      provider: cursor.provider,
      bucket: cursor.bucket,
      updated_at: cursor.updated_at,
    })),
  });
}
