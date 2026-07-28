import { jsonResponse, requireAuthenticated } from "./auth-middleware.js";

const ORDER_STATUS = {
  IN_DESIGN: "in_Design",
  IN_QUOTE: "in_Quote",
  IN_COMPLETED: "in_Completed",
  IN_DELIVERED: "in_Delivered",
  CANCELLED: "cancelled",
};

const SELLER_ARCHIVABLE_STATUSES = new Set([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.IN_DELIVERED,
]);

const normalizeText = (value) => String(value || "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const isPaymentPartial = (value) => ["parcial", "partial"].includes(normalizeKey(value));
const isPaymentPaid = (value) => ["pagado", "paid"].includes(normalizeKey(value));
const isPaymentCredit = (value) => ["credito", "crédito", "credit"].includes(normalizeKey(value));

const getOrderId = (payload = {}) =>
  normalizeText(payload.order_id || payload.orderId || payload.id);

const isAdminProfile = (profile) => profile?.role === "admin";

const isOwnedByProfile = (order, profile) =>
  Boolean(order?.seller_id === profile?.id || order?.created_by === profile?.id);

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

  if (!isAdminProfile(profile) && !isOwnedByProfile(order, profile)) {
    debugSellerOrderAction("ownership-denied", { orderId, profileId: profile?.id }, env);
    return { response: jsonResponse(403, { error: "No tienes acceso a esta orden." }) };
  }

  return { order };
}

async function updateOwnedOrder(supabaseAdmin, order, values, env) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(values)
    .eq("id", order.id)
    .select("*")
    .single();

  if (error || !data) {
    debugSellerOrderAction("update-error", { orderId: order.id, error: error?.message }, env);
    return { response: jsonResponse(400, { error: error?.message || "No se pudo actualizar la orden." }) };
  }

  return { order: data };
}

async function assertAssigneeRole(supabaseAdmin, userId, allowedRole, label, env) {
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
    debugSellerOrderAction("assignee-not-found", { assigneeId, allowedRole, error: error?.message }, env);
    return { response: jsonResponse(404, { error: `No se encontro ${label}.` }) };
  }

  if (profile.role !== allowedRole || profile.employment_status === false) {
    debugSellerOrderAction("assignee-invalid", { assigneeId, role: profile.role, allowedRole }, env);
    return { response: jsonResponse(400, { error: `${label} no esta disponible para esta asignacion.` }) };
  }

  return { profile };
}

async function handleDetail(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;
  return jsonResponse(200, { order: loaded.order });
}

async function handleCancel(payload, auth, env) {
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

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    { status: ORDER_STATUS.CANCELLED, cancellation_reason: reason },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleSendToDesigner(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const assignee = await assertAssigneeRole(auth.supabaseAdmin, payload.designer_id || payload.designerId, "designer", "un disenador", env);
  if (assignee.response) return assignee.response;

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    {
      status: ORDER_STATUS.IN_DESIGN,
      designer_id: assignee.profile.id,
      return_reason: null,
      returned_to_designer_at: null,
    },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleSendToQuote(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  const assignee = await assertAssigneeRole(auth.supabaseAdmin, payload.quote_user_id || payload.quoteUserId, "quote", "un usuario de caja", env);
  if (assignee.response) return assignee.response;

  const updated = await updateOwnedOrder(
    auth.supabaseAdmin,
    loaded.order,
    {
      status: ORDER_STATUS.IN_QUOTE,
      quote_id: assignee.profile.id,
      return_reason: null,
      returned_to_designer_at: null,
    },
    env
  );
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

async function handleArchive(payload, auth, env) {
  const loaded = await loadOwnedOrder(auth.supabaseAdmin, getOrderId(payload), auth.profile, env);
  if (loaded.response) return loaded.response;

  if (loaded.order.is_archived) {
    return jsonResponse(200, { order: loaded.order });
  }

  if (isPaymentPartial(loaded.order.payment_status)) {
    return jsonResponse(409, { error: "No se puede archivar una orden con pago parcial." });
  }

  if (!SELLER_ARCHIVABLE_STATUSES.has(loaded.order.status)) {
    return jsonResponse(409, { error: "Esta orden aun no puede archivarse en Ventas." });
  }

  const updated = await updateOwnedOrder(auth.supabaseAdmin, loaded.order, { is_archived: true }, env);
  if (updated.response) return updated.response;
  return jsonResponse(200, { order: updated.order });
}

const ACTION_HANDLERS = {
  detail: handleDetail,
  cancel: handleCancel,
  send_to_designer: handleSendToDesigner,
  send_to_quote: handleSendToQuote,
  archive: handleArchive,
};

export async function handleSellerOrderAction(payload = {}, env = process.env) {
  const auth = await requireAuthenticated(env.authHeader || "", env, { allowedRoles: ["seller", "admin"] });
  if (!auth.authorized) {
    return jsonResponse(auth.status || 403, { error: auth.error });
  }

  const action = normalizeKey(payload.action);
  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return jsonResponse(400, { error: `Accion Seller no valida: ${payload.action || ""}` });
  }

  return handler(payload, auth, env);
}
