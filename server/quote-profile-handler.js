import { requireAuthenticated } from "./auth-middleware.js";
import { isMissingColumnOrRelationError } from "./admin-employee-utils.js";
import { applyProfilePeriod, resolveProfilePeriod } from "./profile-period-utils.js";

const COMPLETED_STATUSES = new Set(["in_completed", "in_delivered"]);
const ACTIVE_STATUSES = new Set(["pending", "in_design", "in_quote", "in_production", "in_termination"]);
const CANCELLED_STATUSES = new Set(["cancelled"]);
const QUOTE_COLUMNS = "id,name,email,role,employment_status,created_at";
const ORDER_COLUMNS = [
  "id",
  "quote_id",
  "quotation_id",
  "quote_user_id",
  "seller_id",
  "created_by",
  "status",
  "created_at",
  "is_archived_quote",
  "payment_status",
  "price",
  "order_type",
  "client_name",
  "client_id",
].join(",");
const ORDER_COLUMNS_FALLBACK = [
  "id",
  "quote_id",
  "seller_id",
  "created_by",
  "status",
  "created_at",
  "is_archived_quote",
  "payment_status",
  "price",
  "order_type",
  "client_name",
  "client_id",
].join(",");

const getQuoteOwnerId = (order) => order.quote_id || order.quotation_id || order.quote_user_id || null;
const applyQuoteOwnerFilter = (query, userId) => query.or(`quote_id.eq.${userId},quotation_id.eq.${userId},quote_user_id.eq.${userId}`);
const applyQuoteOwnerFallbackFilter = (query, userId) => query.eq("quote_id", userId);

const roundPct = (value) => Math.round(value * 10) / 10;
const normalizeStatus = (status) => String(status || "").trim().toLowerCase();
const getPct = (count, total) => (total > 0 ? roundPct((count / total) * 100) : 0);

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const isDateWithin = (value, start, end) => {
  const date = parseDate(value);
  return Boolean(date && date >= start && date < end);
};

const addDays = (date, amount) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const startOfUtcMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const formatDayLabel = (date) => date.toLocaleDateString("es-DO", { timeZone: "UTC", day: "2-digit", month: "short" });
const formatMonthLabel = (date) => date.toLocaleDateString("es-DO", { timeZone: "UTC", month: "short", year: "numeric" });

