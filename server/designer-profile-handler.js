import { requireAuthenticated } from "./auth-middleware.js";
import { applyProfilePeriod, isInProfilePeriod, resolveProfilePeriod } from "./profile-period-utils.js";

const COMPLETED_STATUSES = new Set(["in_completed", "in_delivered"]);
const ACTIVE_STATUSES = new Set(["pending", "in_design", "in_quote", "in_production", "in_termination"]);
const PENDING_STATUSES = new Set(["pending", "in_design", "in_quote"]);
const READY_TO_QUOTE_STATUSES = new Set(["in_quote", "in_production", "in_termination", "in_completed", "in_delivered"]);
const DESIGNER_PROFILE_COLUMNS = "id,name,email,role,employment_status,created_at";
const ORDER_COLUMNS = [
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
  "returned_to_designer_at",
  "order_file_url",
  "preview_image",
].join(",");
const PRODUCTION_FILE_COLUMNS = [
  "id",
  "order_id",
  "filename",
  "public_label",
  "production_area_code",
  "status",
  "created_by",
  "created_at",
].join(",");
const PRODUCTION_AREA_COLUMNS = "code,label";

const FALLBACK_PRODUCTION_AREA_LABELS = {
  digital: "Digital",
  dtf: "DTF",
  ploteo: "Ploteo",
};

const PRODUCTION_FILE_STATUS_LABELS = {
  pending: "Pendiente",
  in_production: "En produccion",
  in_termination: "En terminacion",
  completed: "Completado",
};

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

const hasDesignerReturn = (order) => (
  normalizeStatus(order.status) === "in_design"
  && Boolean(String(order.return_reason || "").trim())
);
const hasPreview = (order) => Boolean(String(order.preview_image || "").trim());
const getProductionAreaLabel = (code, areaLabels = FALLBACK_PRODUCTION_AREA_LABELS) => {
  const normalizedCode = String(code || "").trim();
  return areaLabels[normalizedCode] || FALLBACK_PRODUCTION_AREA_LABELS[normalizedCode] || "Sin clasificar";
};
const getFileDesignerId = (file, orderDesignerById) => file.created_by || orderDesignerById.get(file.order_id) || null;

const createEmptyStats = (profile) => ({
  id: profile.id,
  name: profile.name || profile.email || "Disenador",
  total_orders: 0,
  assigned_orders: 0,
  ready_to_quote_orders: 0,
  returned_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  cancelled_orders: 0,
  delivered_orders: 0,
  files_created: 0,
  classified_files: 0,
  preview_orders: 0,
  ready_to_quote_rate: 0,
  return_rate: 0,
  classification_rate: 0,
  preview_coverage_rate: 0,
  completion_rate: 0,
  cancellation_rate: 0,
  design_score: 0,
});

const finalizeStats = (stats) => {
  const total = stats.assigned_orders || stats.total_orders || 0;
  const files = stats.files_created || 0;
  const readyToQuoteRate = getPct(stats.ready_to_quote_orders, total);
  const returnRate = getPct(stats.returned_orders, total);

  return {
    ...stats,
    total_orders: total,
    assigned_orders: total,
    ready_to_quote_rate: readyToQuoteRate,
    return_rate: returnRate,
    classification_rate: getPct(stats.classified_files, files),
    preview_coverage_rate: getPct(stats.preview_orders, total),
    completion_rate: getPct(stats.completed_orders, total),
    cancellation_rate: getPct(stats.cancelled_orders, total),
    design_score: Math.max(0, roundPct(readyToQuoteRate - returnRate)),
  };
};

const getDesignerLevel = ({ position, totalDesigners, designScore }) => {
  if (!position || !totalDesigners) return "Sin ranking";
  const percentile = position / totalDesigners;
  if (percentile <= 0.1 && designScore >= 80) return "Nivel destacado";
  if (percentile <= 0.25 && designScore >= 70) return "Nivel alto";
  if (percentile <= 0.5) return "Nivel en crecimiento";
  return "Nivel inicial";
};

const countGoals = (stats) => {
  const hasActivity = (stats.assigned_orders || stats.total_orders || 0) > 0;
  const cleanAdvance = hasActivity && (stats.ready_to_quote_rate || 0) >= 70;
  const returnsControlled = hasActivity && (stats.return_rate || 0) <= 15;
  const filesClassified = (stats.files_created || 0) > 0 && (stats.classification_rate || 0) >= 90;
  return [hasActivity, cleanAdvance, returnsControlled, filesClassified].filter(Boolean).length;
};

