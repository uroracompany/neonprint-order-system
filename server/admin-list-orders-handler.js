import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv, jsonResponse } from "./admin-user-utils.js";

const ORDER_ASSIGNMENT_FIELDS = [
  "created_by",
  "seller_id",
  "designer_id",
  "quote_id",
  "production_id",
  "delivery_id",
];

const clampPageSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return 500;
  return Math.min(Math.max(size, 1), 1000);
};

const sanitizeSearch = (value) =>
  String(value || "")
    .replace(/[,%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const debugOrders = (message, details = {}, env = process.env) => {
  if (env.ADMIN_ORDERS_DEBUG !== "1") return;
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/token|secret|key|email/i.test(key))
  );
  console.warn(`[admin-orders] ${message}`, safeDetails);
};

const getDateStart = (dateFilter, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (dateFilter === "today") return startOfToday.toISOString();

  if (dateFilter === "week") {
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    return startOfWeek.toISOString();
  }

  return null;
};

const normalizeOrder = (order) => ({
  ...order,
  is_archived_admin: Boolean(order?.is_archived_admin),
});

export async function handleAdminListOrders(payload = {}, env = process.env) {
  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;
  const { supabaseUrl, serviceRoleKey } = envResult;

  debugOrders("request", {
    page: payload?.page,
    pageSize: payload?.pageSize,
    status: payload?.status,
    archive: payload?.archive,
    hasSearch: Boolean(payload?.search),
    hasClientId: Boolean(payload?.clientId),
    hasOwnerId: Boolean(payload?.ownerId),
    dateFilter: payload?.dateFilter,
  }, env);

  const auth = await requireAdmin(env.authHeader, env);
  if (!auth.authorized) {
    debugOrders("unauthorized", { status: auth.status }, env);
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const page = Math.max(Number.parseInt(payload?.page, 10) || 1, 1);
  const pageSize = clampPageSize(payload?.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const status = String(payload?.status || "all").trim();
  const archive = String(payload?.archive || "all").trim();
  const clientId = String(payload?.clientId || "").trim();
  const ownerId = String(payload?.ownerId || "").trim();
  const dateFilter = String(payload?.dateFilter || "all").trim();
  const search = sanitizeSearch(payload?.search);

  let query = supabaseAdmin
    .from("orders")
    .select("*", { count: "exact" });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (archive === "archived") {
    query = query.eq("is_archived_admin", true);
  } else if (archive === "active") {
    query = query.or("is_archived_admin.is.false,is_archived_admin.is.null");
  }

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  if (ownerId) {
    query = query.or(ORDER_ASSIGNMENT_FIELDS.map((field) => `${field}.eq.${ownerId}`).join(","));
  }

  const dateStart = getDateStart(dateFilter, env.now);
  if (dateStart) {
    query = query.gte("created_at", dateStart);
  }

  if (search) {
    query = query.or(`client_name.ilike.%${search}%,description.ilike.%${search}%,material.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    debugOrders("query-error", { message: error.message, code: error.code }, env);
    return jsonResponse(400, {
      error: `No se pudieron cargar ordenes: ${error.message}`,
    });
  }

  const orders = Array.isArray(data) ? data.map((order) => normalizeOrder(order)) : [];
  debugOrders("response", { count: orders.length, total: count || 0, page, pageSize }, env);

  return jsonResponse(200, {
    orders,
    page,
    pageSize,
    total: count || 0,
  });
}
