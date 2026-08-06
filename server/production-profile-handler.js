import { requireAuthenticated } from "./auth-middleware.js";

const COMPLETED_STATUSES = new Set(["in_completed", "in_delivered"]);
const ACTIVE_STATUSES = new Set(["in_production", "in_termination", "in_completed"]);
const PRODUCTION_PROFILE_COLUMNS = "id,name,email,role,employment_status,created_at";
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
].join(",");
const PRODUCTION_FILE_COLUMNS = [
  "id",
  "order_id",
  "filename",
  "public_label",
  "production_area_code",
  "status",
  "assigned_to",
  "created_by",
  "created_at",
  "completed_at",
].join(",");
const ASSIGNMENT_COLUMNS = "order_id,production_area_code,assigned_to";

const PRODUCTION_AREA_ROLES = {
  digital_producer: "digital",
  dtf_producer: "dtf",
  ploteo_producer: "ploteo",
};

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

const getAnalyticsBounds = (nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const start = new Date(Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth() - 11, 1));
  const end = new Date(Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth() + 1, 1));
  return { date_from: start.toISOString(), date_to: end.toISOString() };
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

const getFileProductionAreaCode = (file) => String(file.production_area_code || "").trim();

const getUserAreaCode = (role) => PRODUCTION_AREA_ROLES[role] || null;

const isFileAssignedToUser = (file, userId) => Boolean(userId && file.assigned_to === userId);

const isFileInUserArea = (file, userAreaCode) => {
  const fileArea = getFileProductionAreaCode(file);
  return Boolean(userAreaCode && fileArea === userAreaCode);
};

const hasAreaAssignmentForUser = (assignments, userAreaCode, userId) => (
  Boolean(userId && userAreaCode && assignments.some((assignment) => (
    assignment.assigned_to === userId
    && assignment.production_area_code === userAreaCode
  )))
);

const isOrderAssignedToUserArea = (orderId, userAreaCode, userId, assignmentsByOrder) => {
  const assignments = assignmentsByOrder?.get(orderId) || [];
  return hasAreaAssignmentForUser(assignments, userAreaCode, userId);
};

const isOrderRelevantToUser = (order, userAreaCode, userId, filesByOrder, assignmentsByOrder) => {
  const files = filesByOrder?.get(order.id) || [];
  if (files.some((file) => isFileAssignedToUser(file, userId))) return true;
  return (
    isOrderAssignedToUserArea(order.id, userAreaCode, userId, assignmentsByOrder)
    && files.some((file) => isFileInUserArea(file, userAreaCode))
  );
};

const getFilesRelevantToUser = (files, userAreaCode, userId, assignmentsByOrder) => (
  (files || []).filter((file) => (
    isFileAssignedToUser(file, userId)
    || (
      isFileInUserArea(file, userAreaCode)
      && isOrderAssignedToUserArea(file.order_id, userAreaCode, userId, assignmentsByOrder)
    )
  ))
);

const buildFilesByOrder = (files) => {
  const map = new Map();
  (files || []).forEach((file) => {
    const orderId = file.order_id;
    if (!orderId) return;
    if (!map.has(orderId)) map.set(orderId, []);
    map.get(orderId).push(file);
  });
  return map;
};

const buildAssignmentsByOrder = (assignments) => {
  const map = new Map();
  (assignments || []).forEach((assignment) => {
    const orderId = assignment.order_id;
    if (!orderId) return;
    if (!map.has(orderId)) map.set(orderId, []);
    map.get(orderId).push(assignment);
  });
  return map;
};

const createEmptyStats = (profile) => ({
  id: profile.id,
  name: profile.name || profile.email || "Productor",
  total_orders: 0,
  completed_orders: 0,
  active_orders: 0,
  delivered_orders: 0,
  cancelled_orders: 0,
  files_processed: 0,
  files_completed: 0,
  completion_rate: 0,
  termination_rate: 0,
});

const finalizeStats = (stats) => {
  const total = stats.total_orders || 0;
  const filesProcessed = stats.files_processed || 0;
  return {
    ...stats,
    completion_rate: total > 0 ? roundPct((stats.completed_orders / total) * 100) : 0,
    termination_rate: filesProcessed > 0 ? roundPct((stats.files_completed / filesProcessed) * 100) : 0,
  };
};

const getProductionLevel = ({ position, totalProducers, completionRate }) => {
  if (!position || !totalProducers) return "Sin ranking";
  const percentile = position / totalProducers;
  if (percentile <= 0.1 && completionRate >= 80) return "Nivel destacado";
  if (percentile <= 0.25 && completionRate >= 70) return "Nivel alto";
  if (percentile <= 0.5) return "Nivel en crecimiento";
  return "Nivel inicial";
};

const countGoals = (stats) => {
  const hasActivity = (stats.total_orders || 0) > 0;
  const completionHealthy = hasActivity && (stats.completion_rate || 0) >= 70;
  const cancellationControlled = hasActivity && (stats.cancelled_orders || 0) <= 2;
  return [hasActivity, completionHealthy, cancellationControlled].filter(Boolean).length;
};

const sortProducerStats = (a, b) => (
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
    ].filter((row) => row.value > 0),
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

