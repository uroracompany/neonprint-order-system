const COMPLETED_ORDER_STATUSES = new Set(["in_Completed", "in_Delivered"]);
const ACTIVE_ORDER_STATUSES = new Set(["Pending", "in_Design", "in_Quote", "in_Production", "in_Termination"]);
const PRODUCTION_STATUSES = new Set(["pending", "in_production", "in_termination", "completed"]);

export const PRODUCTION_AREAS = ["digital", "dtf", "ploteo"];
export const TEAM_ROLES = ["seller", "designer", "digital_producer", "dtf_producer", "ploteo_producer"];

const AREA_ROLE = { digital: "digital_producer", dtf: "dtf_producer", ploteo: "ploteo_producer" };
const AREA_LABEL = { digital: "Digital", dtf: "DTF", ploteo: "Ploteo" };

const finiteDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const round = (value, digits = 1) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : 0;
};

const percentage = (value, total) => total ? round((value / total) * 100) : 0;

const changePct = (current, previous) => {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return curr > 0 ? 100 : 0;
  return round(((curr - prev) / prev) * 100);
};

const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
};

const isInRange = (value, from, to) => {
  const date = finiteDate(value);
  return Boolean(date && date >= from && date < to);
};

const safeName = (profile) => profile?.name || profile?.email || "Empleado sin nombre";

const getOrderOwner = (order, field) => field === "seller"
  ? order?.seller_id || order?.created_by || null
  : order?.designer_id || null;

const getProductionOwner = (file) => file?.assigned_to || file?.created_by || null;

const normalizeOrder = (order) => ({
  ...order,
  is_archived_admin: Boolean(order?.is_archived_admin),
});

const normalizeFile = (file) => ({
  ...file,
  status: String(file?.status || "").toLowerCase(),
});

const cycleDays = (row) => {
  const start = finiteDate(row?.created_at);
  const end = finiteDate(row?.status_changed_at || row?.completed_at);
  if (!start || !end || end < start) return null;
  return (end - start) / 86400000;
};

const fileCycleDays = (file) => {
  const start = finiteDate(file?.started_at);
  const end = finiteDate(file?.completed_at);
  if (!start || !end || end < start) return null;
  return (end - start) / 86400000;
};

const countOrders = (orders) => ({
  total: orders.length,
  active: orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).length,
  completed: orders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status)).length,
  delivered: orders.filter((order) => order.status === "in_Delivered").length,
  cancelled: orders.filter((order) => order.status === "cancelled").length,
});

const orderSummary = (orders) => {
  const counts = countOrders(orders);
  const cycles = orders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status)).map(cycleDays);
  return {
    total_orders: counts.total,
    active_orders: counts.active,
    completed_orders: counts.completed,
    delivered_orders: counts.delivered,
    cancelled_orders: counts.cancelled,
    completion_rate: percentage(counts.completed, counts.total),
    cancellation_rate: percentage(counts.cancelled, counts.total),
    avg_cycle_days: average(cycles),
  };
};

const fileSummary = (files, orderMap) => {
  const total = files.length;
  const totalOrders = new Set(files.map((file) => file.order_id).filter(Boolean)).size;
  const completed = files.filter((file) => file.status === "completed");
  const reversions = files.filter((file) => file.status === "in_production" && file.in_termination_at).length;
  const normal = files.filter((file) => orderMap.get(file.order_id)?.order_type !== "orden 911").length;
  const urgent = files.length - normal;
  return {
    total_files: total,
    total_orders: totalOrders,
    pending: files.filter((file) => file.status === "pending").length,
    in_production: files.filter((file) => file.status === "in_production").length,
    in_termination: files.filter((file) => file.status === "in_termination").length,
    completed: completed.length,
    active_files: files.filter((file) => ["pending", "in_production", "in_termination"].includes(file.status)).length,
    completion_rate: percentage(completed.length, total),
    avg_time_days: average(completed.map(fileCycleDays)),
    reversions,
    reversion_rate: percentage(reversions, total),
    first_time_right: completed.length ? round(Math.max(0, ((completed.length - reversions) / completed.length) * 100)) : 100,
    files_per_day: 0,
    normal_orders: normal,
    urgent_911_orders: urgent,
    urgent_rate: percentage(urgent, total),
  };
};

