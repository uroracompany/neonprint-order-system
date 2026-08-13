import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, jsonResponse, normalizeUserProfile } from "./admin-user-utils.js";

const CLOSED_ORDER_STATUSES = new Set(["cancelled", "in_completed", "in_delivered"]);
const CLOSED_FILE_STATUSES = new Set(["completed", "cancelled"]);

const getAdminClient = async (env) => {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult;

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) return { error: jsonResponse(auth.status || 403, { error: auth.error, code: auth.code }) };

  return {
    auth,
    supabaseAdmin: createClient(envResult.supabaseUrl, envResult.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
};

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();
const isOpenOrder = (order) => !CLOSED_ORDER_STATUSES.has(normalizeStatus(order?.status));
const isOpenFile = (file) => !CLOSED_FILE_STATUSES.has(normalizeStatus(file?.status));

const profileSnapshot = (profile) => ({
  id: profile?.id || null,
  name: profile?.name || profile?.email || "Usuario eliminado",
  role: profile?.role || null,
  retired: Boolean(profile?.deleted_at || profile?.employment_status === false),
});

async function loadProfile(supabaseAdmin, userId) {
  return supabaseAdmin
    .from("profiles")
    .select("id,name,email,role,employment_status,deleted_at,deleted_by,deletion_reason,created_at")
    .eq("id", userId)
    .single();
}

async function findOpenResponsibilities(supabaseAdmin, userId) {
  const [ordersResult, filesResult, assignmentsResult] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id,status,seller_id,designer_id,quote_id,production_id,delivery_id")
      .or(`seller_id.eq.${userId},designer_id.eq.${userId},quote_id.eq.${userId},production_id.eq.${userId},delivery_id.eq.${userId}`),
    supabaseAdmin
      .from("order_production_files")
      .select("id,order_id,status,assigned_to")
      .eq("assigned_to", userId),
    supabaseAdmin
      .from("order_production_assignments")
      .select("order_id,production_area_code,assigned_to")
      .eq("assigned_to", userId),
  ]);

  const failure = [ordersResult.error, filesResult.error, assignmentsResult.error].find(Boolean);
  if (failure) throw failure;

  const openOrders = (ordersResult.data || []).filter(isOpenOrder);
  const orderById = new Map(openOrders.map((order) => [order.id, order]));
  const responsibilities = [];

  openOrders.forEach((order) => {
    [
      ["seller", order.seller_id],
      ["designer", order.designer_id],
      ["quote", order.quote_id],
      ["production", order.production_id],
      ["delivery", order.delivery_id],
    ].forEach(([role, profileId]) => {
      if (profileId === userId) responsibilities.push({ type: "order", orderId: order.id, role });
    });
  });

  (filesResult.data || []).filter(isOpenFile).forEach((file) => {
    responsibilities.push({ type: "production_file", fileId: file.id, orderId: file.order_id, role: "production" });
  });

  (assignmentsResult.data || []).forEach((assignment) => {
    if (orderById.has(assignment.order_id)) {
      responsibilities.push({ type: "production_assignment", orderId: assignment.order_id, areaCode: assignment.production_area_code, role: "production" });
    }
  });

  return responsibilities;
}

const validateTarget = (userId) => {
  if (!userId) return jsonResponse(400, { error: "El ID del empleado es obligatorio." });
  return null;
};

export async function handleAdminUserRetirementPreflight(payload = {}, env = process.env) {
  const context = await getAdminClient(env);
  if (context.error) return context.error;
  const userId = String(payload?.userId || "").trim();
  const invalid = validateTarget(userId);
  if (invalid) return invalid;

  const { data: profile, error } = await loadProfile(context.supabaseAdmin, userId);
  if (error || !profile) return jsonResponse(404, { error: "No se encontro el empleado." });

  try {
    const responsibilities = await findOpenResponsibilities(context.supabaseAdmin, userId);
    return jsonResponse(200, {
      user: normalizeUserProfile(profile),
      responsibilities,
      canRetire: responsibilities.length === 0,
    });
  } catch (queryError) {
    return jsonResponse(500, { error: "No se pudieron revisar las responsabilidades activas.", code: "ACTIVE_RESPONSIBILITIES_LOOKUP_FAILED" });
  }
}