const createStatusSummary = (orders, nowValue) => {
  const now = nowValue ? new Date(nowValue) : new Date();
  const todayStart = startOfUtcDay(Number.isNaN(now.getTime()) ? new Date() : now);
  const summary = { in_production: 0, in_termination: 0, delivered: 0, completed: 0, cancelled: 0 };

  orders.forEach((order) => {
    const status = normalizeStatus(order.status);
    if (status === "in_production") summary.in_production += 1;
    if (status === "in_termination") summary.in_termination += 1;
    if (status === "in_delivered") summary.delivered += 1;
    if (status === "in_completed") summary.completed += 1;
    if (status === "cancelled") summary.cancelled += 1;
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

const createAnalytics = ({ orders, files, now }) => ({
  order_types: createOrderTypeAnalytics(orders),
  trends: createTrendAnalytics(orders, now),
  top_materials: createTopMaterials(orders),
  top_clients: createTopClients(orders),
  production_file_status: createProductionFileStatus(files),
  status_summary: createStatusSummary(orders, now),
});

export async function handleProductionProfile(payload = {}, env = process.env) {
  void payload;
  try {
    const auth = await requireAuthenticated(env.authHeader || "", env, {
      allowedRoles: ["digital_producer", "dtf_producer", "ploteo_producer", "admin"],
    });
    if (!auth.authorized) {
      return { status: auth.status || 401, body: { error: auth.error } };
    }

    const supabase = auth.supabaseAdmin;
    const analyticsBounds = getAnalyticsBounds(env.now);
    const userId = auth.profile.id;
    const userAreaCode = getUserAreaCode(auth.profile.role);

    const [
      { data: producerProfiles, error: profilesError },
      { data: scopedOrders, error: ordersError },
      { data: productionFiles, error: filesError },
      { data: orderAssignments, error: assignmentsError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select(PRODUCTION_PROFILE_COLUMNS)
        .in("role", ["digital_producer", "dtf_producer", "ploteo_producer"]),
      supabase
        .from("orders")
        .select(ORDER_COLUMNS),
      supabase
        .from("order_production_files")
        .select(PRODUCTION_FILE_COLUMNS),
      supabase
        .from("order_production_assignments")
        .select(ASSIGNMENT_COLUMNS),
    ]);

    if (profilesError) throw profilesError;
    if (ordersError) throw ordersError;
    if (filesError) throw filesError;
    if (assignmentsError) throw assignmentsError;

    const activeProducers = (producerProfiles || []).filter((profile) => profile.employment_status !== false);
    const statsByProducer = new Map(activeProducers.map((profile) => [profile.id, createEmptyStats(profile)]));
    const allOrders = scopedOrders || [];
    const allFiles = productionFiles || [];
    const filesByOrder = buildFilesByOrder(allFiles);
    const assignmentsByOrder = buildAssignmentsByOrder(orderAssignments || []);

    allOrders.forEach((order) => {
      const orderFiles = filesByOrder.get(order.id) || [];

      const status = normalizeStatus(order.status);
      const isCompleted = COMPLETED_STATUSES.has(status);
      const isActive = ACTIVE_STATUSES.has(status);
      const isCancelled = status === "cancelled";
      const isDelivered = status === "in_delivered";

      activeProducers.forEach((profile) => {
        const producerId = profile.id;
        const producerAreaCode = getUserAreaCode(profile.role);
        const relevantFiles = getFilesRelevantToUser(orderFiles, producerAreaCode, producerId, assignmentsByOrder);
        if (relevantFiles.length === 0 && !isOrderRelevantToUser(order, producerAreaCode, producerId, filesByOrder, assignmentsByOrder)) return;

        const stats = statsByProducer.get(producerId);
        if (!stats) return;

        stats.total_orders += 1;
        if (isCompleted) stats.completed_orders += 1;
        if (isActive) stats.active_orders += 1;
        if (isDelivered) stats.delivered_orders += 1;
        if (isCancelled) stats.cancelled_orders += 1;
        relevantFiles.forEach((file) => {
          stats.files_processed += 1;
          const fileStatus = normalizeStatus(file.status);
          if (fileStatus === "completed") stats.files_completed += 1;
        });
      });
    });

    const ownOrders = allOrders.filter((order) => isOrderRelevantToUser(order, userAreaCode, userId, filesByOrder, assignmentsByOrder));
    const ownFiles = getFilesRelevantToUser(allFiles, userAreaCode, userId, assignmentsByOrder);

    const rankedStats = [...statsByProducer.values()].map(finalizeStats).sort(sortProducerStats);
    const currentStats = rankedStats.find((stats) => stats.id === userId) || finalizeStats(createEmptyStats(auth.profile));
    const position = auth.profile.role !== "admin"
      ? rankedStats.findIndex((stats) => stats.id === userId) + 1
      : null;

    const metrics = {
      orders_completed: currentStats.completed_orders,
      completion_rate: currentStats.completion_rate,
      orders_active: currentStats.active_orders,
      orders_delivered: currentStats.delivered_orders,
      orders_cancelled: currentStats.cancelled_orders,
      total_orders: currentStats.total_orders,
      goals_achieved: countGoals(currentStats),
      files_processed: currentStats.files_processed,
      avg_completion_time: 0,
      termination_rate: currentStats.termination_rate,
    };

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period: {
          ...analyticsBounds,
          label: "Ordenes asignadas",
        },
        ranking: {
          position: position || null,
          total_producers: rankedStats.length,
          metric_label: "Mejor % Finalizacion",
          level: getProductionLevel({
            position,
            totalProducers: rankedStats.length,
            completionRate: currentStats.completion_rate,
          }),
          score: currentStats.completion_rate,
        },
        metrics,
        analytics: (() => {
          try {
            return createAnalytics({
              orders: ownOrders,
              files: ownFiles,
              now: env.now,
            });
          } catch (analyticsError) {
            console.error("[ProductionProfile] analytics error:", analyticsError?.message || analyticsError);
            return {
              order_types: createOrderTypeAnalytics([]),
              trends: {},
              top_materials: [],
              top_clients: [],
              production_file_status: createProductionFileStatus([]),
              status_summary: { in_production: 0, in_termination: 0, delivered: 0, completed: 0, cancelled: 0 },
            };
          }
        })(),
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: error?.message || "No se pudo cargar el perfil de produccion." },
    };
  }
}
