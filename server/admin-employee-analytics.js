import {
  PRODUCTION_ROLE_AREAS,
  applyEmployeeOrderAssignmentFilter,
  isMissingColumnOrRelationError,
  isProductionEmployeeRole,
} from "./admin-employee-utils.js";

const COMPLETED_STATUSES = new Set(["in_Completed", "in_Delivered"]);
const ACTIVE_STATUSES = new Set(["Pending", "in_Design", "in_Quote", "in_Production", "in_Termination"]);
const ORDER_SELECT = "id,client_id,client_name,material,status,order_type,order_design_type,payment_status,created_at,status_changed_at,return_reason,delivery_date,completed_at,is_archived_admin";

const asDate = (value, fallback) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date?.getTime?.()) ? fallback : date;
};

const safePercentage = (current, previous) => previous === 0
  ? (current > 0 ? 100 : 0)
  : +(((current - previous) / previous) * 100).toFixed(1);

const average = (values) => values.length
  ? +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
  : 0;

const activeOrder = (order) => !order?.is_archived_admin;

const getPeriodBounds = (payload = {}, env = process.env) => {
  const now = asDate(env.now, new Date());
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const from = asDate(payload.date_from, defaultFrom);
  const to = asDate(payload.date_to, defaultTo);
  const compareTo = asDate(payload.compare_to, new Date(from));
  const duration = Math.max(to - from, 24 * 60 * 60 * 1000);
  const compareFrom = asDate(payload.compare_from, new Date(compareTo.getTime() - duration));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    compareFrom: compareFrom.toISOString(),
    compareTo: compareTo.toISOString(),
  };
};

const withDateRange = (query, from, to) => query.gte("created_at", from).lt("created_at", to);

async function loadOrders(supabaseAdmin, userId, role, from, to, productionOrderIds = null) {
  if (isProductionEmployeeRole(role)) {
    if (!productionOrderIds?.length) return [];
    const result = await withDateRange(
      supabaseAdmin.from("orders").select(ORDER_SELECT).in("id", productionOrderIds),
      from,
      to,
    );
    if (result.error && isMissingColumnOrRelationError(result.error)) return [];
    if (result.error) throw result.error;
    return (result.data || []).filter(activeOrder);
  }

  let query = supabaseAdmin.from("orders").select(ORDER_SELECT);
  query = applyEmployeeOrderAssignmentFilter(query, userId, role, { includeLegacyQuoteColumns: true });
  query = withDateRange(query, from, to);
  let result = await query;

  if (role === "quote" && isMissingColumnOrRelationError(result.error)) {
    let fallback = supabaseAdmin.from("orders").select(ORDER_SELECT);
    fallback = applyEmployeeOrderAssignmentFilter(fallback, userId, role, { includeLegacyQuoteColumns: false });
    result = await withDateRange(fallback, from, to);
  }

  if (result.error && isMissingColumnOrRelationError(result.error)) return [];
  if (result.error) throw result.error;
  return (result.data || []).filter(activeOrder);
}

