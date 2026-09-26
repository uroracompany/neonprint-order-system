const createIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `admin-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export async function executeAdminOrderCommand(supabase, {
  orderId,
  action,
  payload = {},
  reasonCategory,
  reasonDetail,
  expectedUpdatedAt,
  idempotencyKey = createIdempotencyKey(),
}) {
  const { data, error } = await supabase.rpc("admin_execute_order_command", {
    p_order_id: orderId,
    p_action: action,
    p_payload: payload,
    p_reason_category: reasonCategory,
    p_reason_detail: reasonDetail,
    p_expected_updated_at: expectedUpdatedAt,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw new Error(error.message || "No se pudo ejecutar la acción administrativa.");
  return data;
}

export async function executeAdminOrderBatch(supabase, {
  orderIds,
  action,
  payload = {},
  reasonCategory,
  reasonDetail,
  idempotencyKey = createIdempotencyKey(),
}) {
  const { data, error } = await supabase.rpc("admin_execute_order_batch", {
    p_order_ids: orderIds,
    p_action: action,
    p_payload: payload,
    p_reason_category: reasonCategory,
    p_reason_detail: reasonDetail,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw new Error(error.message || "No se pudo ejecutar el lote administrativo.");
  return data;
}
