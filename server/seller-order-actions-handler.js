import { jsonResponse, requireAuthenticated } from "./auth-middleware.js";

const ORDER_STATUS = {
  PENDING: "pending",
  IN_DESIGN: "in_Design",
  IN_QUOTE: "in_Quote",
  IN_PRODUCTION: "in_Production",
  IN_TERMINATION: "in_Termination",
  IN_COMPLETED: "in_Completed",
  IN_DELIVERED: "in_Delivered",
  CANCELLED: "cancelled",
};

const SELLER_ARCHIVABLE_STATUSES = new Set([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.IN_DELIVERED,
]);

const normalizeText = (value) => String(value || "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_FILTER_FIELDS = ["client_name", "description", "material", "invoice_number", "order_code", "client_contact"];
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

const isPaymentPartial = (value) => ["parcial", "partial"].includes(normalizeKey(value));
const isPaymentPaid = (value) => ["pagado", "paid"].includes(normalizeKey(value));
const isPaymentCredit = (value) => ["credito", "crédito", "credit"].includes(normalizeKey(value));

const getOrderId = (payload = {}) =>
  normalizeText(payload.order_id || payload.orderId || payload.id);

const clampPageSize = (value) => {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
};

const sanitizeSearch = (value) =>
  normalizeText(value)
    .replace(/[,%*]/g, " ")
    .replace(/\s+/g, " ");

const getDateRange = (dateFilter, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  if (Number.isNaN(now.getTime())) return {};

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

  switch (normalizeKey(dateFilter)) {
    case "10min":
      return { gte: new Date(now.getTime() - 10 * 60 * 1000).toISOString() };
    case "30min":
      return { gte: new Date(now.getTime() - 30 * 60 * 1000).toISOString() };
    case "1hour":
      return { gte: new Date(now.getTime() - 60 * 60 * 1000).toISOString() };
    case "today":
      return { gte: today.toISOString() };
    case "yesterday":
      return { gte: addDays(today, -1).toISOString(), lt: today.toISOString() };
    case "3days":
      return { gte: addDays(today, -3).toISOString() };
    case "7days":
      return { gte: addDays(today, -7).toISOString() };
    case "thismonth":
      return { gte: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
    case "thisyear":
      return { gte: new Date(now.getFullYear(), 0, 1).toISOString() };
    default:
      return {};
  }
};

const isStatus = (order, status) => normalizeText(order?.status) === status;

const isReturnedOrder = (order) => {
  if (!order?.return_reason) return false;
  const validStatus = order.order_design_type === "EXTERNAL_DESING"
    ? ORDER_STATUS.PENDING
    : ORDER_STATUS.IN_DESIGN;
  return isStatus(order, validStatus);
};

const buildSummary = (orders = [], nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return orders.reduce((summary, order) => {
    const createdAt = new Date(order?.created_at);
    if (!Number.isNaN(createdAt.getTime()) && createdAt >= today) summary.todayOrders += 1;
    if (isStatus(order, ORDER_STATUS.PENDING)) summary.pending += 1;
    if (isStatus(order, ORDER_STATUS.IN_DESIGN)) summary.inDesign += 1;
    if (isStatus(order, ORDER_STATUS.IN_QUOTE)) summary.inQuote += 1;
    if (isStatus(order, ORDER_STATUS.IN_PRODUCTION)) summary.inProduction += 1;
    if (isStatus(order, ORDER_STATUS.IN_TERMINATION)) summary.inTermination += 1;
    if (isStatus(order, ORDER_STATUS.IN_COMPLETED)) summary.completed += 1;
    if (isReturnedOrder(order)) summary.returned += 1;
    if (!order?.is_archived) summary.unarchived += 1;
    if (
      !order?.is_archived &&
      !isStatus(order, ORDER_STATUS.IN_COMPLETED) &&
      !isStatus(order, ORDER_STATUS.CANCELLED)
    ) {
      summary.active += 1;
    }
    return summary;
  }, {
    todayOrders: 0,
    pending: 0,
    inDesign: 0,
    inQuote: 0,
    inProduction: 0,
    inTermination: 0,
    completed: 0,
    returned: 0,
    active: 0,
    unarchived: 0,
  });
};

const applySellerListFilters = (query, payload = {}, sellerId) => {
  let nextQuery = query.eq("seller_id", sellerId);
  const status = normalizeText(payload.status || payload.filterStatus || "all");
  const paymentStatus = normalizeText(payload.paymentStatus || payload.payment_status || payload.filterPayment || "all");
  const clientId = normalizeText(payload.clientId || payload.client_id || payload.filterClient || "all");
  const archive = normalizeText(payload.archive || payload.filterArchive || "active");
  const search = sanitizeSearch(payload.search);
  const dateRange = getDateRange(payload.dateFilter || payload.filterDate || "all", payload.now);

  if (status !== "all") {
    nextQuery = nextQuery.eq("status", status);
  }

  if (paymentStatus !== "all") {
    nextQuery = nextQuery.eq("payment_status", paymentStatus);
  }

  if (clientId === "__no_client__") {
    nextQuery = nextQuery.is("client_id", null);
  } else if (clientId && clientId !== "all") {
    nextQuery = nextQuery.eq("client_id", clientId);
  }

  if (archive === "archived") {
    nextQuery = nextQuery.eq("is_archived", true);
  } else if (archive === "active") {
    nextQuery = nextQuery.or("is_archived.is.false,is_archived.is.null");
  }

  if (dateRange.gte) nextQuery = nextQuery.gte("created_at", dateRange.gte);
  if (dateRange.lt) nextQuery = nextQuery.lt("created_at", dateRange.lt);

  if (search) {
    const filters = SEARCH_FILTER_FIELDS.map((field) => `${field}.ilike.%${search}%`);
    if (UUID_PATTERN.test(search)) filters.push(`id.eq.${search}`);
    nextQuery = nextQuery.or(filters.join(","));
  }

  return nextQuery;
};

const isAdminProfile = (profile) => profile?.role === "admin";

const isOwnedByProfile = (order, profile) =>
  Boolean(order?.seller_id === profile?.id || order?.created_by === profile?.id);

const debugSellerOrderAction = (message, details = {}, env = process.env) => {
  if (env.SELLER_ORDER_ACTIONS_DEBUG !== "1") return;
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/token|secret|key|email/i.test(key))
  );
  console.warn(`[seller-order-actions] ${message}`, safeDetails);
};

