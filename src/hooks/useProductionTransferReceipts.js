import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";

const transferReceiptRealtimeGroups = new Map();
let transferReceiptChannelSequence = 0;

const subscribeToTransferReceiptChanges = (userId, onChange) => {
  let group = transferReceiptRealtimeGroups.get(userId);

  if (!group) {
    const listeners = new Set();
    const channel = supabase
      .channel(`production-transfer-receipts-${userId}-${++transferReceiptChannelSequence}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_assignment_receipts",
          filter: `user_id=eq.${userId}`,
        },
        () => listeners.forEach((listener) => listener())
      )
      .subscribe();

    group = { channel, listeners };
    transferReceiptRealtimeGroups.set(userId, group);
  }

  group.listeners.add(onChange);

  return () => {
    const currentGroup = transferReceiptRealtimeGroups.get(userId);
    if (!currentGroup) return;

    currentGroup.listeners.delete(onChange);
    if (currentGroup.listeners.size > 0) return;

    transferReceiptRealtimeGroups.delete(userId);
    void supabase.removeChannel(currentGroup.channel);
  };
};

export const groupProductionTransferReceipts = (receipts = []) => receipts.reduce((byOrder, receipt) => {
  if (!receipt?.order_id) return byOrder;
  if (!byOrder[receipt.order_id]) byOrder[receipt.order_id] = [];
  byOrder[receipt.order_id].push(receipt);
  return byOrder;
}, {});

export default function useProductionTransferReceipts(userId) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acknowledgingOrderId, setAcknowledgingOrderId] = useState(null);
  const [acknowledgeError, setAcknowledgeError] = useState("");
  const [loadError, setLoadError] = useState("");
  const refreshVersionRef = useRef(0);
  const acknowledgingOrderRef = useRef(null);

  const refresh = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    if (!userId) {
      setReceipts([]);
      setLoadError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc("get_pending_production_file_transfer_receipts");
    if (version !== refreshVersionRef.current) return;

    if (error || !Array.isArray(data)) {
      setLoadError("No se pudo cargar el estado de las órdenes traspasadas. Intenta actualizar nuevamente.");
      setLoading(false);
      return;
    }

    setReceipts(data);
    setLoadError("");
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refreshVersionRef.current += 1;
    setReceipts([]);
    setAcknowledgingOrderId(null);
    acknowledgingOrderRef.current = null;
    setAcknowledgeError("");
    setLoadError("");
    setLoading(true);
    void refresh();
    return () => { refreshVersionRef.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToTransferReceiptChanges(userId, refresh);
  }, [refresh, userId]);

  const acknowledgeOrder = useCallback(async (orderId) => {
    if (!orderId || acknowledgingOrderRef.current === orderId) return false;

    acknowledgingOrderRef.current = orderId;
    setAcknowledgingOrderId(orderId);
    setAcknowledgeError("");

    const { error } = await supabase.rpc("acknowledge_production_file_transfer_receipts", {
      p_order_id: orderId,
    });

    if (error) {
      acknowledgingOrderRef.current = null;
      setAcknowledgingOrderId(null);
      setAcknowledgeError("No se pudo confirmar el traspaso. Intenta nuevamente.");
      return false;
    }

    setReceipts((current) => current.filter((receipt) => receipt.order_id !== orderId));
    acknowledgingOrderRef.current = null;
    setAcknowledgingOrderId(null);
    return true;
  }, []);

  const pendingByOrder = useMemo(() => groupProductionTransferReceipts(receipts), [receipts]);

  return {
    pendingByOrder,
    pendingCount: receipts.length,
    loading,
    acknowledgingOrderId,
    acknowledgeOrder,
    acknowledgeError,
    loadError,
    refresh,
  };
}
