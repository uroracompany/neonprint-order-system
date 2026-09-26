import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv, internalError, jsonResponse } from "./admin-user-utils.js";

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This handler deliberately uses the server credential: the public tracking
// function itself is private, so anonymous clients can never invoke it through
// PostgREST.  A malformed or unknown token receives the same response.
export async function handlePublicTracking(payload = {}, env = process.env) {
  const token = String(payload?.token || "").trim();
  if (!TOKEN_PATTERN.test(token)) return jsonResponse(404, { error: "No se encontro la orden." });

  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const supabaseAdmin = createClient(envResult.supabaseUrl, envResult.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabaseAdmin.rpc("get_public_order_tracking", { p_token: token });
  if (error) return internalError("No se pudo consultar el seguimiento.", "PUBLIC_TRACKING_LOOKUP_FAILED");
  const tracking = Array.isArray(data) ? data[0] : data;
  if (!tracking || typeof tracking !== "object") return jsonResponse(404, { error: "No se encontro la orden." });
  return jsonResponse(200, tracking);
}