async function loadOwnedOrder(supabaseAdmin, orderId, profile, env) {
  if (!orderId) {
    return { response: jsonResponse(400, { error: "El ID de la orden es obligatorio." }) };
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    debugSellerOrderAction("order-not-found", { orderId, error: error?.message }, env);
    return { response: jsonResponse(404, { error: "No se encontro la orden." }) };
  }

  if (!isAdminProfile(profile) && !isOwnedByProfile(order, profile)) {
    debugSellerOrderAction("ownership-denied", { orderId, profileId: profile?.id }, env);
    return { response: jsonResponse(403, { error: "No tienes acceso a esta orden." }) };
  }

  return { order };
}

async function updateOwnedOrder(supabaseAdmin, order, values, env) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(values)
    .eq("id", order.id)
    .select("*")
    .single();

  if (error || !data) {
    debugSellerOrderAction("update-error", { orderId: order.id, error: error?.message }, env);
    return { response: jsonResponse(400, { error: error?.message || "No se pudo actualizar la orden." }) };
  }

  return { order: data };
}

async function assertAssigneeRole(supabaseAdmin, userId, allowedRole, label, env) {
  const assigneeId = normalizeText(userId);
  if (!assigneeId) {
    return { response: jsonResponse(400, { error: `Debes seleccionar ${label}.` }) };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id,role,employment_status")
    .eq("id", assigneeId)
    .single();

  if (error || !profile) {
    debugSellerOrderAction("assignee-not-found", { assigneeId, allowedRole, error: error?.message }, env);
    return { response: jsonResponse(404, { error: `No se encontro ${label}.` }) };
  }

  if (profile.role !== allowedRole || profile.employment_status === false) {
    debugSellerOrderAction("assignee-invalid", { assigneeId, role: profile.role, allowedRole }, env);
    return { response: jsonResponse(400, { error: `${label} no esta disponible para esta asignacion.` }) };
  }

  return { profile };
}

async function handleDetail(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  return jsonResponse(200, { order: loaded.order });
}

async function handleCancel(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (isPaymentPartial(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede cancelar una orden con pago parcial." });
  }

  if (isPaymentPaid(loaded.order.payment_status) || isPaymentCredit(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede cancelar una orden pagada o a credito." });
  }

  const reason = normalizeText(payload.reason || payload.cancellation_reason);
  if (!reason) {
    return jsonResponse(400, { error: "Debes indicar el motivo de cancelacion." });
  }

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    { status: ORDER_STATUS.CANCELLED, cancellation_reason: reason },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleSendToDesigner(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const assignee = await assertAssigneeRole(auth.supabaseAdmin, payload.designer_id || payload.designerId, "designer", "un disenador", env);
  if (assignee.response) return assignee.response;

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    {
      status: ORDER_STATUS.IN_DESIGN,
      designer_id: assignee.profile.id,
      return_reason: null,
      returned_to_designer_at: null,
    },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleSendToQuote(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const assignee = await assertAssigneeRole(auth.supabaseAdmin, payload.quote_user_id || payload.quoteUserId, "quote", "un usuario de caja", env);
  if (assignee.response) return assignee.response;

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    {
      status: ORDER_STATUS.IN_QUOTE,
      quote_id: assignee.profile.id,
      return_reason: null,
      returned_to_designer_at: null,
    },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleArchive(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (loaded.order.is_archived) {
    return jsonResponse(200, { order: loaded.order });
  }

  if (isPaymentPartial(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede archivar una orden con pago parcial." });
  }

  if (!SELLER_ARCHIVABLE_STATUSES.has(loaded.order.status)) {
    return jsonResponse(409, { error: "Esta orden aun no puede archivarse en Ventas." });
  }

  const updated = await updateOwnedOrder(auth.supabaseAdmin, loaded.order, { is_archived: true }, env);
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleList(payload, auth, env) {
  const page = Math.max(Number.parseInt(payload.page, 10) || 1, 1);
  const pageSize = clampPageSize(payload.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sellerId = auth.profile.id;

  let listQuery = auth.supabaseAdmin
    .from("orders")
    .select("*", { count: "exact" });
  listQuery = applySellerListFilters(listQuery, { ...payload, now: env.now }, sellerId);

  const [listResult, summaryResult, recentResult] = await Promise.all([
    listQuery
      .order("created_at", { ascending: false })
      .range(from, to),
    auth.supabaseAdmin
      .from("orders")
      .select("id,status,created_at,is_archived,return_reason,order_design_type")
      .eq("seller_id", sellerId),
    payload.includeDashboard === false ? Promise.resolve({ data: [], error: null }) : auth.supabaseAdmin
      .from("orders")
      .select("*")
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .range(0, 4),
  ]);

  if (listResult.error) {
    debugSellerOrderAction("list-error", { error: listResult.error?.message }, env);
    return jsonResponse(400, { error: `No se pudieron cargar ordenes: ${listResult.error.message}` });
  }

  if (summaryResult.error) {
    debugSellerOrderAction("summary-error", { error: summaryResult.error?.message }, env);
    return jsonResponse(400, { error: `No se pudo cargar el resumen de ordenes: ${summaryResult.error.message}` });
  }

  if (recentResult.error) {
    debugSellerOrderAction("recent-error", { error: recentResult.error?.message }, env);
    return jsonResponse(400, { error: `No se pudieron cargar ordenes recientes: ${recentResult.error.message}` });
  }

  const total = listResult.count || 0;
  return jsonResponse(200, {
    orders: Array.isArray(listResult.data) ? listResult.data : [],
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    summary: buildSummary(Array.isArray(summaryResult.data) ? summaryResult.data : [], env.now),
    recent_orders: Array.isArray(recentResult.data) ? recentResult.data : [],
  });
}

const ACTION_HANDLERS = {
  list: handleList,
  detail: handleDetail,
  cancel: handleCancel,
  send_to_designer: handleSendToDesigner,
  send_to_quote: handleSendToQuote,
  archive: handleArchive,
};

export async function handleSellerOrderAction(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["seller", "admin"] });
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const action = normalizeKey(payload.action);
  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return jsonResponse(400, { error: `Accion Seller no valida: ${payload.action || ""}` });
  }

  return handler(payload, auth, env);
}
