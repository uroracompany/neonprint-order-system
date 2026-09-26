import { jsonResponse, requireAuthenticated } from "./auth-middleware.js";
import { createClient } from "@supabase/supabase-js";

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

const SELLER_EDIT_BLOCKED_STATUSES = new Set([
  ORDER_STATUS.IN_QUOTE,
]);

const SELLER_EDITABLE_ORDER_FIELDS = new Set([
  "client_id",
  "client_name",
  "client_contact",
  "invoice_number",
  "description",
  "material",
  "termination_type",
  "delivery_date",
  "order_file_url",
  "preview_image",
  "reference_images",
]);

const normalizeText = (value) => String(value || "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_FILTER_FIELDS = ["client_name", "description", "material", "invoice_number", "order_code", "client_contact"];
const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

// The list and dashboard never need the complete order record. Keeping these
// projections explicit avoids transferring descriptions, assets and other
// detail-only fields on every refresh while preserving every rendered field.
const SELLER_LIST_COLUMNS = [
  "id",
  "client_id",
  "client_name",
  "invoice_number",
  "status",
  "payment_status",
  "order_design_type",
  "order_type",
  "created_at",
  "delivery_date",
  "is_archived",
  "return_reason",
  "updated_at",
].join(",");
const SELLER_SUMMARY_COLUMNS = "id,status,created_at,is_archived,return_reason,order_design_type,delivery_date";

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

const getAsuncionDateKey = (nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  if (Number.isNaN(now.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
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

const applySellerListFilters = (query, payload = {}, sellerId, { global = false } = {}) => {
  let nextQuery = global ? query : query.or(`seller_id.eq.${sellerId},created_by.eq.${sellerId}`);
  const status = normalizeText(payload.status || payload.filterStatus || "all");
  const paymentStatus = normalizeText(payload.paymentStatus || payload.payment_status || payload.filterPayment || "all");
  const clientId = normalizeText(payload.clientId || payload.client_id || payload.filterClient || "all");
  const archive = normalizeText(payload.archive || payload.filterArchive || "active");
  const search = sanitizeSearch(payload.search);
  const dateRange = getDateRange(payload.dateFilter || payload.filterDate || "all", payload.now);
  const overdueToday = payload.overdue === true ? getAsuncionDateKey(payload.now) : null;

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

  if (overdueToday) {
    nextQuery = nextQuery
      .not("delivery_date", "is", null)
      .lt("delivery_date", overdueToday)
      .neq("status", ORDER_STATUS.IN_DELIVERED)
      .neq("status", ORDER_STATUS.CANCELLED);
  }

  if (search) {
    const filters = SEARCH_FILTER_FIELDS.map((field) => `${field}.ilike.%${search}%`);
    if (UUID_PATTERN.test(search)) filters.push(`id.eq.${search}`);
    nextQuery = nextQuery.or(filters.join(","));
  }

  return nextQuery;
};

const applySellerOwnershipFilter = (query, sellerId) => (
  query.or(`seller_id.eq.${sellerId},created_by.eq.${sellerId}`)
);

const isAdminProfile = (profile) => profile?.role === "admin";
const isSemiAdminProfile = (profile) => profile?.role === "semi_admin";
const isOrderOperatorProfile = (profile) => isAdminProfile(profile) || isSemiAdminProfile(profile);

const isOwnedByProfile = (order, profile) =>
  Boolean(order?.seller_id === profile?.id || order?.created_by === profile?.id);

const buildAuthenticatedSupabase = (auth, env) => {
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !anonKey || !auth?.accessToken) return null;

  return createClient(env.SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
  });
};

const sanitizeSellerOrderChanges = (changes = {}, { allowClientIdentity = true } = {}) => {
  const sanitized = {};
  Object.entries(changes || {}).forEach(([field, value]) => {
    if (!SELLER_EDITABLE_ORDER_FIELDS.has(field)) return;
    if (!allowClientIdentity && ["client_id", "client_name", "client_contact"].includes(field)) return;
    if (value === undefined) return;
    sanitized[field] = value;
  });
  return sanitized;
};

const sanitizeProductionFileRows = (rows = [], order, actorId) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      order_id: order.id,
      url: normalizeText(row?.url),
      filename: normalizeText(row?.filename) || "Archivo",
      public_label: normalizeText(row?.public_label || row?.publicLabel),
      production_area_code: normalizeText(row?.production_area_code || row?.productionAreaCode),
      material_names: Array.from(new Set((row?.material_names || row?.materialNames || [])
        .map(normalizeText)
        .filter(Boolean))),
      termination_name: normalizeText(row?.termination_name || row?.terminationName) || null,
      status: normalizeText(row?.status) || "pending",
      created_by: actorId,
      updated_by: actorId,
    }))
    .filter((row) => row.url && row.public_label && row.production_area_code);
};

