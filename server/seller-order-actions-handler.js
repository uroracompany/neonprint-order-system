import { jsonResponse, requireAuthenticated } from "./auth-middleware.js";
import { createClient } from "@supabase/supabase-js";
import { areOrderTimestampsEquivalent } from "../src/utils/orderTimestamp.js";

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

const SEMI_ADMIN_ASSET_EDITABLE_STATUSES = new Set([
  ORDER_STATUS.PENDING,
  "Pending",
  ORDER_STATUS.IN_DESIGN,
  "In_Design",
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_COMPLETED,
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
const SEMI_ADMIN_ASSET_FIELDS = new Set(["order_file_url", "preview_image", "reference_images"]);

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
  "seller_id",
  "created_by",
  "designer_id",
  "client_id",
  "client_name",
  "invoice_number",
  "invoice_assignment_mode",
  "operational_status",
  "production_authorized_at",
  "production_authorized_by",
  "status",
  "payment_status",
  "order_design_type",
  "order_type",
  "created_at",
  "delivery_date",
  "is_archived",
  "is_archived_admin",
  "return_reason",
  "updated_at",
].join(",");
const SELLER_SUMMARY_COLUMNS = "id,status,created_at,is_archived,return_reason,order_design_type,delivery_date";

const isPaymentPartial = (value) => ["parcial", "partial"].includes(normalizeKey(value));
const isPaymentPaid = (value) => ["pagado", "paid"].includes(normalizeKey(value));
const isPaymentCredit = (value) => ["credito", "crédito", "credit"].includes(normalizeKey(value));
const isPaymentProductionEligible = (value) => isPaymentPaid(value) || isPaymentPartial(value) || isPaymentCredit(value);
const SEMI_ADMIN_CANCELLABLE_STATUSES = new Set(["Pending", "in_Design", "in_Quote"]);
const isSemiAdminCancellableOrder = (order, profile) => (
  isOwnedByProfile(order, profile)
  && !order?.is_archived
  && order?.operational_status !== "blocked"
  && SEMI_ADMIN_CANCELLABLE_STATUSES.has(normalizeText(order?.status))
  && normalizeText(order?.payment_status) === "Pending_Payment"
);

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
const SEMI_ADMIN_PARTICIPANT_FIELDS = ["created_by", "seller_id", "designer_id", "quote_id", "delivery_id"];
const SEMI_ADMIN_QUOTE_ACTION_FIELDS = ["created_by", "seller_id", "designer_id", "quote_id"];
const SEMI_ADMIN_ROW_CATALOG_ACTION_TITLES = new Map([
  ["send_to_designer", "Enviar a Diseño"],
  ["send_to_quote", "Enviar a Caja"],
  ["send_design_to_quote", "Enviar a Caja"],
  ["route_production", "Enviar a Producción"],
  ["return_design_to_sales", "Devolver a Ventas"],
]);
const SEMI_ADMIN_ROW_CATALOG_MAX_IDS = 100;
const SEMI_ADMIN_ROW_CATALOG_CONCURRENCY = 4;
const SEMI_ADMIN_ROW_CATALOG_DEPENDENCIES = [
  "semi_admin_get_orders_command_catalog",
  "semi_admin_get_order_command_catalog",
  "semi_admin_get_order_command_catalog_before_cashier_routing",
  "semi_admin_get_order_command_catalog_base",
  "semi_admin_is_order_routing_responsible",
];
const SEMI_ADMIN_ROW_CATALOG_ORDER_COLUMNS = [
  "id",
  ...SEMI_ADMIN_PARTICIPANT_FIELDS,
  "status",
  "order_design_type",
  "is_archived",
  "is_archived_admin",
  "operational_status",
  "payment_status",
  "production_authorized_at",
  "production_authorized_by",
  "updated_at",
].join(",");

const isOwnedByProfile = (order, profile) =>
  Boolean(order?.seller_id === profile?.id || order?.created_by === profile?.id);

const isSemiAdminParticipant = (order, profile) => (
  isSemiAdminProfile(profile)
  && SEMI_ADMIN_PARTICIPANT_FIELDS.some((field) => order?.[field] === profile?.id)
);

const isSemiAdminRowCatalogCandidate = (order, profile) => (
  isSemiAdminParticipant(order, profile)
  && ["INTERNAL_DESING", "EXTERNAL_DESING"].includes(normalizeText(order?.order_design_type))
  && !order?.is_archived
  && !order?.is_archived_admin
  && order?.operational_status !== "blocked"
  && (
    (["Pending", "pending"].includes(normalizeText(order?.status))
      && (normalizeText(order?.order_design_type) === "EXTERNAL_DESING"
        ? order?.seller_id === profile?.id || order?.created_by === profile?.id
        : order?.seller_id === profile?.id || order?.created_by === profile?.id || order?.designer_id === profile?.id))
    || (normalizeText(order?.status) === ORDER_STATUS.IN_QUOTE
      && isPaymentProductionEligible(order?.payment_status)
      && Boolean(order?.production_authorized_at && order?.production_authorized_by)
      && (normalizeText(order?.order_design_type) === "INTERNAL_DESING"
        ? order?.designer_id === profile?.id
        : order?.seller_id === profile?.id || order?.created_by === profile?.id))
    || ([ORDER_STATUS.IN_DESIGN, "In_Design"].includes(normalizeText(order?.status))
      && normalizeText(order?.order_design_type) === "INTERNAL_DESING"
      && order?.designer_id === profile?.id)
    || (normalizeText(order?.status) === ORDER_STATUS.IN_QUOTE
      && normalizeKey(order?.payment_status) === "pending_payment"
      && SEMI_ADMIN_QUOTE_ACTION_FIELDS.some((field) => order?.[field] === profile?.id))
  )
  && Boolean(order?.updated_at)
);

const getSemiAdminRowCatalogActionKey = (order) => {
  const status = normalizeText(order?.status);
  const designType = normalizeText(order?.order_design_type);
  if (["Pending", "pending"].includes(status)) {
    if (designType === "INTERNAL_DESING") return "send_to_designer";
    if (designType === "EXTERNAL_DESING") return "send_to_quote";
    return null;
  }
  if ([ORDER_STATUS.IN_DESIGN, "In_Design"].includes(status) && designType === "INTERNAL_DESING") {
    return "send_design_to_quote";
  }
  return status === ORDER_STATUS.IN_QUOTE ? "route_production" : null;
};

const getSemiAdminRowCatalogActionKeys = (order) => {
  const keys = [];
  const forwardAction = getSemiAdminRowCatalogActionKey(order);
  if (forwardAction) keys.push(forwardAction);

  if ([ORDER_STATUS.IN_DESIGN, "In_Design"].includes(normalizeText(order?.status))
    && normalizeText(order?.order_design_type) === "INTERNAL_DESING") {
    keys.push("return_design_to_sales");
  }
  return keys;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isRecoverableSemiAdminBatchCatalogError = (error) => {
  const message = String(error?.message || "").trim().toLowerCase();
  if (error?.code === "PGRST202") {
    return /could not find the function (?:public\.)?semi_admin_get_orders_command_catalog\s*\([^)]*\) in the schema cache/i.test(message);
  }
  if (error?.code !== "42883") return false;

  return SEMI_ADMIN_ROW_CATALOG_DEPENDENCIES.some((functionName) => {
    const escapedName = escapeRegex(functionName);
    return new RegExp(
      `\\bfunction\\s+(?:public\\.)?${escapedName}\\s*\\([^)]*\\)\\s+(?:does not exist|is undefined|not found|undefined)\\b`,
      "i"
    ).test(message);
  });
};

const isPlainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

const projectSemiAdminRowCatalog = (catalog, orderId, order, profile, previousStageReturn = null) => {
  if (!isPlainObject(catalog)
    || !areOrderTimestampsEquivalent(catalog.version, order.updated_at)
    || catalog.locked !== false
    || !isSemiAdminRowCatalogCandidate(order, profile)) return null;

  const safeActions = [];
  const sourceActions = Array.isArray(catalog.actions) ? catalog.actions : [];
  for (const key of getSemiAdminRowCatalogActionKeys(order)) {
    if (!sourceActions.some((action) => action?.key === key
      && normalizeText(action?.title)
      && normalizeText(action.title).length <= 100)) continue;
    safeActions.push({ key, title: SEMI_ADMIN_ROW_CATALOG_ACTION_TITLES.get(key) });
  }

  if (previousStageReturn
    && normalizeText(order?.status) === ORDER_STATUS.IN_QUOTE
    && normalizeKey(order?.payment_status) === "pending_payment"
    && isSemiAdminQuoteActionParticipant(order, profile)) {
    safeActions.push({
      key: "return_quote_to_previous_stage",
      title: previousStageReturn.title,
      target_stage: previousStageReturn.targetStage,
      requires_reason: true,
    });
  }
  if (!safeActions.length) return null;

  return {
    order_id: orderId,
    order_updated_at: order.updated_at,
    actions: safeActions,
  };
};

const readSemiAdminRowCatalogOrders = async (supabaseAdmin, orderIds) => {
  if (!orderIds.length) return { data: [], error: null };
  return supabaseAdmin
    .from("orders")
    .select(SEMI_ADMIN_ROW_CATALOG_ORDER_COLUMNS)
    .in("id", orderIds);
};

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function loadSemiAdminRowCatalogFallback(orderIds, auth, userScopedClient, env) {
  const participantRead = await readSemiAdminRowCatalogOrders(auth.supabaseAdmin, orderIds);
  if (participantRead.error || !Array.isArray(participantRead.data)) {
    debugSellerOrderAction("semi-admin-catalog-fallback-participant-read-error", {
      error: participantRead.error?.message,
    }, env);
    return {};
  }

  const participantOrders = participantRead.data
    .filter((order) => isSemiAdminRowCatalogCandidate(order, auth.profile));
  const initialOrderById = new Map(participantOrders.map((order) => [order.id, order]));
  if (!initialOrderById.size) return {};

  const unitCatalogs = await mapWithConcurrency(
    [...initialOrderById.values()],
    SEMI_ADMIN_ROW_CATALOG_CONCURRENCY,
    async (order) => {
      const { data, error } = await userScopedClient.rpc(
        "semi_admin_get_order_command_catalog",
        { p_order_id: order.id }
      );
      if (error) {
        debugSellerOrderAction("semi-admin-catalog-fallback-unit-error", { error: error.message }, env);
        return [order.id, null];
      }
      return [order.id, data];
    }
  );

  const freshRead = await readSemiAdminRowCatalogOrders(auth.supabaseAdmin, [...initialOrderById.keys()]);
  if (freshRead.error || !Array.isArray(freshRead.data)) {
    debugSellerOrderAction("semi-admin-catalog-fallback-fresh-read-error", {
      error: freshRead.error?.message,
    }, env);
    return {};
  }

  const freshOrderById = new Map(freshRead.data.map((order) => [order.id, order]));
  const projected = {};
  const verifiedHistoryReturns = await mapWithConcurrency(
    [...initialOrderById.keys()],
    SEMI_ADMIN_ROW_CATALOG_CONCURRENCY,
    async (orderId) => {
      const order = freshOrderById.get(orderId);
      if (normalizeText(order?.status) !== ORDER_STATUS.IN_QUOTE
        || normalizeKey(order?.payment_status) !== "pending_payment"
        || !isSemiAdminQuoteActionParticipant(order, auth.profile)) return [orderId, null];
      try {
        return [orderId, await resolveHistoryVerifiedQuoteReturn(auth.supabaseAdmin, order)];
      } catch (error) {
        debugSellerOrderAction("semi-admin-catalog-fallback-history-return-error", {
          orderId,
          error: error?.message,
        }, env);
        return [orderId, null];
      }
    }
  );
  const historyReturnByOrderId = new Map(verifiedHistoryReturns);
  for (const [orderId, catalog] of unitCatalogs) {
    const initialOrder = initialOrderById.get(orderId);
    const freshOrder = freshOrderById.get(orderId);
    if (!initialOrder || !freshOrder
      || !isSemiAdminRowCatalogCandidate(freshOrder, auth.profile)
      || !SEMI_ADMIN_PARTICIPANT_FIELDS.some((field) => initialOrder[field] === auth.profile.id)
      || !areOrderTimestampsEquivalent(initialOrder.updated_at, freshOrder.updated_at)) continue;

    const safeCatalog = projectSemiAdminRowCatalog(
      catalog,
      orderId,
      freshOrder,
      auth.profile,
      historyReturnByOrderId.get(orderId)
    );
    if (safeCatalog) projected[orderId] = safeCatalog;
  }
  return projected;
}

// Delivery participation grants delivery actions, not financial or quote-stage authority.
const isSemiAdminQuoteActionParticipant = (order, profile) => (
  isSemiAdminProfile(profile)
  && SEMI_ADMIN_QUOTE_ACTION_FIELDS.some((field) => order?.[field] === profile?.id)
);

const isSemiAdminAssetParticipant = (order, profile) => (
  isSemiAdminParticipant(order, profile)
  && SEMI_ADMIN_ASSET_EDITABLE_STATUSES.has(normalizeText(order?.status))
  && !order?.is_archived
  && !order?.is_archived_admin
  && order?.operational_status !== "blocked"
);

const canSemiAdminConfirmDelivery = (order, profile) => (
  isSemiAdminProfile(profile)
  && order?.delivery_id === profile?.id
  && normalizeText(order?.status) === ORDER_STATUS.IN_COMPLETED
  && ["pagado", "credito"].includes(normalizeKey(order?.payment_status))
  && !order?.is_archived
  && order?.operational_status !== "blocked"
);

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

async function assertAssigneeRole(supabaseAdmin, userId, allowedRoles, label, env, { requireNotDeleted = false } = {}) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  const assigneeId = normalizeText(userId);
  if (!assigneeId) {
    return { response: jsonResponse(400, { error: `Debes seleccionar ${label}.` }) };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id,role,employment_status,deleted_at")
    .eq("id", assigneeId)
    .single();

  if (error || !profile) {
    debugSellerOrderAction("assignee-not-found", { assigneeId, allowedRoles: roles, error: error?.message }, env);
    return { response: jsonResponse(404, { error: `No se encontro ${label}.` }) };
  }

  if (!roles.includes(profile.role) || profile.employment_status === false || (requireNotDeleted && profile.deleted_at != null)) {
    debugSellerOrderAction("assignee-invalid", { assigneeId, role: profile.role, allowedRoles: roles }, env);
    return { response: jsonResponse(400, { error: `${label} no esta disponible para esta asignacion.` }) };
  }

  return { profile };
}

async function handleDetail(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (!isSemiAdminProfile(auth.profile)) {
    const { data: files, error: filesError } = await auth.supabaseAdmin
      .from("order_production_files")
      .select("id,order_id,url,filename,public_label,production_area_code,material_names,termination_name,status,assigned_to,updated_at")
      .eq("order_id", loaded.order.id)
      .order("created_at", { ascending: true });
    if (filesError) {
      debugSellerOrderAction("seller-detail-files-error", { orderId: loaded.order.id, error: filesError.message }, env);
      return jsonResponse(500, { error: "No se pudieron cargar los archivos de producción." });
    }
    return jsonResponse(200, { order: { ...loaded.order, order_production_files: files || [] } });
  }

  const [filesResult, operatorsResult, deliveryResult, stageUsersResult, operationalEventsResult] = await Promise.all([
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
      .select("id,actor_id,event_type,old_status,new_status,old_payment_status,new_payment_status,changes,created_at")
      .eq("order_id", loaded.order.id)
      .in("event_type", ["semi_admin_payment_updated", "semi_admin_stage_responsibility_changed", "semi_admin_return_quote_to_design", "semi_admin_return_quote_to_previous_stage"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (filesResult.error || operatorsResult.error || deliveryResult.error || stageUsersResult.error || operationalEventsResult.error) {
    debugSellerOrderAction("semi-admin-detail-operational-data-error", {
      files: filesResult.error?.message,
      operators: operatorsResult.error?.message,
      delivery: deliveryResult.error?.message,
      stageUsers: stageUsersResult.error?.message,
      operationalEvents: operationalEventsResult.error?.message,
    }, env);
    return jsonResponse(500, { error: "No se pudo cargar la información operativa de la orden." });
  }

  const events = operationalEventsResult.data || [];
  const actorIds = [...new Set(events.map((event) => event.actor_id).filter(Boolean))];
  let actors = [];
  if (actorIds.length > 0) {
    const actorResult = await auth.supabaseAdmin.from("profiles").select("id,name,role").in("id", actorIds);
    if (actorResult.error) {
      debugSellerOrderAction("semi-admin-detail-actor-data-error", { actors: actorResult.error?.message }, env);
      return jsonResponse(500, { error: "No se pudo cargar la auditoría operativa de la orden." });
    }
    actors = actorResult.data || [];
  }
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const history = events.map((event) => {
    const actor = actorById.get(event.actor_id);
    const stage = event.changes?.stage;
    const oldValue = event.old_payment_status || event.old_status || event.changes?.previous_responsible_id || null;
    const newValue = event.new_payment_status || event.new_status || event.changes?.responsible_id || null;
    return {
      id: event.id,
      event_type: event.event_type,
      created_at: event.created_at,
      actor: { id: event.actor_id || null, name: actor?.name || "Actor no disponible", role: actor?.role || null },
      label: event.event_type === "semi_admin_payment_updated"
        ? "Pago actualizado"
        : event.event_type === "semi_admin_return_quote_to_design"
          ? "Regresó a Diseño"
          : event.event_type === "semi_admin_return_quote_to_previous_stage"
            ? (event.changes?.target_stage === "sales" ? "Regresó a Ventas" : "Regresó a Diseño")
            : `Responsabilidad ${stage || "operativa"}`,
      old_value: oldValue,
      new_value: newValue,
    };
  });

  return jsonResponse(200, {
    order: {
      ...loaded.order,
      order_production_files: filesResult.data || [],
      semi_admin_operational_users: {
        production: operatorsResult.data || [],
        delivery: deliveryResult.data || [],
        stages: stageUsersResult.data || [],
      },
      semi_admin_stage_responsibility_history: events.filter((event) => event.event_type === "semi_admin_stage_responsibility_changed"),
      semi_admin_operational_history: history,
    },
  });
}

async function handleCancel(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const reason = normalizeText(payload.reason || payload.cancellation_reason);
  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;

  if (isSemiAdminProfile(auth.profile)) {
    if (!isOwnedByProfile(loaded.order, auth.profile)) {
      return jsonResponse(403, { error: "Solo puedes cancelar órdenes propias.", code: "ORDER_COMMAND_FORBIDDEN" });
    }
    if (!reason) return jsonResponse(400, { error: "Debes indicar el motivo de cancelacion." });
    if (!timestampsMatch(loaded.order.updated_at, expectedUpdatedAt)) {
      return jsonResponse(409, { error: "La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente." });
    }
    if (!isSemiAdminCancellableOrder(loaded.order, auth.profile)) {
      return jsonResponse(409, { error: "Semi-Administración solo puede cancelar órdenes propias, activas, preproducción y con pago pendiente." });
    }
    const updated = await callSellerOrderCommand(
      buildAuthenticatedSupabase(auth, env),
      "semi_admin_cancel_owned_unpaid_order",
      { p_order_id: loaded.order.id, p_reason: reason, p_expected_updated_at: expectedUpdatedAt },
      loaded.order,
      env
    );
    if (updated.response) return updated.response;
    return jsonResponse(200, { order: updated.order });
  }

  if (isPaymentPartial(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede cancelar una orden con pago parcial." });
  }

  if (isPaymentPaid(loaded.order.payment_status) || isPaymentCredit(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede cancelar una orden pagada o a credito." });
  }

  if (!reason) {
    return jsonResponse(400, { error: "Debes indicar el motivo de cancelacion." });
  }

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

  const assetOperation = isSemiAdminProfile(auth.profile) && payload.asset_operation === "manage_assets";
  if (assetOperation && !isSemiAdminAssetParticipant(loaded.order, auth.profile)) {
    return jsonResponse(403, { error: "Solo un Semi-Administrador participante o responsable puede gestionar los archivos de esta orden.", code: "SEMI_ADMIN_ASSET_FORBIDDEN" });
  }

  if (!isAdminProfile(auth.profile) && loaded.order.is_archived) {
    return jsonResponse(409, { error: "No se puede editar una orden archivada en Ventas." });
  }

  if (!isAdminProfile(auth.profile) && !assetOperation && SELLER_EDIT_BLOCKED_STATUSES.has(loaded.order.status)) {
    return jsonResponse(409, { error: "No se puede editar una orden en cotizacion." });
  }

  if (isSemiAdminProfile(auth.profile) && !assetOperation && [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_DELIVERED].includes(loaded.order.status)) {
    return jsonResponse(409, { error: "No se puede editar una orden cancelada o entregada." });
  }

  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt;
  if (!timestampsMatch(loaded.order.updated_at, expectedUpdatedAt)) {
    return jsonResponse(409, { error: "La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente." });
  }

  const rawChanges = payload.changes || payload.payload || payload;
  if (assetOperation && Object.keys(rawChanges || {}).some((field) => !SEMI_ADMIN_ASSET_FIELDS.has(field))) {
    return jsonResponse(400, { error: "La gestión de archivos solo puede modificar archivos y referencias.", code: "SEMI_ADMIN_ASSET_PAYLOAD" });
  }
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
  // Asset-only SemiAdmin calls never accept lifecycle/ownership fields from
  // the browser. The SQL function keeps the URL as the row identity and
  // applies its own pending-file guards for destructive operations.
  const commandProductionFileRows = assetOperation
    ? productionFileRows.map((row) => Object.fromEntries(
      Object.entries(row).filter(([field]) => !["status", "created_by", "updated_by", "order_id"].includes(field))
    ))
    : productionFileRows;
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
        new_production_files: commandProductionFileRows,
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
    env,
    { requireNotDeleted: semiAdminActor }
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
  if (semiAdminActor
    && loaded.order.seller_id !== auth.profile.id
    && loaded.order.created_by !== auth.profile.id) {
    return jsonResponse(403, { error: "Solo el responsable Semi-Admin de Ventas puede enviar esta orden externa a Caja." });
  }

  const assignee = await assertAssigneeRole(
    auth.supabaseAdmin,
    payload.quote_user_id || payload.quoteUserId,
    "quote",
    "un usuario de caja",
    env,
    { requireNotDeleted: true }
  );
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

const resolveHistoryVerifiedQuoteReturn = async (supabaseAdmin, order) => {
  if (!order?.id || order.status !== ORDER_STATUS.IN_QUOTE || order.payment_status !== "Pending_Payment") return null;
  const { data: events, error } = await supabaseAdmin
    .from("order_events")
    .select("id,event_type,old_status,new_status,old_payment_status,new_payment_status,changes,created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(80);
  if (error) throw error;

  const paymentEvent = (events || []).find((event) => (
    event.event_type === "semi_admin_payment_updated"
    && event.old_payment_status === "pagado"
    && event.new_payment_status === "Pending_Payment"
    && event.changes?.correction === "paid_to_pending_in_quote"
  ));

  const routeTypes = order.order_design_type === "EXTERNAL_DESING"
    ? { eventType: "semi_admin_send_to_quote", oldStatus: "Pending", targetStatus: "Pending", title: "Regresar a Ventas", targetStage: "sales" }
    : order.order_design_type === "INTERNAL_DESING"
      ? { eventType: "semi_admin_send_design_to_quote", oldStatus: "in_Design", targetStatus: "in_Design", title: "Regresar a Diseño", targetStage: "design" }
      : null;
  if (!routeTypes) return null;

  const routeEvent = (events || []).find((event) => (
    event.event_type === routeTypes.eventType
    && event.old_status === routeTypes.oldStatus
    && event.new_status === ORDER_STATUS.IN_QUOTE
    && new Date(event.created_at).getTime() <= (paymentEvent ? new Date(paymentEvent.created_at).getTime() : Date.now())
  ));
  if (!routeEvent) return null;
  return { ...routeTypes, paymentEventId: paymentEvent?.id || null, routeEventId: routeEvent.id };
};

async function handleSemiAdminOperationalCatalog(payload, auth, env) {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  const { data, error } = await buildAuthenticatedSupabase(auth, env)
    .rpc("semi_admin_get_order_command_catalog", { p_order_id: loaded.order.id });
  if (error) return jsonResponse(400, { error: error.message || "No se pudo consultar la configuración operativa." });
  const catalog = data || { actions: [], unavailable_actions: [] };
  catalog.actions = (catalog.actions || []).filter((action) => !["register_payment", "grant_credit", "payment_operations"].includes(action?.key));
  catalog.unavailable_actions = (catalog.unavailable_actions || []).filter((action) => !["register_payment", "grant_credit", "payment_operations"].includes(action?.key));
  const productionPaymentEligible = ["pagado", "parcial", "credito"].includes(normalizeKey(loaded.order.payment_status));
  const hasProductionAuthorization = Boolean(
    loaded.order.production_authorized_at && loaded.order.production_authorized_by
  );
  if (normalizeText(loaded.order.status) === ORDER_STATUS.IN_QUOTE
      && productionPaymentEligible
      && !hasProductionAuthorization) {
    catalog.actions = (catalog.actions || []).filter((action) => action?.key !== "route_production");
    catalog.unavailable_actions = [
      ...(catalog.unavailable_actions || []).filter((action) => action?.key !== "route_production"),
      {
        key: "route_production",
        title: "Envío pendiente de autorización",
        next_safe_step: "Caja o Administración debe autorizar la orden antes de prepararla para Producción.",
      },
    ];
  }
  const invoicePending = loaded.order.invoice_assignment_mode === "cashier"
    && !String(loaded.order.invoice_number || "").trim();
  if (invoicePending) {
    const blockedKeys = new Set(["route_production", "mark_delivered"]);
    catalog.actions = (catalog.actions || []).filter((action) => !blockedKeys.has(action?.key));
    catalog.unavailable_actions = [
      ...(catalog.unavailable_actions || []).filter((action) => !blockedKeys.has(action?.key)),
      {
        key: "invoice_code_required",
        title: "Código de facturación pendiente",
        next_safe_step: "Caja debe registrar el código de facturación antes de continuar la orden.",
      },
    ];
  }

  const previousStageReturn = await resolveHistoryVerifiedQuoteReturn(auth.supabaseAdmin, loaded.order);
  catalog.actions = (catalog.actions || []).filter((action) => (
    action?.key !== "return_quote_to_design" && action?.key !== "return_quote_to_previous_stage"
  ));
  catalog.unavailable_actions = (catalog.unavailable_actions || []).filter((action) => (
    action?.key !== "return_quote_to_design" && action?.key !== "return_quote_to_previous_stage"
  ));
  const canManageDesignAssets = isSemiAdminAssetParticipant(loaded.order, auth.profile);
  if (!catalog.locked && canManageDesignAssets && !catalog.actions.some((action) => action?.key === "manage_design_assets")) {
    catalog.actions = [
      ...(catalog.actions || []),
      { key: "manage_design_assets", title: "Gestionar diseños y archivos" },
    ];
  }
  if (previousStageReturn && isSemiAdminQuoteActionParticipant(loaded.order, auth.profile)) {
    catalog.actions = [
      ...(catalog.actions || []),
      { key: "return_quote_to_previous_stage", title: previousStageReturn.title, requires_reason: true, target_stage: previousStageReturn.targetStage },
    ];
  }
  if (!canSemiAdminConfirmDelivery(loaded.order, auth.profile)) {
    catalog.actions = (catalog.actions || []).filter((action) => action?.key !== "mark_delivered");
  }
  return jsonResponse(200, { catalog });
}

async function handleSemiAdminOrderCommand(payload, auth, env, command, argsBuilder, resultKey = "order", preflight = null) {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  if (preflight) {
    const preflightResponse = await preflight(loaded.order);
    if (preflightResponse) return preflightResponse;
  }
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

const handleSellerRouteProduction = async (payload, auth, env) => {
  if (auth.profile?.role !== "seller") {
    return jsonResponse(403, {
      error: "Solo Ventas puede enviar órdenes de Diseño Externo a Producción.",
      code: "SELLER_PRODUCTION_ROLE_FORBIDDEN",
    });
  }

  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const order = loaded.order;
  if (order.order_design_type !== "EXTERNAL_DESING") {
    return jsonResponse(403, { error: "Solo Ventas puede enviar órdenes de Diseño Externo a Producción.", code: "SELLER_PRODUCTION_DESIGN_TYPE_FORBIDDEN" });
  }
  if (order.status !== ORDER_STATUS.IN_QUOTE) {
    return jsonResponse(409, { error: "La orden debe estar en Caja antes de enviarse a Producción.", code: "SELLER_PRODUCTION_STATUS_INVALID" });
  }
  if (!isPaymentProductionEligible(order.payment_status)) {
    return jsonResponse(409, { error: "El pago debe ser pagado, parcial o a crédito antes de continuar.", code: "SELLER_PRODUCTION_PAYMENT_REQUIRED" });
  }
  if (!order.production_authorized_at || !order.production_authorized_by) {
    return jsonResponse(409, { error: "Caja o Administración debe autorizar la orden antes de enviarla a Producción.", code: "SELLER_PRODUCTION_AUTHORIZATION_REQUIRED" });
  }
  if (order.is_archived || order.operational_status === "blocked") {
    return jsonResponse(409, { error: "La orden está archivada o bloqueada.", code: "SELLER_PRODUCTION_ORDER_LOCKED" });
  }

  const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || order.updated_at;
  if (!timestampsMatch(order.updated_at, expectedUpdatedAt)) {
    return jsonResponse(409, { error: "La orden cambió mientras la editabas. Actualiza los datos e intenta nuevamente." });
  }

  const result = await callSellerOrderCommand(
    buildAuthenticatedSupabase(auth, env),
    "send_order_to_production",
    {
      p_order_id: order.id,
      p_area_assignments: payload.area_assignments || payload.areaAssignments || {},
    },
    order,
    env
  );
  if (result.response) return result.response;
  return jsonResponse(200, { order: result.order });
};

const handleStageResponsibility = (payload, auth, env) => handleSemiAdminOrderCommand(
  payload, auth, env, "semi_admin_assign_stage_responsibility",
  (order, expectedUpdatedAt) => ({
    p_order_id: order.id,
    p_stage: normalizeKey(payload.stage),
    p_assignee_id: payload.assignee_id || payload.assigneeId,
    p_expected_updated_at: expectedUpdatedAt,
    p_production_area_code: normalizeText(payload.production_area_code || payload.productionAreaCode) || null,
  }),
  "order",
  async () => {
    if (normalizeKey(payload.stage) !== "quote") return null;
    const assignee = await assertAssigneeRole(
      auth.supabaseAdmin,
      payload.assignee_id || payload.assigneeId,
      "quote",
      "un usuario de caja",
      env,
      { requireNotDeleted: true }
    );
    return assignee.response || null;
  }
);

async function handleSemiAdminCatalogCommand(payload, auth, env, action) {
  const roleError = requireSemiAdminAction(auth);
  if (roleError) return roleError;
  if (["register_payment", "grant_credit", "payment_operations"].includes(action)) {
    return jsonResponse(403, { error: "Solo el responsable asignado de Caja puede gestionar pagos, comprobantes o crédito.", code: "CASHIER_PAYMENT_OWNERSHIP_REQUIRED" });
  }
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  const isResponsible = isSemiAdminQuoteActionParticipant(loaded.order, auth.profile);
  if (action === "return_quote_to_design" && (loaded.order.status !== ORDER_STATUS.IN_QUOTE || loaded.order.payment_status !== "Pending_Payment" || !loaded.order.designer_id || !isResponsible)) {
    return jsonResponse(isResponsible ? 409 : 403, { error: "El regreso a Diseño requiere Caja, pago pendiente y un diseñador asignado.", code: "SEMI_ADMIN_RETURN_FORBIDDEN" });
  }
  if (action === "return_quote_to_previous_stage") {
    const target = await resolveHistoryVerifiedQuoteReturn(auth.supabaseAdmin, loaded.order);
    if (!target || !isResponsible) {
      return jsonResponse(isResponsible ? 409 : 403, { error: "El retorno requiere una corrección de pago y una transición previa auditada.", code: "SEMI_ADMIN_RETURN_HISTORY_REQUIRED" });
    }
    const expectedUpdatedAt = payload.expected_updated_at || payload.expectedUpdatedAt || loaded.order.updated_at;
    const result = await callSellerOrderCommand(
      buildAuthenticatedSupabase(auth, env),
      "semi_admin_return_quote_to_previous_stage",
      {
        p_order_id: loaded.order.id,
        p_reason: payload.reason || "",
        p_expected_updated_at: expectedUpdatedAt,
      },
      loaded.order,
      env
    );
    if (result.response) return result.response;
    return jsonResponse(200, { order: result.order });
  }
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
  let operationalCatalogs;
  if (isSemiAdminProfile(auth.profile)) {
    const orders = Array.isArray(listResult.data) ? listResult.data : [];
    const recentOrders = Array.isArray(recentResult.data) ? recentResult.data : [];
    const rowOrdersById = new Map(recentOrders.map((order) => [order.id, order]));
    for (const order of orders) {
      if (!rowOrdersById.has(order.id)) rowOrdersById.set(order.id, order);
    }
    // Recent records are a separate surface from the filtered page; prioritize
    // them so the bounded batch still covers every order shown in that surface.
    const orderIds = [...new Set([...recentOrders, ...orders].map((order) => normalizeText(order?.id)).filter(Boolean))]
      .slice(0, SEMI_ADMIN_ROW_CATALOG_MAX_IDS);
    operationalCatalogs = {};
    if (orderIds.length) {
      const userScopedClient = buildAuthenticatedSupabase(auth, env);
      if (userScopedClient) {
        const { data, error } = await userScopedClient.rpc("semi_admin_get_orders_command_catalog", { p_order_ids: orderIds });
        if (error) {
          const recoverable = isRecoverableSemiAdminBatchCatalogError(error);
          debugSellerOrderAction(recoverable
            ? "semi-admin-batch-catalog-unavailable-fallback"
            : "semi-admin-batch-catalog-error",
          {
            code: error.code,
            error: error.message,
          }, env);
          if (recoverable) {
            operationalCatalogs = await loadSemiAdminRowCatalogFallback(orderIds, auth, userScopedClient, env);
          }
        } else if (data && typeof data === "object" && !Array.isArray(data)) {
          for (const orderId of orderIds) {
            const catalog = data[orderId];
            if (!catalog || catalog.order_id !== orderId || !catalog.order_updated_at) continue;
            const rowOrder = rowOrdersById.get(orderId);
            if (!rowOrder
              || !areOrderTimestampsEquivalent(catalog.order_updated_at, rowOrder.updated_at)
              || !isSemiAdminRowCatalogCandidate(rowOrder, auth.profile)) continue;
            const actions = Array.isArray(catalog.actions) ? catalog.actions : [];
            const allowedKeys = new Set(getSemiAdminRowCatalogActionKeys(rowOrder));
            operationalCatalogs[orderId] = {
              order_id: orderId,
              order_updated_at: catalog.order_updated_at,
              actions: actions.map((action) => ({
                key: normalizeText(action?.key),
                title: SEMI_ADMIN_ROW_CATALOG_ACTION_TITLES.get(normalizeText(action?.key)) || "",
              })).filter((action) => action.title
                && allowedKeys.has(action.key)),
            };
          }

          // Reconcile row actions against the same authenticated single-order
          // catalog used by the operational detail flow. The batch catalog may
          // omit a valid forward/return action; the fallback rechecks the order,
          // participant and updated_at before exposing any missing action.
          const needsIndividualCatalogOrderIds = orderIds.filter((orderId) => {
            const rowOrder = rowOrdersById.get(orderId);
            const projectedActions = operationalCatalogs[orderId]?.actions || [];
            const designReturnCandidate = [ORDER_STATUS.IN_DESIGN, "In_Design"].includes(normalizeText(rowOrder?.status))
              && normalizeText(rowOrder?.order_design_type) === "INTERNAL_DESING"
              && rowOrder?.designer_id === auth.profile.id
              && !projectedActions.some((action) => action.key === "return_design_to_sales");
            const historyReturnCandidate = normalizeText(rowOrder?.status) === ORDER_STATUS.IN_QUOTE
              && normalizeKey(rowOrder?.payment_status) === "pending_payment"
              && SEMI_ADMIN_QUOTE_ACTION_FIELDS.some((field) => rowOrder?.[field] === auth.profile.id);
            return designReturnCandidate || historyReturnCandidate;
          });

          if (needsIndividualCatalogOrderIds.length) {
            const individualCatalogs = await loadSemiAdminRowCatalogFallback(
              needsIndividualCatalogOrderIds,
              auth,
              userScopedClient,
              env
            );

            for (const orderId of needsIndividualCatalogOrderIds) {
              const rowOrder = rowOrdersById.get(orderId);
              const individualCatalog = individualCatalogs[orderId];
              if (!rowOrder
                || !individualCatalog?.actions?.length
                || !areOrderTimestampsEquivalent(individualCatalog.order_updated_at, rowOrder.updated_at)
                || !isSemiAdminRowCatalogCandidate(rowOrder, auth.profile)) continue;

              const existing = operationalCatalogs[orderId];
              const actionByKey = new Map((existing?.actions || []).map((action) => [action.key, action]));
              for (const action of individualCatalog.actions) actionByKey.set(action.key, action);
              operationalCatalogs[orderId] = {
                order_id: orderId,
                order_updated_at: individualCatalog.order_updated_at,
                actions: [...actionByKey.values()],
              };
            }
          }
        }
      }
    }
  }
  return jsonResponse(200, {
    orders: Array.isArray(listResult.data) ? listResult.data : [],
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    summary: buildSummary(Array.isArray(summaryResult.data) ? summaryResult.data : [], env.now),
    recent_orders: Array.isArray(recentResult.data) ? recentResult.data : [],
    ...(operationalCatalogs ? { operational_catalogs: operationalCatalogs } : {}),
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
  seller_route_production: handleSellerRouteProduction,
  stage_responsibility: handleStageResponsibility,
  register_payment: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "register_payment"),
  return_quote_to_design: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "return_quote_to_design"),
  return_quote_to_previous_stage: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "return_quote_to_previous_stage"),
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