const sortDesignerStats = (a, b) => (
  (b.ready_to_quote_rate || 0) - (a.ready_to_quote_rate || 0)
  || (a.return_rate || 0) - (b.return_rate || 0)
  || (b.files_created || 0) - (a.files_created || 0)
  || (b.assigned_orders || 0) - (a.assigned_orders || 0)
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

const toRankedRows = (counter, total, limit = 5) => [...counter.entries()]
  .map(([name, count]) => ({ name, count, percentage: getPct(count, total) }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .slice(0, limit);

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

const createProductionFileStatus = (files) => {
  const summary = {
    pending: 0,
    in_production: 0,
    in_termination: 0,
    completed: 0,
    total: files.length,
    rows: [],
  };

  files.forEach((file) => {
    const status = normalizeStatus(file.status || "pending");
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    } else {
      summary.pending += 1;
    }
  });

  summary.rows = ["pending", "in_production", "in_termination", "completed"].map((status) => ({
    key: status,
    name: PRODUCTION_FILE_STATUS_LABELS[status],
    value: summary[status],
    percentage: getPct(summary[status], files.length),
  }));

  return summary;
};

const createTopProductionAreas = (files, areaLabels) => {
  const counter = new Map();
  files.forEach((file) => {
    const name = getProductionAreaLabel(file.production_area_code, areaLabels);
    counter.set(name, (counter.get(name) || 0) + 1);
  });
  return toRankedRows(counter, files.length);
};

const createStatusSummary = (orders, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const todayStart = startOfUtcDay(Number.isNaN(now.getTime()) ? new Date() : now);
  const summary = { active: 0, completed: 0, pending: 0, cancelled: 0, overdue: 0 };

  orders.forEach((order) => {
    const status = normalizeStatus(order.status);
    if (!order.is_archived && ACTIVE_STATUSES.has(status)) summary.active += 1;
    if (COMPLETED_STATUSES.has(status)) summary.completed += 1;
    if (PENDING_STATUSES.has(status)) summary.pending += 1;
    if (status === "cancelled") summary.cancelled += 1;

    const deliveryDate = parseDate(order.delivery_date);
    if (deliveryDate && deliveryDate < todayStart && !COMPLETED_STATUSES.has(status) && status !== "cancelled") {
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

const createAnalytics = ({ orders, currentMonthOrders, currentMonthFiles, productionAreaLabels, now }) => ({
  order_types: createOrderTypeAnalytics(currentMonthOrders),
  trends: createTrendAnalytics(orders, now),
  top_materials: createTopMaterials(currentMonthOrders),
  top_clients: createTopClients(currentMonthOrders),
  production_file_status: createProductionFileStatus(currentMonthFiles),
  top_production_areas: createTopProductionAreas(currentMonthFiles, productionAreaLabels),
  status_summary: createStatusSummary(currentMonthOrders, now),
});

export async function handleDesignerProfile(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["designer", "admin"] });
  if (!auth.authorized) {
    return { status: auth.status || 401, body: { error: auth.error } };
  }

  const supabase = auth.supabaseAdmin;
  const period = resolveProfilePeriod(payload?.period, env.now);
  const userId = auth.profile?.id;
  if (!userId) {
    return { status: 403, body: { error: "Tu perfil no esta disponible." } };
  }

  try {
    const [
      { data: designerProfiles, error: designersError },
      { data: scopedOrders, error: ordersError },
      { data: productionFiles, error: filesError },
      { data: productionAreas, error: areasError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select(DESIGNER_PROFILE_COLUMNS)
        .eq("role", "designer"),
      applyProfilePeriod(supabase
        .from("orders")
        .select(ORDER_COLUMNS), period),
      applyProfilePeriod(supabase
        .from("order_production_files")
        .select(PRODUCTION_FILE_COLUMNS), period),
      supabase
        .from("production_areas")
        .select(PRODUCTION_AREA_COLUMNS),
    ]);

    if (designersError) throw designersError;
    if (ordersError) throw ordersError;
    if (filesError) throw filesError;
    if (areasError) throw areasError;

    const activeDesigners = (designerProfiles || []).filter((profile) => profile.employment_status !== false);
    const statsByDesigner = new Map(activeDesigners.map((profile) => [profile.id, createEmptyStats(profile)]));
    const productionAreaLabels = (productionAreas || []).reduce((labels, area) => ({
      ...labels,
      [area.code]: area.label,
    }), FALLBACK_PRODUCTION_AREA_LABELS);
    const allOrders = scopedOrders || [];
    const allFiles = productionFiles || [];
    const orderDesignerById = new Map(allOrders.map((order) => [order.id, order.designer_id]));
    const periodOrders = allOrders.filter((order) => isInProfilePeriod(order.created_at, period));
    const periodFiles = allFiles.filter((file) => isInProfilePeriod(file.created_at, period));

    periodOrders.forEach((order) => {
      const designerId = order.designer_id;
      const stats = statsByDesigner.get(designerId);
      if (!stats) return;

      const status = normalizeStatus(order.status);
      stats.total_orders += 1;
      stats.assigned_orders += 1;
      if (READY_TO_QUOTE_STATUSES.has(status)) stats.ready_to_quote_orders += 1;
      if (hasDesignerReturn(order)) stats.returned_orders += 1;
      if (hasPreview(order)) stats.preview_orders += 1;
      if (COMPLETED_STATUSES.has(status)) stats.completed_orders += 1;
      if (status === "in_delivered") stats.delivered_orders += 1;
      if (status === "cancelled") stats.cancelled_orders += 1;
      if (!order.is_archived && ACTIVE_STATUSES.has(status)) stats.active_orders += 1;
    });

    periodFiles.forEach((file) => {
      const designerId = getFileDesignerId(file, orderDesignerById);
      const stats = statsByDesigner.get(designerId);
      if (!stats) return;

      stats.files_created += 1;
      if (file.production_area_code) stats.classified_files += 1;
    });

    const rankedStats = [...statsByDesigner.values()].map(finalizeStats).sort(sortDesignerStats);
    const currentDesignerStats = rankedStats.find((stats) => stats.id === userId) || finalizeStats(createEmptyStats(auth.profile));
    const position = auth.profile.role === "designer"
      ? rankedStats.findIndex((stats) => stats.id === userId) + 1
      : null;

    const metrics = {
      total_orders: currentDesignerStats.total_orders,
      assigned_orders: currentDesignerStats.assigned_orders,
      ready_to_quote_orders: currentDesignerStats.ready_to_quote_orders,
      returned_orders: currentDesignerStats.returned_orders,
      completed_orders: currentDesignerStats.completed_orders,
      active_orders: currentDesignerStats.active_orders,
      cancelled_orders: currentDesignerStats.cancelled_orders,
      delivered_orders: currentDesignerStats.delivered_orders,
      files_created: currentDesignerStats.files_created,
      classified_files: currentDesignerStats.classified_files,
      preview_orders: currentDesignerStats.preview_orders,
      ready_to_quote_rate: currentDesignerStats.ready_to_quote_rate,
      return_rate: currentDesignerStats.return_rate,
      classification_rate: currentDesignerStats.classification_rate,
      preview_coverage_rate: currentDesignerStats.preview_coverage_rate,
      completion_rate: currentDesignerStats.completion_rate,
      cancellation_rate: currentDesignerStats.cancellation_rate,
      goals_achieved: countGoals(currentDesignerStats),
    };

    const ownOrders = allOrders.filter((order) => order.designer_id === userId);
    const ownOrderIds = new Set(ownOrders.map((order) => order.id));
    const ownCurrentOrders = periodOrders.filter((order) => order.designer_id === userId);
    const ownCurrentFiles = periodFiles.filter((file) => (
      file.created_by === userId
      || (!file.created_by && ownOrderIds.has(file.order_id))
    ));

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period,
        ranking: {
          position: position || null,
          total_designers: rankedStats.length,
          metric_label: "Avance limpio a caja",
          level: getDesignerLevel({
            position,
            totalDesigners: rankedStats.length,
            designScore: currentDesignerStats.design_score,
          }),
          score: currentDesignerStats.design_score,
        },
        metrics,
        analytics: createAnalytics({
          orders: ownOrders,
          currentMonthOrders: ownCurrentOrders,
          currentMonthFiles: ownCurrentFiles,
          productionAreaLabels,
          now: env.now,
        }),
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: error?.message || "No se pudo cargar el perfil del disenador." },
    };
  }
}