const metricComparison = (current, previous, keys) => Object.fromEntries(keys.map((key) => [key, {
  current: Number(current?.[key]) || 0,
  previous: Number(previous?.[key]) || 0,
  change_pct: changePct(current?.[key], previous?.[key]),
}]));

const periodGranularity = (from, to) => {
  const days = (to - from) / 86400000;
  return days <= 45 ? "day" : days <= 210 ? "week" : "month";
};

const startBucket = (date, granularity) => {
  const result = new Date(date);
  if (granularity === "day") result.setUTCHours(0, 0, 0, 0);
  if (granularity === "week") {
    const day = result.getUTCDay();
    result.setUTCDate(result.getUTCDate() - day);
    result.setUTCHours(0, 0, 0, 0);
  }
  if (granularity === "month") {
    result.setUTCDate(1);
    result.setUTCHours(0, 0, 0, 0);
  }
  return result;
};

const nextBucket = (date, granularity) => {
  const result = new Date(date);
  if (granularity === "day") result.setUTCDate(result.getUTCDate() + 1);
  if (granularity === "week") result.setUTCDate(result.getUTCDate() + 7);
  if (granularity === "month") result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
};

export function buildZeroFilledTrend({ orders = [], files = [], from, to }) {
  const start = finiteDate(from);
  const end = finiteDate(to);
  if (!start || !end || end <= start) return { granularity: "day", points: [] };
  const granularity = periodGranularity(start, end);
  const points = new Map();
  for (let cursor = startBucket(start, granularity); cursor < end && points.size < 750; cursor = nextBucket(cursor, granularity)) {
    const key = cursor.toISOString().slice(0, 10);
    points.set(key, { date: key, sales: 0, design: 0, production: 0, total: 0 });
  }
  orders.forEach((order) => {
    const key = startBucket(order.created_at, granularity).toISOString().slice(0, 10);
    const point = points.get(key);
    if (!point) return;
    point.sales += getOrderOwner(order, "seller") ? 1 : 0;
    point.design += order.designer_id ? 1 : 0;
  });
  files.forEach((file) => {
    const key = startBucket(file.created_at, granularity).toISOString().slice(0, 10);
    const point = points.get(key);
    if (point && PRODUCTION_AREAS.includes(file.production_area_code)) point.production += 1;
  });
  points.forEach((point) => { point.total = point.sales + point.design + point.production; });
  return { granularity, points: [...points.values()] };
}

function sortRanking(rows, primary, secondary = "total") {
  const sorted = [...rows].sort((left, right) => (
    (Number(right[primary]) || 0) - (Number(left[primary]) || 0)
    || (Number(right[secondary]) || 0) - (Number(left[secondary]) || 0)
    || (Number(left.completion_rate) || 0) - (Number(right.completion_rate) || 0)
    || (Number(left.avg_time_days) || 0) - (Number(right.avg_time_days) || 0)
    || String(left.name).localeCompare(String(right.name), "es")
  ));
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildRoleRanking(profiles, orders, role, previousOrders = []) {
  const rows = profiles.filter((profile) => profile.role === role).map((profile) => {
    const scoped = orders.filter((order) => getOrderOwner(order, role === "seller" ? "seller" : "designer") === profile.id);
    const previous = previousOrders.filter((order) => getOrderOwner(order, role === "seller" ? "seller" : "designer") === profile.id);
    const summary = orderSummary(scoped);
    return {
      id: profile.id,
      name: safeName(profile),
      role: profile.role,
      total: summary.total_orders,
      completed: summary.completed_orders,
      delivered: summary.delivered_orders,
      cancelled: summary.cancelled_orders,
      completion_rate: summary.completion_rate,
      cancellation_rate: summary.cancellation_rate,
      avg_time_days: summary.avg_cycle_days,
      normal_orders: scoped.filter((order) => order.order_type !== "orden 911").length,
      urgent_911_orders: scoped.filter((order) => order.order_type === "orden 911").length,
      period_change_pct: changePct(scoped.length, previous.length),
    };
  });
  return sortRanking(rows, "completed", "total");
}

function buildProductionRanking(profiles, files, area, previousFiles = [], from, to) {
  const role = AREA_ROLE[area];
  const rows = profiles.filter((profile) => profile.role === role).map((profile) => {
    const scoped = files.filter((file) => file.production_area_code === area && getProductionOwner(file) === profile.id);
    const previous = previousFiles.filter((file) => file.production_area_code === area && getProductionOwner(file) === profile.id);
    const summary = fileSummary(scoped, new Map());
    const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000);
    return {
      id: profile.id,
      name: safeName(profile),
      role: profile.role,
      total_files: summary.total_files,
      completed: summary.completed,
      pending: summary.pending,
      in_production: summary.in_production,
      in_termination: summary.in_termination,
      active_files: summary.active_files,
      avg_time_days: summary.avg_time_days,
      reversions: summary.reversions,
      reversion_rate: summary.reversion_rate,
      first_time_right: summary.first_time_right,
      files_per_day: round(summary.completed / periodDays, 2),
      efficiency_score: round(Math.min(100, Math.min(summary.completed / periodDays * 20, 40) + Math.min(summary.first_time_right * 0.3, 30) + Math.min(summary.avg_time_days ? Math.max(0, 30 - summary.avg_time_days * 3) : 15, 30)), 0),
      period_change_pct: changePct(scoped.length, previous.length),
    };
  });
  return sortRanking(rows, "completed", "efficiency_score");
}

