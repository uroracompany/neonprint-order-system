import { requireAuthenticated } from "./auth-middleware.js";
import { applyProfilePeriod, isInProfilePeriod, resolveProfilePeriod } from "./profile-period-utils.js";

const COMPLETED_STATUSES = new Set(["completed", "in_completed"]);
const DELIVERED_STATUSES = new Set(["delivered", "in_delivered"]);
const CANCELLED_STATUSES = new Set(["cancelled"]);
const PENDING_STATUSES = new Set(["pending", "in_design", "in_quote"]);
const SELLER_PROFILE_COLUMNS = "id,name,email,role,employment_status,created_at";
const DESIGNER_PROFILE_COLUMNS = "id,name,email,role";
const SELLER_ORDER_COLUMNS = [
  "id",
  "seller_id",
  "created_by",
  "status",
  "created_at",
  "is_archived",
  "order_type",
  "material",
  "designer_id",
  "client_id",
  "client_name",
  "delivery_date",
  "return_reason",
  "order_design_type",
].join(",");

const roundPct = (value) => Math.round(value * 10) / 10;

const normalizeStatus = (status) => String(status || "").trim().toLowerCase();
const getOwnerId = (order) => order.seller_id || order.created_by;
const isOwnedBySeller = (order, userId) => order.seller_id === userId || order.created_by === userId;
const getPct = (count, total) => (total > 0 ? roundPct((count / total) * 100) : 0);
const applySellerOwnerFilter = (query, userId) => query.or(`seller_id.eq.${userId},created_by.eq.${userId}`);
const isActiveOrder = (order) => {
  const status = normalizeStatus(order.status);
  return !order.is_archived && !DELIVERED_STATUSES.has(status) && !CANCELLED_STATUSES.has(status);
};
const isReturnedOrder = (order) => {
  if (!String(order.return_reason || "").trim()) return false;
  const returnedStatus = order.order_design_type === "EXTERNAL_DESING" ? "pending" : "in_design";
  return normalizeStatus(order.status) === returnedStatus;
};

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

const createEmptyStats = (profile) => ({
  id: profile.id,
  name: profile.name || profile.email || "Vendedor",
  total_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  delivered_orders: 0,
  completion_rate: 0,
  cancellation_rate: 0,
});

const addOrderToStats = (stats, order) => {
  const status = normalizeStatus(order.status);
  stats.total_orders += 1;
  if (COMPLETED_STATUSES.has(status)) stats.completed_orders += 1;
  if (DELIVERED_STATUSES.has(status)) stats.delivered_orders += 1;
  if (CANCELLED_STATUSES.has(status)) stats.cancelled_orders += 1;
  if (isActiveOrder(order)) stats.active_orders += 1;
};

const finalizeStats = (stats) => {
  const total = stats.total_orders || 0;
  return {
    ...stats,
    completion_rate: total > 0 ? roundPct((stats.completed_orders / total) * 100) : 0,
    cancellation_rate: total > 0 ? roundPct((stats.cancelled_orders / total) * 100) : 0,
  };
};

const getSellerLevel = ({ position, totalSellers, completionRate }) => {
  if (!position || !totalSellers) return "Sin ranking";
  const percentile = position / totalSellers;
  if (percentile <= 0.1 && completionRate >= 80) return "Nivel destacado";
  if (percentile <= 0.25 && completionRate >= 70) return "Nivel alto";
  if (percentile <= 0.5) return "Nivel en crecimiento";
  return "Nivel inicial";
};

const countGoals = (stats) => {
  const hasActivity = (stats.total_orders || 0) > 0;
  const completionHealthy = hasActivity && (stats.completion_rate || 0) >= 70;
  const cancellationControlled = hasActivity && (stats.cancellation_rate || 0) <= 15;
  return [hasActivity, completionHealthy, cancellationControlled].filter(Boolean).length;
};

const sortSellerStats = (a, b) => (
  (b.completion_rate || 0) - (a.completion_rate || 0)
  || (b.completed_orders || 0) - (a.completed_orders || 0)
  || (b.total_orders || 0) - (a.total_orders || 0)
  || (a.cancelled_orders || 0) - (b.cancelled_orders || 0)
  || String(a.name || "").localeCompare(String(b.name || ""))
);