const toRankedRows = (counter, total) => [...counter.entries()]
  .map(([name, count]) => ({ name, count, percentage: getPct(count, total) }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const createEmptyStats = (profile) => ({
  id: profile.id,
  name: profile.name || profile.email || "Cotizador",
  total_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  paid_orders: 0,
  partial_paid_orders: 0,
  credit_orders: 0,
  pending_payment_orders: 0,
});

const finalizeStats = (stats) => {
  const total = stats.total_orders || 0;
  return {
    ...stats,
    completion_rate: total > 0 ? roundPct((stats.completed_orders / total) * 100) : 0,
    cancellation_rate: total > 0 ? roundPct((stats.cancelled_orders / total) * 100) : 0,
    payment_rate: total > 0 ? roundPct((stats.paid_orders / total) * 100) : 0,
  };
};

const sortQuoteStats = (a, b) => (
  (b.completion_rate || 0) - (a.completion_rate || 0)
  || (b.completed_orders || 0) - (a.completed_orders || 0)
  || (b.total_orders || 0) - (a.total_orders || 0)
  || (a.cancelled_orders || 0) - (b.cancelled_orders || 0)
  || String(a.name || "").localeCompare(String(b.name || ""))
);

const createPaymentTypeAnalytics = (orders) => {
  const total = orders.length;
  const paid = orders.filter((o) => normalizeStatus(o.payment_status) === "pagado").length;
  const partial = orders.filter((o) => normalizeStatus(o.payment_status) === "parcial").length;
  const credit = orders.filter((o) => normalizeStatus(o.payment_status) === "credito").length;
  const pending = orders.filter((o) => normalizeStatus(o.payment_status) === "pending_payment").length;
  return {
    total,
    rows: [
      { name: "Pagado", value: paid, percentage: getPct(paid, total) },
      { name: "Parcial", value: partial, percentage: getPct(partial, total) },
      { name: "Credito", value: credit, percentage: getPct(credit, total) },
      { name: "Pendiente", value: pending, percentage: getPct(pending, total) },
    ].filter((r) => r.value > 0),
  };
};

const createTopClients = (orders) => {
  const counter = new Map();
  orders.forEach((order) => {
    const name = String(order.client_name || order.client_id || "Sin cliente").trim() || "Sin cliente";
    counter.set(name, (counter.get(name) || 0) + 1);
  });
  return toRankedRows(counter, orders.length);
};

const createTrendAnalytics = (orders, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const today = startOfUtcDay(safeNow);
  const monthStart = startOfUtcMonth(safeNow);
  const nextMonth = new Date(Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth() + 1, 1));

  const currentMonthBuckets = [];
  for (let day = new Date(monthStart); day < nextMonth; day = addDays(day, 1)) {
    currentMonthBuckets.push({
      key: day.toISOString().slice(0, 10),
      label: formatDayLabel(day),
      start: new Date(day),
      end: addDays(day, 1),
    });
  }

  const last30Buckets = [];
  const last30Start = addDays(today, -29);
  for (let day = new Date(last30Start); day <= today; day = addDays(day, 1)) {
    last30Buckets.push({
      key: day.toISOString().slice(0, 10),
      label: formatDayLabel(day),
      start: new Date(day),
      end: addDays(day, 1),
    });
  }

  const weeklyBuckets = [];
  const weeklyStart = addDays(today, -84);
  for (let week = 0; week < 13; week += 1) {
    const start = addDays(weeklyStart, week * 7);
    weeklyBuckets.push({
      key: start.toISOString().slice(0, 10),
      label: formatDayLabel(start),
      start,
      end: addDays(start, 7),
    });
  }

  const monthlyBuckets = [];
  for (let index = 11; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth() - index, 1));
    monthlyBuckets.push({
      key: start.toISOString().slice(0, 7),
      label: formatMonthLabel(start),
      start,
      end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
    });
  }

  const bucketize = (buckets) => buckets.map(({ key, label, start, end }) => ({
    key,
    label,
    count: orders.filter((order) => isDateWithin(order.created_at, start, end)).length,
  }));

  return {
    dia: bucketize(currentMonthBuckets),
    "30d": bucketize(last30Buckets),
    "3m": bucketize(weeklyBuckets),
    mensual: bucketize(monthlyBuckets),
  };
};

const createPaymentSummary = (orders) => {
  const summary = { pagado: 0, pendiente: 0, parcial: 0, credito_pendiente: 0 };
  orders.forEach((order) => {
    const ps = String(order.payment_status || "").toLowerCase();
    if (ps === "pagado" || ps === "paid") summary.pagado += 1;
    else if (ps === "parcial" || ps === "partial") summary.parcial += 1;
    else if (ps === "credito" || ps === "credit") summary.credito_pendiente += 1;
    else summary.pendiente += 1;
  });
  return summary;
};