function buildSalesOrDesign(profiles, orders, previousOrders, role, from, to) {
  const summary = orderSummary(orders.filter((order) => getOrderOwner(order, role)));
  const scoped = orders.filter((order) => getOrderOwner(order, role));
  const previousScoped = previousOrders.filter((order) => getOrderOwner(order, role));
  const extra = {
    normal_orders: scoped.filter((order) => order.order_type !== "orden 911").length,
    urgent_911_orders: scoped.filter((order) => order.order_type === "orden 911").length,
    internal_design_orders: scoped.filter((order) => ["INTERNAL_DESING", "INTERNAL_DESIGN"].includes(String(order.order_design_type || "").toUpperCase())).length,
    external_design_orders: scoped.filter((order) => ["EXTERNAL_DESING", "EXTERNAL_DESIGN"].includes(String(order.order_design_type || "").toUpperCase())).length,
  };
  if (role === "designer") {
    const returned = scoped.filter((order) => order.return_reason).length;
    extra.returned_orders = returned;
    extra.return_rate = percentage(returned, scoped.length);
    extra.active_load = scoped.filter((order) => ["Pending", "in_Design"].includes(order.status)).length;
  }
  const keys = ["total_orders", "active_orders", "completed_orders", "cancelled_orders", "completion_rate", "cancellation_rate", "avg_cycle_days"];
  return {
    summary: { ...summary, ...extra },
    comparison: metricComparison(summary, orderSummary(previousScoped), keys),
    trend: buildZeroFilledTrend({ orders: scoped, files: [], from, to }),
    ranking: buildRoleRanking(profiles, orders, role, previousOrders),
  };
}

function buildProductionArea(profiles, files, previousFiles, orders, area, from, to) {
  const scoped = files.filter((file) => file.production_area_code === area);
  const previousScoped = previousFiles.filter((file) => file.production_area_code === area);
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const summary = fileSummary(scoped, orderMap);
  summary.files_per_day = round(summary.completed / Math.max(1, (new Date(to) - new Date(from)) / 86400000), 2);
  const comparison = metricComparison(summary, fileSummary(previousScoped, new Map()), ["total_files", "active_files", "completed", "reversions", "avg_time_days", "completion_rate"]);
  return {
    label: AREA_LABEL[area],
    summary,
    comparison,
    trend: buildZeroFilledTrend({ orders: [], files: scoped, from, to }),
    ranking: buildProductionRanking(profiles, scoped, area, previousScoped, from, to),
  };
}