export async function handleAdminRetireUser(payload = {}, env = process.env) {
  const context = await getAdminClient(env);
  if (context.error) return context.error;
  const userId = String(payload?.userId || "").trim();
  const invalid = validateTarget(userId);
  if (invalid) return invalid;
  if (context.auth.user.id === userId) return jsonResponse(403, { error: "No puedes darte de baja mientras tienes una sesion iniciada." });

  const { data: profile, error: profileError } = await loadProfile(context.supabaseAdmin, userId);
  if (profileError || !profile) return jsonResponse(404, { error: "No se encontro el empleado." });
  if (profile.deleted_at) return jsonResponse(409, { error: "El empleado ya esta dado de baja." });

  let responsibilities;
  try {
    responsibilities = await findOpenResponsibilities(context.supabaseAdmin, userId);
  } catch (queryError) {
    return jsonResponse(500, { error: "No se pudieron revisar las responsabilidades activas.", code: "ACTIVE_RESPONSIBILITIES_LOOKUP_FAILED" });
  }
  if (responsibilities.length) {
    return jsonResponse(409, {
      error: "No se puede dar de baja a este empleado hasta reasignar su trabajo activo.",
      responsibilities,
    });
  }

  const reason = String(payload?.reason || "").trim() || null;
  const { error: banError } = await context.supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (banError) return jsonResponse(500, { error: "No se pudo revocar el acceso del empleado.", code: "USER_BAN_FAILED" });

  const { data: retired, error: retireError } = await context.supabaseAdmin
    .from("profiles")
    .update({ employment_status: false, deleted_at: new Date().toISOString(), deleted_by: context.auth.user.id, deletion_reason: reason })
    .eq("id", userId)
    .select("id,name,email,role,employment_status,deleted_at,deleted_by,deletion_reason,created_at")
    .single();
  if (retireError) return jsonResponse(500, { error: "No se pudo dar de baja al empleado.", code: "USER_RETIRE_FAILED" });

  await context.supabaseAdmin.from("user_lifecycle_audit").insert({
    action: "retired", actor_id: context.auth.user.id, target_profile_id: userId,
    identity_snapshot: profileSnapshot(profile), reason,
  });

  return jsonResponse(200, { message: "Empleado dado de baja. Su historial y archivos fueron conservados.", user: normalizeUserProfile(retired) });
}

export async function handleAdminRestoreUser(payload = {}, env = process.env) {
  const context = await getAdminClient(env);
  if (context.error) return context.error;
  const userId = String(payload?.userId || "").trim();
  const invalid = validateTarget(userId);
  if (invalid) return invalid;

  const { data: profile, error: profileError } = await loadProfile(context.supabaseAdmin, userId);
  if (profileError || !profile) return jsonResponse(404, { error: "No se encontro el empleado." });

  const { error: unbanError } = await context.supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (unbanError) return jsonResponse(500, { error: "No se pudo restaurar el acceso del empleado.", code: "USER_UNBAN_FAILED" });

  const { data: restored, error: restoreError } = await context.supabaseAdmin
    .from("profiles")
    .update({ employment_status: true, deleted_at: null, deleted_by: null, deletion_reason: null })
    .eq("id", userId)
    .select("id,name,email,role,employment_status,deleted_at,deleted_by,deletion_reason,created_at")
    .single();
  if (restoreError) return jsonResponse(500, { error: "No se pudo restaurar al empleado.", code: "USER_RESTORE_FAILED" });

  await context.supabaseAdmin.from("user_lifecycle_audit").insert({
    action: "restored", actor_id: context.auth.user.id, target_profile_id: userId,
    identity_snapshot: profileSnapshot(profile),
  });

  return jsonResponse(200, { message: "Empleado restaurado correctamente.", user: normalizeUserProfile(restored) });
}

async function updateClientLifecycle(payload, env, action) {
  const context = await getAdminClient(env);
  if (context.error) return context.error;
  const clientId = String(payload?.clientId || "").trim();
  if (!clientId) return jsonResponse(400, { error: "El ID del cliente es obligatorio." });

  const { data: client, error: clientError } = await context.supabaseAdmin
    .from("clients").select("id,name,phone,email,deleted_at").eq("id", clientId).single();
  if (clientError || !client) return jsonResponse(404, { error: "No se encontro el cliente." });

  const isRetiring = action === "retired";
  if (isRetiring === Boolean(client.deleted_at)) {
    return jsonResponse(409, { error: isRetiring ? "El cliente ya esta dado de baja." : "El cliente ya esta activo." });
  }

  const reason = String(payload?.reason || "").trim() || null;
  const { data, error } = await context.supabaseAdmin
    .from("clients")
    .update(isRetiring
      ? { deleted_at: new Date().toISOString(), deleted_by: context.auth.user.id, deletion_reason: reason }
      : { deleted_at: null, deleted_by: null, deletion_reason: null })
    .eq("id", clientId)
    .select("id,name,phone,email,deleted_at,deleted_by,deletion_reason")
    .single();
  if (error) return jsonResponse(500, { error: "No se pudo actualizar el cliente.", code: "CLIENT_RETIRE_UPDATE_FAILED" });

  await context.supabaseAdmin.from("user_lifecycle_audit").insert({
    action, actor_id: context.auth.user.id, target_client_id: clientId,
    identity_snapshot: { id: client.id, name: client.name || "Cliente eliminado", retired: isRetiring }, reason,
  });

  return jsonResponse(200, { message: isRetiring ? "Cliente dado de baja. Sus ordenes permanecen disponibles." : "Cliente restaurado correctamente.", client: data });
}

export const handleAdminRetireClient = (payload, env) => updateClientLifecycle(payload, env, "retired");
export const handleAdminRestoreClient = (payload, env) => updateClientLifecycle(payload, env, "restored");