export async function handleQuoteProfile(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["quote", "admin"] });
  if (!auth.authorized) {
    return { status: auth.status || 401, body: { error: auth.error } };
  }

  const supabase = auth.supabaseAdmin;
  const userId = auth.profile?.id;
  if (!userId) {
    return { status: 403, body: { error: "Tu perfil no esta disponible." } };
  }

  const period = resolveProfilePeriod(payload?.period, env.now);

  try {
    const [
      { data: quoteProfiles, error: profilesError },
      rankingOrdersResult,
      ownOrdersResult,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select(QUOTE_COLUMNS)
        .eq("role", "quote"),
      applyProfilePeriod(supabase
        .from("orders")
        .select(ORDER_COLUMNS), period),
      applyProfilePeriod(applyQuoteOwnerFilter(
        supabase
          .from("orders")
          .select(ORDER_COLUMNS),
        userId
      ), period),
    ]);

    if (profilesError) throw profilesError;

    let scopedOrders = rankingOrdersResult.data;
    let ordersError = rankingOrdersResult.error;
    let ownOrders = ownOrdersResult.data;
    let ownOrdersError = ownOrdersResult.error;

    if (ordersError && isMissingColumnOrRelationError(ordersError)) {
      const fallback = await applyProfilePeriod(supabase
        .from("orders")
        .select(ORDER_COLUMNS_FALLBACK), period);
      scopedOrders = fallback.data;
      ordersError = fallback.error;
    }

    if (ownOrdersError && isMissingColumnOrRelationError(ownOrdersError)) {
      const fallback = await applyProfilePeriod(applyQuoteOwnerFallbackFilter(
        supabase
          .from("orders")
          .select(ORDER_COLUMNS_FALLBACK),
        userId
      ), period);
      ownOrders = fallback.data;
      ownOrdersError = fallback.error;
    }

    if (ordersError) throw ordersError;
    if (ownOrdersError) throw ownOrdersError;

    const activeQuoters = (quoteProfiles || []).filter((p) => p.employment_status !== false);
    const statsByQuote = new Map(activeQuoters.map((p) => [p.id, createEmptyStats(p)]));

    (scopedOrders || []).forEach((order) => {
      const ownerId = getQuoteOwnerId(order);
      if (!ownerId) return;
      const stats = statsByQuote.get(ownerId);
      if (!stats) return;

      const status = normalizeStatus(order.status);
      const ps = normalizeStatus(order.payment_status);
      stats.total_orders += 1;
      if (COMPLETED_STATUSES.has(status)) stats.completed_orders += 1;
      if (!order.is_archived_quote && ACTIVE_STATUSES.has(status)) stats.active_orders += 1;
      if (CANCELLED_STATUSES.has(status)) stats.cancelled_orders += 1;
      if (ps === "pagado" || ps === "paid") stats.paid_orders += 1;
      else if (ps === "parcial" || ps === "partial") stats.partial_paid_orders += 1;
      else if (ps === "credito" || ps === "credit") stats.credit_orders += 1;
      else stats.pending_payment_orders += 1;
    });

    const rankedStats = [...statsByQuote.values()].map(finalizeStats).sort(sortQuoteStats);
    const currentStats = rankedStats.find((s) => s.id === userId) || finalizeStats(createEmptyStats(auth.profile));
    const position = auth.profile.role === "quote"
      ? rankedStats.findIndex((s) => s.id === userId) + 1
      : null;

    const ownScopedOrders = (ownOrders || []).filter((o) => getQuoteOwnerId(o) === userId);

    const paymentSummary = createPaymentSummary(ownScopedOrders);
    const uniqueClients = new Set(ownScopedOrders.map((o) => o.client_name || o.client_id).filter(Boolean));
    const archivedCount = ownScopedOrders.filter((o) => o.is_archived_quote).length;

    const metrics = {
      total_orders: currentStats.total_orders,
      completed_orders: currentStats.completed_orders,
      active_orders: currentStats.active_orders,
      cancelled_orders: currentStats.cancelled_orders,
      paid_orders: currentStats.paid_orders,
      partial_paid_orders: currentStats.partial_paid_orders,
      credit_orders: currentStats.credit_orders,
      pending_payment_orders: currentStats.pending_payment_orders,
      completion_rate: currentStats.completion_rate,
      cancellation_rate: currentStats.cancellation_rate,
      payment_rate: currentStats.payment_rate,
      clients_served: uniqueClients.size,
      archived_orders: archivedCount,
    };

    const paymentAnalytics = createPaymentTypeAnalytics(ownScopedOrders);
    const topClients = createTopClients(ownScopedOrders);

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period,
        ranking: {
          position: position || null,
          total_quoters: rankedStats.length,
          metric_label: "Mejor % Confirmacion de Pago",
          score: currentStats.payment_rate,
        },
        metrics,
        analytics: {
          payment_types: paymentAnalytics,
          payment_summary: paymentSummary,
          top_clients: topClients,
          trends: createTrendAnalytics(ownScopedOrders, env.now),
        },
      },
    };
  } catch (error) {
    console.error("[QuoteProfile] Error:", error?.message, error);
    return {
      status: 500,
      body: { error: error?.message || "No se pudo cargar el perfil del cotizador." },
    };
  }
}