export function buildTeamPerformance({ profiles = [], orders = [], files = [], previousOrders = [], previousFiles = [], from, to, compareFrom, compareTo }) {
  const currentFrom = finiteDate(from);
  const currentTo = finiteDate(to);
  const previousFrom = finiteDate(compareFrom);
  const previousTo = finiteDate(compareTo);
  const normalizedOrders = orders.map(normalizeOrder);
  const normalizedPreviousOrders = previousOrders.map(normalizeOrder);
  const archivedOrderIds = new Set([...normalizedOrders, ...normalizedPreviousOrders].filter((order) => order.is_archived_admin).map((order) => order.id));
  const currentOrders = normalizedOrders.filter((order) => !order.is_archived_admin && isInRange(order.created_at, currentFrom, currentTo));
  const priorOrders = normalizedPreviousOrders.filter((order) => !order.is_archived_admin && isInRange(order.created_at, previousFrom, previousTo));
  const currentFiles = files.map(normalizeFile).filter((file) => PRODUCTION_AREAS.includes(file.production_area_code) && !archivedOrderIds.has(file.order_id) && isInRange(file.created_at, currentFrom, currentTo) && PRODUCTION_STATUSES.has(file.status));
  const priorFiles = previousFiles.map(normalizeFile).filter((file) => PRODUCTION_AREAS.includes(file.production_area_code) && !archivedOrderIds.has(file.order_id) && isInRange(file.created_at, previousFrom, previousTo) && PRODUCTION_STATUSES.has(file.status));
  const currentOrderMap = new Map(currentOrders.map((order) => [order.id, order]));
  const previousOrderMap = new Map(priorOrders.map((order) => [order.id, order]));
  const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000);
  const generalSummary = {
    ...orderSummary(currentOrders),
    normal_orders: currentOrders.filter((order) => order.order_type !== "orden 911").length,
    urgent_911_orders: currentOrders.filter((order) => order.order_type === "orden 911").length,
    total_files: currentFiles.length,
    completed_files: currentFiles.filter((file) => file.status === "completed").length,
    active_files: currentFiles.filter((file) => ["pending", "in_production", "in_termination"].includes(file.status)).length,
    avg_file_time_days: average(currentFiles.filter((file) => file.status === "completed").map(fileCycleDays)),
  };
  generalSummary.files_per_day = round(generalSummary.completed_files / periodDays, 2);
  const previousGeneral = {
    ...orderSummary(priorOrders),
    total_files: priorFiles.length,
    completed_files: priorFiles.filter((file) => file.status === "completed").length,
    active_files: priorFiles.filter((file) => ["pending", "in_production", "in_termination"].includes(file.status)).length,
  };
  const generalKeys = ["total_orders", "active_orders", "completed_orders", "delivered_orders", "cancelled_orders", "total_files", "completed_files", "active_files"];
  const sales = buildSalesOrDesign(profiles, currentOrders, priorOrders, "seller", from, to);
  const design = buildSalesOrDesign(profiles, currentOrders, priorOrders, "designer", from, to);
  const areas = Object.fromEntries(PRODUCTION_AREAS.map((area) => [area, buildProductionArea(profiles, currentFiles, priorFiles, currentOrders, area, from, to)]));
  const productionSummary = fileSummary(currentFiles, currentOrderMap);
  productionSummary.files_per_day = round(productionSummary.completed / periodDays, 2);
  const previousProductionSummary = fileSummary(priorFiles, previousOrderMap);
  return {
    period: { date_from: from, date_to: to, compare_from: compareFrom, compare_to: compareTo, granularity: buildZeroFilledTrend({ orders: [], files: [], from, to }).granularity },
    general: {
      summary: generalSummary,
      comparison: metricComparison(generalSummary, previousGeneral, generalKeys),
      trend: buildZeroFilledTrend({ orders: currentOrders, files: currentFiles, from, to }),
      department_breakdown: [
        { key: "sales", label: "Ventas", value: sales.summary.total_orders },
        { key: "design", label: "Diseño", value: design.summary.total_orders },
        { key: "production", label: "Producción", value: currentFiles.length },
      ],
    },
    sales,
    design,
    production: {
      summary: productionSummary,
      comparison: metricComparison(productionSummary, previousProductionSummary, ["total_files", "active_files", "completed", "reversions", "avg_time_days", "completion_rate"]),
      trend: buildZeroFilledTrend({ orders: [], files: currentFiles, from, to }),
      areas,
    },
  };
}

export const __private__ = { changePct, fileSummary, orderSummary, sortRanking };