async function loadProductionFiles(supabaseAdmin, userId, role, from, to) {
  if (!isProductionEmployeeRole(role) && role !== "designer") return [];

  let query;

  if (role === "designer") {
    query = supabaseAdmin.from("order_production_files")
      .select("id,order_id,production_area_code,status,assigned_to,created_by,started_at,in_termination_at,completed_at,created_at")
      .eq("created_by", userId);
  } else {
    query = supabaseAdmin.from("order_production_files")
      .select("id,order_id,production_area_code,status,assigned_to,created_by,started_at,in_termination_at,completed_at,created_at")
      .eq("production_area_code", PRODUCTION_ROLE_AREAS[role])
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
  }

  const result = await withDateRange(query, from, to);
  if (result.error && isMissingColumnOrRelationError(result.error)) return [];
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadDeliveryEvents(supabaseAdmin, orders) {
  const ids = orders.map((order) => order.id).filter(Boolean);
  if (!ids.length) return [];
  const result = await supabaseAdmin.from("order_events")
    .select("order_id,new_status,created_at")
    .in("order_id", ids)
    .in("new_status", ["in_Delivered"]);
  if (result.error && isMissingColumnOrRelationError(result.error)) return [];
  if (result.error) throw result.error;
  return result.data || [];
}

const countBy = (items, getKey) => items.reduce((counts, item) => {
  const key = getKey(item);
  if (key) counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const topEntries = (counts, total, keyName = "name") => Object.entries(counts)
  .sort(([, left], [, right]) => right - left)
  .slice(0, 5)
  .map(([name, count]) => ({ [keyName]: name, count, pct: total ? +((count / total) * 100).toFixed(1) : 0 }));

const buildTrend = (orders, files, from, to) => {
  const duration = Math.max(1, (new Date(to) - new Date(from)) / 86400000);
  const granularity = duration <= 45 ? "day" : duration <= 210 ? "week" : "month";
  const points = new Map();
  const cursor = new Date(from);
  const end = new Date(to);

  const bucketStart = (date) => {
    const value = new Date(date);
    if (granularity === "day") value.setHours(0, 0, 0, 0);
    else if (granularity === "week") {
      value.setDate(value.getDate() - value.getDay());
      value.setHours(0, 0, 0, 0);
    } else value.setDate(1), value.setHours(0, 0, 0, 0);
    return value;
  };

  while (cursor < end && points.size < 750) {
    const bucket = bucketStart(cursor).toISOString().slice(0, 10);
    points.set(bucket, { date: bucket, orders: 0, files: 0, completed: 0 });
    if (granularity === "day") cursor.setDate(cursor.getDate() + 1);
    else if (granularity === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }

  orders.forEach((order) => {
    const key = bucketStart(order.created_at).toISOString().slice(0, 10);
    const point = points.get(key);
    if (!point) return;
    point.orders += 1;
    if (COMPLETED_STATUSES.has(order.status)) point.completed += 1;
  });
  files.forEach((file) => {
    const key = bucketStart(file.created_at).toISOString().slice(0, 10);
    const point = points.get(key);
    if (point) point.files += 1;
  });

  return { granularity, points: [...points.values()] };
};

const commonMetrics = (orders, files, events, from, to) => {
  const total = orders.length;
  const completed = orders.filter((order) => COMPLETED_STATUSES.has(order.status)).length;
  const delivered = orders.filter((order) => order.status === "in_Delivered").length;
  const cancelled = orders.filter((order) => order.status === "cancelled").length;
  const active = orders.filter((order) => ACTIVE_STATUSES.has(order.status)).length;
  const activityDates = [...orders.map((order) => order.created_at), ...files.map((file) => file.created_at)].filter(Boolean);
  const lastActivityAt = activityDates.sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const daysSinceLastActivity = lastActivityAt
    ? Math.max(0, Math.floor((new Date(to) - new Date(lastActivityAt)) / 86400000))
    : null;

  return {
    total_orders: total,
    active_orders: active,
    completed_orders: completed,
    delivered_orders: delivered,
    cancelled_orders: cancelled,
    completion_rate: total ? +((completed / total) * 100).toFixed(1) : 0,
    cancellation_rate: total ? +((cancelled / total) * 100).toFixed(1) : 0,
    last_activity_at: lastActivityAt,
    days_since_last_activity: daysSinceLastActivity,
    delivery_event_count: events.length,
  };
};

const buildRoleMetrics = (role, orders, files, events, from, to) => {
  const completed = orders.filter((order) => COMPLETED_STATUSES.has(order.status));
  const cycleDays = completed
    .filter((order) => order.status_changed_at && order.created_at)
    .map((order) => (new Date(order.status_changed_at) - new Date(order.created_at)) / 86400000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const payment = countBy(orders, (order) => order.payment_status);
  const commonOrderMetrics = {
    normal_orders: orders.filter((order) => order.order_type !== "orden 911").length,
    urgent_orders: orders.filter((order) => order.order_type === "orden 911").length,
    internal_design_orders: orders.filter((order) => order.order_design_type === "INTERNAL_DESING").length,
    external_design_orders: orders.filter((order) => order.order_design_type === "EXTERNAL_DESING").length,
    avg_cycle_days: average(cycleDays),
    pending_payment: payment.Pending_Payment || 0,
    top_clients: topEntries(countBy(orders, (order) => order.client_name), orders.length, "client_name"),
    top_materials: topEntries(countBy(orders, (order) => order.material), orders.length, "material"),
  };

  if (isProductionEmployeeRole(role)) {
    const completedFiles = files.filter((file) => file.status === "completed");
    const inProduction = files.filter((file) => file.status === "in_production");
    const inTermination = files.filter((file) => file.status === "in_termination");
    const pending = files.filter((file) => file.status === "pending");
    const reversions = files.filter((file) => file.status === "in_production" && file.in_termination_at).length;
    const durations = completedFiles
      .filter((file) => file.started_at && file.completed_at)
      .map((file) => (new Date(file.completed_at) - new Date(file.started_at)) / 86400000)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const avgTime = average(durations);
    const periodDays = Math.max(1, (new Date(to) - new Date(from)) / 86400000);
    const filesPerDay = +(completedFiles.length / periodDays).toFixed(2);
    const firstTimeRight = completedFiles.length ? +(((completedFiles.length - reversions) / completedFiles.length) * 100).toFixed(1) : 100;
    const efficiency = Math.min(100, Math.round(Math.min(filesPerDay * 20, 40) + Math.min(firstTimeRight * 0.3, 30) + Math.min(avgTime ? Math.max(0, 30 - avgTime * 3) : 15, 30)));

    return {
      ...commonOrderMetrics,
      total_files: files.length,
      completed: completedFiles.length,
      in_production: inProduction.length,
      in_termination: inTermination.length,
      pending: pending.length,
      avg_time_days: avgTime,
      reversions,
      reversion_rate: files.length ? +((reversions / files.length) * 100).toFixed(1) : 0,
      files_per_day: filesPerDay,
      first_time_right: Math.max(0, firstTimeRight),
      efficiency_score: efficiency,
      current_load: inProduction.length + inTermination.length + pending.length,
    };
  }

  if (role === "designer") {
    const returns = orders.filter((order) => order.return_reason).length;
    return {
      ...commonOrderMetrics,
      total_files: files.length,
      completed: completed.length,
      active_load: orders.filter((order) => ["Pending", "in_Design"].includes(order.status)).length,
      returned: returns,
      return_rate: orders.length ? +((returns / orders.length) * 100).toFixed(1) : 0,
      avg_design_days: commonOrderMetrics.avg_cycle_days,
      files_by_area: countBy(files, (file) => file.production_area_code),
    };
  }

  if (role === "quote") {
    const paid = payment.pagado || 0;
    return {
      ...commonOrderMetrics,
      paid_orders: paid,
      partial_orders: payment.parcial || 0,
      credit_orders: payment.credito || 0,
      pending_payment_orders: payment.Pending_Payment || 0,
      outstanding_orders: (payment.parcial || 0) + (payment.credito || 0) + (payment.Pending_Payment || 0),
      payment_conversion_rate: orders.length ? +((paid / orders.length) * 100).toFixed(1) : 0,
      quote_conversion_rate: orders.length ? +((completed.length / orders.length) * 100).toFixed(1) : 0,
    };
  }

  if (role === "delivery") {
    const delivered = orders.filter((order) => order.status === "in_Delivered");
    const eventByOrder = new Map(events.map((event) => [event.order_id, event]));
    const onTime = delivered.filter((order) => order.delivery_date && order.completed_at && new Date(order.completed_at) <= new Date(order.delivery_date)).length;
    const deliveryTimes = delivered.map((order) => {
      const event = eventByOrder.get(order.id);
      return event?.created_at && order.completed_at ? (new Date(event.created_at) - new Date(order.completed_at)) / 86400000 : null;
    }).filter((value) => Number.isFinite(value) && value >= 0);
    return {
      ...commonOrderMetrics,
      delivered: delivered.length,
      pending_deliveries: orders.filter((order) => ["in_Completed", "in_Termination"].includes(order.status)).length,
      on_time: onTime,
      on_time_rate: delivered.length ? +((onTime / delivered.length) * 100).toFixed(1) : 0,
      avg_delivery_time_days: average(deliveryTimes),
      payment_distribution: payment,
    };
  }

  return commonOrderMetrics;
};

const compareMetrics = (current, previous) => Object.fromEntries(
  ["total_orders", "completed_orders", "cancelled_orders", "active_orders", "delivered_orders"].map((key) => [key, {
    current: current[key] || 0,
    previous: previous[key] || 0,
    change_pct: safePercentage(current[key] || 0, previous[key] || 0),
  }]),
);

export async function buildAdminEmployeeAnalytics({ supabaseAdmin, userId, role, payload = {}, env = process.env }) {
  const bounds = getPeriodBounds(payload, env);
  const [files, previousFiles] = await Promise.all([
    loadProductionFiles(supabaseAdmin, userId, role, bounds.from, bounds.to),
    loadProductionFiles(supabaseAdmin, userId, role, bounds.compareFrom, bounds.compareTo),
  ]);
  const [orders, previousOrders] = await Promise.all([
    loadOrders(supabaseAdmin, userId, role, bounds.from, bounds.to, files.map((file) => file.order_id)),
    loadOrders(supabaseAdmin, userId, role, bounds.compareFrom, bounds.compareTo, previousFiles.map((file) => file.order_id)),
  ]);
  const events = role === "delivery" ? await loadDeliveryEvents(supabaseAdmin, orders) : [];
  const previousEvents = role === "delivery" ? await loadDeliveryEvents(supabaseAdmin, previousOrders) : [];
  const common = commonMetrics(orders, files, events, bounds.from, bounds.to);
  const previousCommon = commonMetrics(previousOrders, previousFiles, previousEvents, bounds.compareFrom, bounds.compareTo);

  const alerts = [];
  if (common.days_since_last_activity !== null && common.days_since_last_activity > 7) {
    alerts.push({ type: "inactive", severity: "warning", message: `Sin actividad registrada hace ${common.days_since_last_activity} días.` });
  }
  if (common.cancellation_rate >= 15) {
    alerts.push({ type: "cancellations", severity: "warning", message: `La cancelación alcanza ${common.cancellation_rate}% en el período.` });
  }

  return {
    period: { date_from: bounds.from, date_to: bounds.to },
    comparison: compareMetrics(common, previousCommon),
    common,
    role,
    roleMetrics: buildRoleMetrics(role, orders, files, events, bounds.from, bounds.to),
    trend: buildTrend(orders, files, bounds.from, bounds.to),
    alerts,
  };
}