const createOrderTypeAnalytics = (orders) => {
  const total = orders.length;
  const urgent = orders.filter((order) => String(order.order_type || "").toLowerCase().includes("911")).length;
  const normal = total - urgent;
  return {
    total,
    normal: { label: "Normales", count: normal, percentage: getPct(normal, total) },
    urgent: { label: "911", count: urgent, percentage: getPct(urgent, total) },
    rows: [
      { name: "Normales", value: normal, percentage: getPct(normal, total) },
      { name: "911", value: urgent, percentage: getPct(urgent, total) },
    ],
  };
};

const splitMaterials = (material) => {
  const parts = String(material || "")
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : ["Otros"];
};

const toRankedRows = (counter, total) => [...counter.entries()]
  .map(([name, count]) => ({ name, count, percentage: getPct(count, total) }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const createTopMaterials = (orders) => {
  const counter = new Map();
  let total = 0;
  orders.forEach((order) => {
    splitMaterials(order.material).forEach((material) => {
      total += 1;
      counter.set(material, (counter.get(material) || 0) + 1);
    });
  });
  return toRankedRows(counter, total);
};

const createTopClients = (orders) => {
  const counter = new Map();
  orders.forEach((order) => {
    const name = String(order.client_name || order.client_id || "Sin cliente").trim() || "Sin cliente";
    counter.set(name, (counter.get(name) || 0) + 1);
  });
  return toRankedRows(counter, orders.length);
};

const createTopDesigner = (orders, designerProfiles) => {
  const counter = new Map();
  orders.forEach((order) => {
    if (!order.designer_id) return;
    counter.set(order.designer_id, (counter.get(order.designer_id) || 0) + 1);
  });

  const [topDesignerId, topCount] = [...counter.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] || [];
  if (!topDesignerId) {
    return { name: "Sin asignaciones", count: 0, percentage: 0 };
  }

  const profile = (designerProfiles || []).find((designer) => designer.id === topDesignerId);
  return {
    name: profile?.name || profile?.email || "Disenador asignado",
    count: topCount,
    percentage: getPct(topCount, orders.length),
  };
};

const createStatusSummary = (orders, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const todayStart = startOfUtcDay(Number.isNaN(now.getTime()) ? new Date() : now);
  const summary = {
    active: 0,
    completed: 0,
    pending: 0,
    cancelled: 0,
    overdue: 0,
    returned: 0,
  };

  orders.forEach((order) => {
    const status = normalizeStatus(order.status);
    if (isActiveOrder(order)) summary.active += 1;
    if (COMPLETED_STATUSES.has(status)) summary.completed += 1;
    if (PENDING_STATUSES.has(status)) summary.pending += 1;
    if (CANCELLED_STATUSES.has(status)) summary.cancelled += 1;
    if (isReturnedOrder(order)) summary.returned += 1;

    const deliveryDate = parseDate(order.delivery_date);
    if (deliveryDate && deliveryDate < todayStart && !isReturnedOrder(order) && !COMPLETED_STATUSES.has(status) && !DELIVERED_STATUSES.has(status) && !CANCELLED_STATUSES.has(status)) {
      summary.overdue += 1;
    }
  });

  return summary;
};

const createBucketRows = (orders, buckets) => buckets.map(({ key, label, start, end }) => ({
  key,
  label,
  count: orders.filter((order) => isDateWithin(order.created_at, start, end)).length,
}));

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

  return {
    dia: createBucketRows(orders, currentMonthBuckets),
    "30d": createBucketRows(orders, last30Buckets),
    "3m": createBucketRows(orders, weeklyBuckets),
    mensual: createBucketRows(orders, monthlyBuckets),
  };
};

const createAnalytics = ({ orders, currentMonthOrders, designerProfiles, now }) => ({
  order_types: createOrderTypeAnalytics(currentMonthOrders),
  trends: createTrendAnalytics(orders, now),
  top_designer: createTopDesigner(currentMonthOrders, designerProfiles),
  top_materials: createTopMaterials(currentMonthOrders),
  top_clients: createTopClients(currentMonthOrders),
  status_summary: createStatusSummary(currentMonthOrders, now),
});

export async function handleSellerProfile(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["seller", "admin"] });
  if (!auth.authorized) {
      return { status: auth.status || 401, body: { error: auth.error, code: auth.code } };
  }

  const supabase = auth.supabaseAdmin;
  const userId = auth.profile?.id;
  if (!userId) {
    return { status: 403, body: { error: "Tu perfil no esta disponible." } };
  }

  const period = resolveProfilePeriod(payload?.period, env.now);
  const rankingPeriod = period.key === "all" ? resolveProfilePeriod("month", env.now) : period;

  try {
    const [
      { data: sellerProfiles, error: profilesError },
      { data: designerProfiles, error: designersError },
      { data: rankingOrders, error: rankingOrdersError },
      { data: ownOrders, error: ownOrdersError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select(SELLER_PROFILE_COLUMNS)
        .eq("role", "seller"),
      supabase
        .from("profiles")
        .select(DESIGNER_PROFILE_COLUMNS)
        .eq("role", "designer"),
      applyProfilePeriod(supabase
        .from("orders")
        .select(SELLER_ORDER_COLUMNS), rankingPeriod),
      applyProfilePeriod(applySellerOwnerFilter(
        supabase
          .from("orders")
          .select(SELLER_ORDER_COLUMNS),
        userId
      ), period),
    ]);

    if (profilesError) throw profilesError;
    if (designersError) throw designersError;
    if (rankingOrdersError) throw rankingOrdersError;
    if (ownOrdersError) throw ownOrdersError;

    const activeSellers = (sellerProfiles || []).filter((profile) => profile.employment_status !== false);
    const statsBySeller = new Map(activeSellers.map((profile) => [profile.id, createEmptyStats(profile)]));
    const periodOrders = (rankingOrders || []).filter((order) => isInProfilePeriod(order.created_at, rankingPeriod));

    periodOrders.forEach((order) => {
      const ownerId = getOwnerId(order);
      const stats = statsBySeller.get(ownerId);
      if (!stats) return;

      addOrderToStats(stats, order);
    });

    const rankedStats = [...statsBySeller.values()].map(finalizeStats).sort(sortSellerStats);
    const ownScopedOrders = (ownOrders || []).filter((order) => isOwnedBySeller(order, userId));
    const currentSellerStats = finalizeStats(ownScopedOrders.reduce((stats, order) => {
      addOrderToStats(stats, order);
      return stats;
    }, createEmptyStats(auth.profile)));
    const position = auth.profile.role === "seller"
      ? rankedStats.findIndex((stats) => stats.id === userId) + 1
      : null;

    const metrics = {
      total_orders: currentSellerStats.total_orders,
      completed_orders: currentSellerStats.completed_orders,
      active_orders: currentSellerStats.active_orders,
      cancelled_orders: currentSellerStats.cancelled_orders,
      delivered_orders: currentSellerStats.delivered_orders,
      completion_rate: currentSellerStats.completion_rate,
      cancellation_rate: currentSellerStats.cancellation_rate,
      goals_achieved: countGoals(currentSellerStats),
    };
    const ownCurrentOrders = ownScopedOrders;

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period,
        ranking: {
          position: position || null,
          total_sellers: rankedStats.length,
          metric_label: "Mejor % Finalizacion",
          level: getSellerLevel({
            position,
            totalSellers: rankedStats.length,
            completionRate: currentSellerStats.completion_rate,
          }),
          score: currentSellerStats.completion_rate,
        },
        metrics,
        analytics: createAnalytics({
          orders: ownScopedOrders,
          currentMonthOrders: ownCurrentOrders,
          designerProfiles,
          now: env.now,
        }),
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: "No se pudo cargar el perfil del vendedor.", code: "SELLER_PROFILE_LOOKUP_FAILED" },
    };
  }
}
