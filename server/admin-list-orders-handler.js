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

// Keep the admin list payload explicit. These fields cover the table, filters,
// actions and the existing order detail/edit flows without pulling legacy
// columns that are not consumed by the dashboard list.
const ADMIN_ORDER_LIST_SELECT = [
  "id",
  "client_name",
  "description",
  "material",
  "size",
  "quantity",
  "price",
  "status",
  "payment_status",
  "created_at",
  "created_by",
  "designer_id",
  "production_id",
  "delivery_id",
  "order_type",
  "seller_id",
  "quote_id",
  "preview_image",
  "client_contact",
  "delivery_date",
  "order_file_url",
  "order_design_type",
  "order_code",
  "is_archived",
  "termination_type",
  "is_archived_designer",
  "is_archived_quote",
  "invoice_payment",
  "is_archived_admin",
  "return_reason",
  "returned_to_designer_at",
  "cancellation_reason",
  "updated_at",
  "updated_by",
  "is_archived_delivery",
  "tracking_token",
  "is_archived_production",
  "client_id",
  "reference_images",
  "invoice_number",
  "invoice_assignment_mode",
  "last_admin_intervention_at",
  "last_admin_intervention_by",
  "last_admin_intervention_kind",
  "operational_status",
  "blocked_reason_category",
  "blocked_reason_detail",
  "blocked_owner_id",
  "blocked_by",
  "blocked_at",
  "blocked_expected_resolution_at",
  "status_changed_at",
  "cancelled_from_status",
  "cancelled_at",
  "cancelled_by",
  "commercial_review_required",
  "delivered_at",
  "delivery_note",
].join(",");

const clampPageSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return 50;
  return Math.min(Math.max(size, 1), 100);
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

const countActiveOverviewOrders = async ({ supabaseAdmin, configure = (query) => query }) => {
  let query = supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .or("is_archived_admin.is.false,is_archived_admin.is.null");
  query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
};

const loadGlobalOrderOverview = async ({ supabaseAdmin }) => {
  const [total, pending, quote, design, production, delivered, completed, active, priorityActive, needsReview] = await Promise.all([
    countActiveOverviewOrders({ supabaseAdmin }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "Pending") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "in_Quote") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "in_Design") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "in_Production") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "in_Delivered") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("status", "in_Completed") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.not("status", "in", "(in_Completed,in_Delivered,cancelled)") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.eq("order_type", "orden 911").not("status", "in", "(in_Completed,in_Delivered,cancelled)") }),
    countActiveOverviewOrders({ supabaseAdmin, configure: (query) => query.or("operational_status.eq.blocked,commercial_review_required.eq.true") }),
  ]);
  return { total, pending, quote, design, production, delivered, completed, active, priority_active: priorityActive, needs_review: needsReview };
};

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
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
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
  const intervention = String(payload?.intervention || "all").trim();
  const operational = String(payload?.operational || "all").trim();
  const search = sanitizeSearch(payload?.search);

  let query = supabaseAdmin
    .from("orders")
    .select(ADMIN_ORDER_LIST_SELECT, { count: "exact" });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (archive === "archived") {
    query = query.eq("is_archived_admin", true);
  } else if (archive === "active") {
    query = query.or("is_archived_admin.is.false,is_archived_admin.is.null");
  }

  if (payload?.withoutClient === true) {
    query = query.is("client_id", null);
  } else if (clientId) {
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
    query = query.or(`client_name.ilike.%${search}%,description.ilike.%${search}%,material.ilike.%${search}%,invoice_number.ilike.%${search}%`);
  }

  if (intervention === "intervened") {
    query = query.not("last_admin_intervention_at", "is", null);
  } else if (intervention === "not_intervened") {
    query = query.is("last_admin_intervention_at", null);
  }

  if (operational === "blocked") {
    query = query.eq("operational_status", "blocked");
  } else if (operational === "priority") {
    query = query.eq("order_type", "orden 911");
  } else if (operational === "commercial_review") {
    query = query.eq("commercial_review_required", true);
  } else if (operational === "overdue") {
    query = query.lt("delivery_date", new Date().toISOString().slice(0, 10))
      .not("status", "in", "(in_Completed,in_Delivered,cancelled)");
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    debugOrders("query-error", { message: error.message, code: error.code }, env);
    return jsonResponse(400, {
      error: "No se pudieron cargar las ordenes.",
      code: "ORDERS_LOOKUP_FAILED",
    });
  }

  const orders = Array.isArray(data) ? data.map((order) => normalizeOrder(order)) : [];
  let overview = null;
  if (payload?.includeOverview === true) {
    try {
      overview = await loadGlobalOrderOverview({ supabaseAdmin });
    } catch (overviewError) {
      debugOrders("overview-error", { message: overviewError?.message }, env);
    }
  }
  debugOrders("response", { count: orders.length, total: count || 0, page, pageSize }, env);

  return jsonResponse(200, {
    orders,
    page,
    pageSize,
    total: count || 0,
    ...(overview ? { overview } : {}),
  });
}
