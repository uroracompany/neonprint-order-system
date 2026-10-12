import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";
import { TEAM_ROLES, buildTeamPerformance } from "./team-performance-analytics.js";

const DATE_FIELDS = ["date_from", "date_to", "compare_from", "compare_to"];

function parseDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validateDates(payload) {
  const values = Object.fromEntries(DATE_FIELDS.map((field) => [field, String(payload?.[field] || "").trim()]));
  const dates = Object.fromEntries(DATE_FIELDS.map((field) => [field, parseDate(values[field])]));
  if (DATE_FIELDS.some((field) => !values[field] || !dates[field])) {
    return { error: "Los cuatro límites del período son obligatorios y deben ser fechas válidas.", code: "TEAM_PERFORMANCE_INVALID_PERIOD" };
  }
  if (dates.date_to <= dates.date_from || dates.compare_to <= dates.compare_from) {
    return { error: "Los rangos de análisis deben tener una fecha final posterior a la inicial.", code: "TEAM_PERFORMANCE_INVALID_RANGE" };
  }
  return { values, dates };
}

export async function handleAdminEmployeeTeamPerformance(payload = {}, env = process.env) {
  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });

  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const validation = validateDates(payload);
  if (validation.error) return jsonResponse(400, validation);

  const { values, dates } = validation;
  const supabaseAdmin = createClient(envResult.supabaseUrl, envResult.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const from = new Date(Math.min(dates.date_from, dates.compare_from));
  const to = new Date(Math.max(dates.date_to, dates.compare_to));

  try {
    const [profilesResult, ordersResult, filesResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,name,email,role,employment_status,deleted_at").in("role", TEAM_ROLES),
      supabaseAdmin.from("orders").select("id,seller_id,created_by,designer_id,client_name,status,order_type,order_design_type,created_at,status_changed_at,return_reason,is_archived_admin").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
      supabaseAdmin.from("order_production_files").select("id,order_id,production_area_code,status,assigned_to,created_by,started_at,in_termination_at,completed_at,created_at").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (ordersResult.error) throw ordersResult.error;
    if (filesResult.error) throw filesResult.error;

    const result = buildTeamPerformance({
      profiles: profilesResult.data || [],
      orders: ordersResult.data || [],
      files: filesResult.data || [],
      previousOrders: ordersResult.data || [],
      previousFiles: filesResult.data || [],
      from: values.date_from,
      to: values.date_to,
      compareFrom: values.compare_from,
      compareTo: values.compare_to,
    });
    return jsonResponse(200, result);
  } catch (error) {
    console.error("employee-team-performance failed", error);
    return jsonResponse(500, { error: "No se pudieron calcular las estadísticas de equipo.", code: "TEAM_PERFORMANCE_FAILED" });
  }
}

export const __private__ = { validateDates };