const sanitizeUrlList = (urls = []) => (
  Array.isArray(urls) ? urls.map(normalizeText).filter(Boolean) : []
);

const timestampsMatch = (left, right) => {
  if (!left || !right) return true;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return String(left) === String(right);
  }
  return leftTime === rightTime;
};

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

  if (!isOrderOperatorProfile(profile) && !isOwnedByProfile(order, profile)) {
    debugSellerOrderAction("ownership-denied", { orderId, profileId: profile?.id }, env);
    return { response: jsonResponse(403, { error: "No tienes acceso a esta orden." }) };
  }

  return { order };
}

async function assertAssigneeRole(supabaseAdmin, userId, allowedRoles, label, env) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
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
    debugSellerOrderAction("assignee-not-found", { assigneeId, allowedRoles: roles, error: error?.message }, env);
    return { response: jsonResponse(404, { error: `No se encontro ${label}.` }) };
  }

  if (!roles.includes(profile.role) || profile.employment_status === false) {
    debugSellerOrderAction("assignee-invalid", { assigneeId, role: profile.role, allowedRoles: roles }, env);
    return { response: jsonResponse(400, { error: `${label} no esta disponible para esta asignacion.` }) };
  }

  return { profile };
}

async function handleDetail(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (!isSemiAdminProfile(auth.profile)) {
    return jsonResponse(200, { order: loaded.order });
  }

  const [filesResult, operatorsResult, deliveryResult, stageUsersResult, responsibilityEventsResult] = await Promise.all([
    auth.supabaseAdmin
      .from("order_production_files")
      .select("id,url,filename,public_label,production_area_code,material_names,termination_name,status,assigned_to,updated_at")
      .eq("order_id", loaded.order.id)
      .order("created_at", { ascending: true }),
    auth.supabaseAdmin
      .from("profiles")
      .select("id,name,role")
      .in("role", ["digital_producer", "dtf_producer", "ploteo_producer"])
      .eq("employment_status", true)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    auth.supabaseAdmin
      .from("profiles")
      .select("id,name,role")
      .in("role", ["delivery", "semi_admin"])
      .eq("employment_status", true)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    auth.supabaseAdmin
      .from("profiles")
      .select("id,name,role")
      .in("role", ["designer", "quote", "semi_admin"])
      .eq("employment_status", true)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    auth.supabaseAdmin
      .from("order_events")
      .select("id,actor_id,event_type,changes,created_at")
      .eq("order_id", loaded.order.id)
      .eq("event_type", "semi_admin_stage_responsibility_changed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (filesResult.error || operatorsResult.error || deliveryResult.error || stageUsersResult.error || responsibilityEventsResult.error) {
    debugSellerOrderAction("semi-admin-detail-operational-data-error", {
      files: filesResult.error?.message,
      operators: operatorsResult.error?.message,
      delivery: deliveryResult.error?.message,
      stageUsers: stageUsersResult.error?.message,
      responsibilityEvents: responsibilityEventsResult.error?.message,
    }, env);
    return jsonResponse(500, { error: "No se pudo cargar la información operativa de la orden." });
  }

  return jsonResponse(200, {
    order: {
      ...loaded.order,
      order_production_files: filesResult.data || [],
      semi_admin_operational_users: {
        production: operatorsResult.data || [],
        delivery: deliveryResult.data || [],
        stages: stageUsersResult.data || [],
      },
      semi_admin_stage_responsibility_history: responsibilityEventsResult.data || [],
    },
  });
}

async function handleCancel(payload, auth, env) {
  if (isSemiAdminProfile(auth.profile)) {
    return jsonResponse(403, { error: "Cancelar órdenes está reservado para Administración.", code: "SEMI_ADMIN_DESTRUCTIVE_ACTION_FORBIDDEN" });
  }
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

  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  const updated = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "seller_cancel_order",
    { p_order_id: loaded.order.id, p_reason: reason, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleUpdate(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (!isAdminProfile(auth.profile) && loaded.order.is_archived) {
    return jsonResponse(409, { error: "No se puede editar una orden archivada en Ventas." });
  }

  if (!isAdminProfile(auth.profile) && SELLER_EDIT_BLOCKED_STATUSES.has(loaded.order.status)) {
    return jsonResponse(409, { error: "No se puede editar una orden en cotizacion." });
  }

  if (isSemiAdminProfile(auth.profile) && [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_DELIVERED].includes(loaded.order.status)) {
    return jsonResponse(409, { error: "No se puede editar una orden cancelada o entregada." });
  }

  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt;
  if (!timestampsMatch(loaded.order.updated_at, expectedUpdatedAt)) {
    return jsonResponse(409, { error: "La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente." });
  }

  const rawChanges = payload.changes || payload.payload || payload;
  const foreignSemiAdminOrder = isSemiAdminProfile(auth.profile) && !isOwnedByProfile(loaded.order, auth.profile);
  if (foreignSemiAdminOrder && ["seller_id", "created_by", "client_id", "client_name", "client_contact"].some((field) => Object.prototype.hasOwnProperty.call(rawChanges || {}, field))) {
    return jsonResponse(403, { error: "No puedes cambiar el vendedor ni el cliente de una orden ajena.", code: "ORDER_PROTECTED_FIELDS" });
  }
  const changes = sanitizeSellerOrderChanges(rawChanges, { allowClientIdentity: !foreignSemiAdminOrder });
  if (Object.keys(changes).length === 0) {
    return jsonResponse(400, { error: "No hay cambios permitidos para actualizar." });
  }

  const productionFileRows = sanitizeProductionFileRows(
    payload.production_files || payload.productionFiles,
    loaded.order,
    auth.profile.id
  );
  const removedFileUrls = sanitizeUrlList(payload.removed_file_urls || payload.removedFileUrls);

  const command = isSemiAdminProfile(auth.profile)
    ? "semi_admin_update_order"
    : (productionFileRows.length || removedFileUrls.length
    ? "seller_update_order_with_files_and_specifications"
    : "seller_update_order");
  const commandArgs = command === "semi_admin_update_order"
    ? {
      p_order_id: loaded.order.id,
      p_action: "update_order",
      p_payload: {
        changes,
        new_production_files: productionFileRows,
        removed_file_urls: removedFileUrls,
        asset_operation: payload.asset_operation === "manage_assets" ? "manage_assets" : null,
        asset_removal_only: payload.asset_removal_only === true,
      },
      p_expected_updated_at: expectedUpdatedAt,
    }
    : command === "seller_update_order_with_files_and_specifications"
    ? {
      p_order_id: loaded.order.id,
      p_expected_updated_at: expectedUpdatedAt,
      p_changes: changes,
      p_new_production_files: productionFileRows,
      p_removed_file_urls: removedFileUrls,
    }
    : { p_order_id: loaded.order.id, p_expected_updated_at: expectedUpdatedAt, p_changes: changes };
  const updated = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env), command === "semi_admin_update_order" ? "semi_admin_execute_order_command" : command, commandArgs, loaded.order, env
  );
  if (updated.response) return updated.response;

  return jsonResponse(200, { order: updated.order?.order || updated.order });
}

async function handleSendToDesigner(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const semiAdminActor = isSemiAdminProfile(auth.profile);
  const assignee = await assertAssigneeRole(
    auth.supabaseAdmin,
    payload.designer_id || payload.designerId,
    semiAdminActor ? ["designer", "semi_admin"] : "designer",
    semiAdminActor ? "un disenador o a ti mismo" : "un disenador",
    env
  );
  if (assignee.response) return assignee.response;
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  if (semiAdminActor) {
    const updated = await callSellerOrderCommand(
      buildAuthenticatedSupabase(auth, env),
      "semi_admin_execute_order_command",
      { p_order_id: loaded.order.id, p_action: "send_to_designer", p_payload: { target_user_id: assignee.profile.id }, p_expected_updated_at: expectedUpdatedAt },
      loaded.order,
      env
    );
    if (updated.response) return updated.response;
    return jsonResponse(200, { order: updated.order?.order || updated.order });
  }
  const updated = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "seller_send_order_to_designer",
    { p_order_id: loaded.order.id, p_designer_id: assignee.profile.id, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function callSellerOrderCommand(supabase, command, args, order, env) {
  if (!supabase?.rpc) {
    return { response: jsonResponse(500, { error: "No se pudo preparar el comando seguro de la orden.", code: "ORDER_COMMAND_UNAVAILABLE" }) };
  }
  const { data, error } = await supabase.rpc(command, args);

  if (error || !data) {
    debugSellerOrderAction("command-error", { orderId: order.id, command, error: error?.message }, env);
    if (/ORDER_STALE|orden cambio mientras/i.test(error?.message || "")) {
      return { response: jsonResponse(409, { error: "La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente." }) };
    }
    if (/Authentication|required|No tienes acceso|Solo Ventas/i.test(error?.message || "")) {
      return { response: jsonResponse(403, { error: "No tienes permisos para ejecutar esta accion.", code: "ORDER_COMMAND_FORBIDDEN" }) };
    }
    return { response: jsonResponse(400, { error: error?.message || "No se pudo actualizar la orden.", code: "ORDER_UPDATE_FAILED" }) };
  }

  return { order: data };
}

async function handleSendToQuote(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const semiAdminActor = isSemiAdminProfile(auth.profile);
  const assignee = await assertAssigneeRole(auth.supabaseAdmin, payload.quote_user_id || payload.quoteUserId, semiAdminActor ? ["quote", "semi_admin"] : "quote", "un usuario de caja", env);
  if (assignee.response) return assignee.response;

  if (loaded.order.order_design_type !== "EXTERNAL_DESING") {
    return jsonResponse(400, { error: "Solo órdenes de Diseño Externo pueden enviarse a Caja directamente desde Ventas." });
  }
  if (!isStatus(loaded.order, ORDER_STATUS.PENDING) && normalizeKey(loaded.order.status) !== "pending") {
    return jsonResponse(400, { error: "La orden debe estar en Ventas antes de enviarse a Caja." });
  }
  if (loaded.order.is_archived) return jsonResponse(400, { error: "La orden no puede enviarse a Caja en este estado." });
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  if (!timestampsMatch(loaded.order.updated_at, expectedUpdatedAt)) {
    return jsonResponse(409, { error: "La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente." });
  }
  const updated = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    semiAdminActor ? "semi_admin_execute_order_command" : "seller_send_order_to_quote",
    semiAdminActor
      ? { p_order_id: loaded.order.id, p_action: "send_to_quote", p_payload: { target_user_id: assignee.profile.id }, p_expected_updated_at: expectedUpdatedAt }
      : { p_order_id: loaded.order.id, p_quote_id: assignee.profile.id, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order?.order || updated.order });
}

async function handleArchive(payload, auth, env) {
  if (isSemiAdminProfile(auth.profile)) {
    return jsonResponse(403, { error: "Archivar órdenes está reservado para Administración.", code: "SEMI_ADMIN_DESTRUCTIVE_ACTION_FORBIDDEN" });
  }
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (isPaymentPartial(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede archivar una orden con pago parcial." });
  }

  if (!SELLER_ARCHIVABLE_STATUSES.has(loaded.order.status)) {
    return jsonResponse(409, { error: "Esta orden aun no puede archivarse en Ventas." });
  }

  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  const updated = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "seller_set_order_archive",
    { p_order_id: loaded.order.id, p_archived: true, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

const requireSemiAdminAction = (auth) => (
  isSemiAdminProfile(auth.profile)
    ? null
    : jsonResponse(403, { error: "Esta operación está reservada para Semi-Administración.", code: "SEMI_ADMIN_ONLY" })
);

async function handleSemiAdminOperationalCatalog(payload, auth, env) {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  const { data, error } = await buildAuthenticatedSupabase(auth, env)
    .rpc("semi_admin_get_order_command_catalog", { p_order_id: loaded.order.id });
  if (error) return jsonResponse(400, { error: error.message || "No se pudo consultar la configuración operativa." });
  return jsonResponse(200, { catalog: data || { actions: [], unavailable_actions: [] } });
}

async function handleSemiAdminOrderCommand(payload, auth, env, command, argsBuilder, resultKey = "order") {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  const legacyArgs = argsBuilder(loaded.order, expectedUpdatedAt);
  const commandAction = {
    semi_admin_mark_order_delivered: "mark_delivered",
    semi_admin_update_production_file_status: "production_file_status",
    semi_admin_reassign_file_production_area: "reassign_production_file",
    semi_admin_save_order_production_file_specifications: "production_specifications",
    semi_admin_route_order_to_production: "route_production",
    semi_admin_assign_stage_responsibility: "stage_responsibility",
  }[command];
  if (!commandAction) return jsonResponse(500, { error: "Comando operativo Semi-Administrador no configurado." });
  if (commandAction === "production_file_status" || commandAction === "reassign_production_file" || (commandAction === "stage_responsibility" && normalizeKey(legacyArgs.p_stage) === "production")) {
    return jsonResponse(403, { error: "Semi-Administrador no puede gestionar Producción.", code: "SEMI_ADMIN_PRODUCTION_FORBIDDEN" });
  }
  const commandPayload = Object.fromEntries(Object.entries(legacyArgs)
    .filter(([key]) => key !== "p_order_id" && key !== "p_expected_updated_at")
    .map(([key, value]) => [key.replace(/^p_/, ""), value]));
  const result = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "semi_admin_execute_order_command",
    { p_order_id: loaded.order.id, p_action: commandAction, p_payload: commandPayload, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (result.response) return result.response;
  return jsonResponse(200, { [resultKey]: result.order?.[resultKey] || result.order });
}

const handleMarkDelivered = (payload, auth, env) => handleSemiAdminOrderCommand(
  payload, auth, env, "semi_admin_mark_order_delivered",
  (order, expectedUpdatedAt) => ({
    p_order_id: order.id,
    p_delivery_note: normalizeText(payload.delivery_note || payload.deliveryNote) || null,
    p_expected_updated_at: expectedUpdatedAt,
  })
);

const handleProductionFileStatus = (payload, auth, env) => handleSemiAdminOrderCommand(
  { ...payload, order_id: payload.order_id || payload.orderId }, auth, env,
  "semi_admin_update_production_file_status",
  (order, expectedUpdatedAt) => ({
    p_file_id: payload.file_id || payload.fileId,
    p_next_status: normalizeText(payload.next_status || payload.nextStatus),
    p_expected_updated_at: expectedUpdatedAt,
    p_delivery_id: payload.delivery_id || payload.deliveryId || null,
  }), "file"
);

const handleReassignProductionFile = (payload, auth, env) => handleSemiAdminOrderCommand(
  { ...payload, order_id: payload.order_id || payload.orderId }, auth, env,
  "semi_admin_reassign_file_production_area",
  (order, expectedUpdatedAt) => ({
    p_file_id: payload.file_id || payload.fileId,
    p_new_area_code: normalizeText(payload.new_area_code || payload.newAreaCode),
    p_new_assigned_user_id: payload.new_assigned_user_id || payload.newAssignedUserId,
    p_expected_updated_at: expectedUpdatedAt,
  }), "file"
);

const handleProductionSpecifications = (payload, auth, env) => handleSemiAdminOrderCommand(
  payload, auth, env, "semi_admin_save_order_production_file_specifications",
  (order, expectedUpdatedAt) => ({
    p_order_id: order.id,
    p_expected_updated_at: expectedUpdatedAt,
    p_specifications: Array.isArray(payload.specifications) ? payload.specifications : [],
  })
);

const handleRouteProduction = (payload, auth, env) => handleSemiAdminOrderCommand(
  payload, auth, env, "semi_admin_route_order_to_production",
  (order, expectedUpdatedAt) => ({
    p_order_id: order.id,
    p_area_assignments: payload.area_assignments || payload.areaAssignments || {},
    p_expected_updated_at: expectedUpdatedAt,
  })
);

const handleStageResponsibility = (payload, auth, env) => handleSemiAdminOrderCommand(
  payload, auth, env, "semi_admin_assign_stage_responsibility",
  (order, expectedUpdatedAt) => ({
    p_order_id: order.id,
    p_stage: normalizeKey(payload.stage),
    p_assignee_id: payload.assignee_id || payload.assigneeId,
    p_expected_updated_at: expectedUpdatedAt,
    p_production_area_code: normalizeText(payload.production_area_code || payload.productionAreaCode) || null,
  })
);

async function handleSemiAdminCatalogCommand(payload, auth, env, action) {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
  const commandPayload = { ...payload };
  delete commandPayload.action;
  delete commandPayload.order_id;
  delete commandPayload.orderId;
  delete commandPayload.expected_updated_at;
  delete commandPayload.expectedUpdatedAt;
  const result = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "semi_admin_execute_order_command",
    { p_order_id: loaded.order.id, p_action: action, p_payload: commandPayload, p_expected_updated_at: expectedUpdatedAt },
    loaded.order,
    env
  );
  if (result.response) return result.response;
  return jsonResponse(200, { order: result.order?.order || result.order });
}

async function handleList(payload, auth, env) {
  const page = Math.max(Number.parseInt(payload.page, 10) || 1, 1);
  const pageSize = clampPageSize(payload.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sellerId = auth.profile.id;

  let listQuery = auth.supabaseAdmin
    .from("orders")
    .select(SELLER_LIST_COLUMNS, { count: "exact" });
  const globalOrderView = isSemiAdminProfile(auth.profile);
  listQuery = applySellerListFilters(listQuery, { ...payload, now: env.now }, sellerId, { global: globalOrderView });

  const [listResult, summaryResult, recentResult] = await Promise.all([
    listQuery
      .order("created_at", { ascending: false })
      .range(from, to),
    (globalOrderView ? (query) => query : applySellerOwnershipFilter)(
      auth.supabaseAdmin
        .from("orders")
        .select(SELLER_SUMMARY_COLUMNS),
      sellerId
    ),
    payload.includeDashboard === false
      ? Promise.resolve({ data: [], error: null })
      : (globalOrderView ? (query) => query : applySellerOwnershipFilter)(
        auth.supabaseAdmin
          .from("orders")
          .select(SELLER_LIST_COLUMNS),
        sellerId
      )
        .order("created_at", { ascending: false })
        .range(0, 4),
  ]);

  if (listResult.error) {
    debugSellerOrderAction("list-error", { error: listResult.error?.message }, env);
    return jsonResponse(500, { error: "No se pudieron cargar las ordenes.", code: "ORDERS_LOOKUP_FAILED" });
  }

  if (summaryResult.error) {
    debugSellerOrderAction("summary-error", { error: summaryResult.error?.message }, env);
    return jsonResponse(500, { error: "No se pudo cargar el resumen de ordenes.", code: "ORDER_SUMMARY_LOOKUP_FAILED" });
  }

  if (recentResult.error) {
    debugSellerOrderAction("recent-error", { error: recentResult.error?.message }, env);
    return jsonResponse(500, { error: "No se pudieron cargar las ordenes recientes.", code: "RECENT_ORDERS_LOOKUP_FAILED" });
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
  update: handleUpdate,
  cancel: handleCancel,
  send_to_designer: handleSendToDesigner,
  send_to_quote: handleSendToQuote,
  archive: handleArchive,
  operational_catalog: handleSemiAdminOperationalCatalog,
  mark_delivered: handleMarkDelivered,
  production_file_status: handleProductionFileStatus,
  reassign_production_file: handleReassignProductionFile,
  production_specifications: handleProductionSpecifications,
  route_production: handleRouteProduction,
  stage_responsibility: handleStageResponsibility,
  register_payment: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "register_payment"),
  send_design_to_quote: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "send_design_to_quote"),
  return_design_to_sales: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "return_design_to_sales"),
};

export async function handleSellerOrderAction(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["seller", "semi_admin", "admin"] });
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error, code: auth.code });
  }

  const action = normalizeKey(payload.action);
  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return jsonResponse(400, { error: `Accion Seller no valida: ${payload.action || ""}` });
  }

  return handler(payload, auth, env);
}
