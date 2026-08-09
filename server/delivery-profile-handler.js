import { requireAuthenticated } from "./auth-middleware.js";
import { applyProfilePeriod, isInProfilePeriod, resolveProfilePeriod } from "./profile-period-utils.js";

const DELIVERED = new Set(["in_delivered", "delivered"]);
const PENDING_DELIVERY = new Set(["in_termination", "in_completed"]);
const CANCELLED = new Set(["cancelled"]);
const ORDER_COLUMNS = [
  "id",
  "delivery_id",
  "status",
  "created_at",
  "delivery_date",
  "is_archived_delivery",
  "client_id",
  "client_name",
].join(",");

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();
const roundPct = (value) => Math.round(value * 10) / 10;
const getPct = (count, total) => (total > 0 ? roundPct((count / total) * 100) : 0);

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const startOfUtcDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const addDays = (date, amount) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const createStatusSummary = (orders, nowValue) => {
  const now = parseDate(nowValue) || new Date();
  const today = startOfUtcDay(now);
  const summary = { assigned: orders.length, pending: 0, delivered: 0, overdue: 0, cancelled: 0 };

  orders.forEach((order) => {
    const status = normalizeStatus(order.status);
    const archived = Boolean(order.is_archived_delivery);
    if (DELIVERED.has(status)) summary.delivered += 1;
    if (CANCELLED.has(status)) summary.cancelled += 1;
    if (!archived && PENDING_DELIVERY.has(status)) summary.pending += 1;

    const deliveryDate = parseDate(order.delivery_date);
    if (!archived && deliveryDate && deliveryDate < today && !DELIVERED.has(status) && !CANCELLED.has(status)) {
      summary.overdue += 1;
    }
  });

  return summary;
};

const createTopClients = (orders) => {
  const counts = new Map();
  orders.forEach((order) => {
    const name = String(order.client_name || order.client_id || "Sin cliente").trim() || "Sin cliente";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, percentage: getPct(count, orders.length) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const createTrend = (orders, nowValue) => {
  const now = parseDate(nowValue) || new Date();
  const today = startOfUtcDay(now);
  const rows = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const start = addDays(today, -offset);
    const end = addDays(start, 1);
    rows.push({
      key: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString("es-DO", { timeZone: "UTC", day: "2-digit", month: "short" }),
      count: orders.filter((order) => {
        const createdAt = parseDate(order.created_at);
        return createdAt && createdAt >= start && createdAt < end;
      }).length,
    });
  }
  return rows;
};

export async function handleDeliveryProfile(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, {
    allowedRoles: ["delivery", "digital_producer", "dtf_producer", "ploteo_producer", "admin"],
  });
  if (!auth.authorized) return { status: auth.status || 401, body: { error: auth.error, code: auth.code } };

  const userId = auth.profile?.id;
  if (!userId) return { status: 403, body: { error: "Tu perfil no esta disponible." } };

  const period = resolveProfilePeriod(payload?.period, env.now);
  try {
    const { data, error } = await applyProfilePeriod(
      auth.supabaseAdmin.from("orders").select(ORDER_COLUMNS).eq("delivery_id", userId),
      period,
    );
    if (error) throw error;

    const orders = (data || []).filter((order) => order.delivery_id === userId && isInProfilePeriod(order.created_at, period));
    const statusSummary = createStatusSummary(orders, env.now);
    const clientsServed = new Set(orders.map((order) => order.client_id || order.client_name).filter(Boolean)).size;
    const deliveredAndPending = statusSummary.delivered + statusSummary.pending;

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period,
        metrics: {
          assigned_orders: statusSummary.assigned,
          pending_delivery_orders: statusSummary.pending,
          delivered_orders: statusSummary.delivered,
          overdue_orders: statusSummary.overdue,
          cancelled_orders: statusSummary.cancelled,
          clients_served: clientsServed,
          delivery_rate: getPct(statusSummary.delivered, deliveredAndPending),
        },
        analytics: {
          status_summary: statusSummary,
          top_clients: createTopClients(orders),
          trends: createTrend(orders, env.now),
        },
      },
    };
  } catch (error) {
    return { status: 500, body: { error: error?.message || "No se pudo cargar el perfil de entrega." } };
  }
}
