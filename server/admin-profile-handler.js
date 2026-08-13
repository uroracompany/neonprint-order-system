import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth-middleware.js";
import { getSupabaseAdminEnv } from "./admin-user-utils.js";
import { applyProfilePeriod, isInProfilePeriod, resolveProfilePeriod } from "./profile-period-utils.js";
import { getActivityChangeValue } from "../src/utils/orderEventPresentation.js";

const EVENT_COLUMNS = "id,order_id,event_type,old_status,new_status,old_payment_status,new_payment_status,changes,created_at,orders(id,client_name)";
const ORDER_COLUMNS = "id,created_at,status";

const EVENT_LABELS = {
  order_created: "Orden creada",
  order_updated: "Orden actualizada",
  admin_intervention: "Intervencion administrativa",
  admin_edited_order: "Orden editada por administrador",
  payment_updated: "Pago actualizado",
  status_changed: "Estado actualizado",
};

const getEventLabel = (eventType) => EVENT_LABELS[eventType] || "Accion administrativa";

const getRelatedOrder = (event) => {
  const relation = Array.isArray(event?.orders) ? event.orders[0] : event?.orders;
  const changes = event?.changes && typeof event.changes === "object" ? event.changes : {};
  const snapshots = [changes.new, changes.old].filter((value) => value && typeof value === "object");
  const clientName = relation?.client_name || snapshots.map((snapshot) => snapshot.client_name).find(Boolean) || null;
  return { id: event?.order_id || relation?.id || null, client_name: clientName };
};

const getChangedFields = (event) => {
  const fields = event?.changes?.changed_fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field) => field && typeof field === "object")
    .slice(0, 8)
    .map((field) => ({
      field: String(field.field || "").trim(),
      label: String(field.label || "").trim() || "Campo actualizado",
      old_value: field.old_value ?? null,
      new_value: field.new_value ?? null,
    }));
};

const formatTransition = (field, before, after) => {
  if (!before || !after || before === after) return null;
  return `${getActivityChangeValue(field, before)} → ${getActivityChangeValue(field, after)}`;
};

const getEventDetail = (event) => {
  const reason = String(event?.changes?.reason_detail || event?.changes?.reason || "").trim();
  if (reason) return reason;
  const statusTransition = formatTransition("status", event?.old_status, event?.new_status);
  if (statusTransition) return statusTransition;
  const paymentTransition = formatTransition("payment_status", event?.old_payment_status, event?.new_payment_status);
  if (paymentTransition) return paymentTransition;
  if (event?.new_status && event?.old_status && event.new_status !== event.old_status) {
    return `${event.old_status} → ${event.new_status}`;
  }
  if (event?.new_payment_status && event?.old_payment_status && event.new_payment_status !== event.old_payment_status) {
    return `${event.old_payment_status} → ${event.new_payment_status}`;
  }
  return "Accion registrada en el historial de ordenes.";
};

const buildActivity = (event, profile) => ({
  id: event.id,
  order_id: event.order_id,
  type: event.event_type || "unknown",
  label: getEventLabel(event.event_type),
  detail: getEventDetail(event),
  created_at: event.created_at,
  details: {
    actor_name: profile?.name || profile?.email || "Administrador",
    action: event?.changes?.action || null,
    reason_label: event?.changes?.reason_label || null,
    reason_detail: event?.changes?.reason_detail || event?.changes?.reason || null,
    order: getRelatedOrder(event),
    old_status: event.old_status || null,
    new_status: event.new_status || null,
    old_payment_status: event.old_payment_status || null,
    new_payment_status: event.new_payment_status || null,
    changed_fields: getChangedFields(event),
  },
});

const startOfUtcDay = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const buildTrend = (events, nowValue) => {
  const now = new Date(nowValue || Date.now());
  const today = Number.isNaN(now.getTime()) ? startOfUtcDay(new Date()) : startOfUtcDay(now);

  return Array.from({ length: 14 }, (_, index) => {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (13 - index));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      key: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString("es-PY", { timeZone: "UTC", day: "2-digit", month: "short" }),
      count: events.filter((event) => {
        const createdAt = new Date(event.created_at || "");
        return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt < end;
      }).length,
    };
  });
};

const buildActionTypes = (events) => {
  const counts = new Map();
  events.forEach((event) => {
    const key = event.event_type || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: getEventLabel(key), count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
};

export async function handleAdminProfile(payload = {}, env = process.env) {
  const auth = await requireAdmin(env.authHeader || "", env);
  if (!auth.authorized) return { status: auth.status || 401, body: { error: auth.error, code: auth.code } };

  const userId = auth.user?.id;
  if (!userId) return { status: 403, body: { error: "Tu perfil no esta disponible." } };

  const envResult = getSupabaseAdminEnv(env);
  if (envResult.error) return envResult.error;

  const period = resolveProfilePeriod(payload?.period, env.now);
  const supabaseAdmin = createClient(envResult.supabaseUrl, envResult.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [eventsResult, ordersResult] = await Promise.all([
      applyProfilePeriod(
        supabaseAdmin.from("order_events").select(EVENT_COLUMNS).eq("actor_id", userId).order("created_at", { ascending: false }),
        period,
      ),
      applyProfilePeriod(
        supabaseAdmin.from("orders").select(ORDER_COLUMNS).eq("created_by", userId),
        period,
      ),
    ]);

    if (eventsResult.error) throw eventsResult.error;
    if (ordersResult.error) throw ordersResult.error;

    const events = (eventsResult.data || []).filter((event) => isInProfilePeriod(event.created_at, period));
    const orders = (ordersResult.data || []).filter((order) => isInProfilePeriod(order.created_at, period));
    const uniqueOrders = new Set(events.map((event) => event.order_id).filter(Boolean));

    return {
      status: 200,
      body: {
        profile: auth.profile,
        period,
        metrics: {
          actions_registered: events.length,
          orders_intervened: uniqueOrders.size,
          orders_created: orders.length,
          last_activity_at: events[0]?.created_at || null,
        },
        analytics: {
          trend: buildTrend(events, env.now),
          action_types: buildActionTypes(events),
          recent_activity: events.slice(0, 8).map((event) => buildActivity(event, auth.profile)),
        },
      },
    };
  } catch (error) {
    return { status: 500, body: { error: "No se pudo cargar la actividad administrativa.", code: "ADMIN_ACTIVITY_LOOKUP_FAILED" } };
  }
}
