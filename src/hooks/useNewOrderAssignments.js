import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";

const assignmentRealtimeGroups = new Map();
let assignmentChannelSequence = 0;

const subscribeToAssignmentChanges = (userId, onChange) => {
  let group = assignmentRealtimeGroups.get(userId);

  if (!group) {
    const listeners = new Set();
    const channel = supabase
      .channel(`order-assignment-receipts-${userId}-${++assignmentChannelSequence}`)
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
    assignmentRealtimeGroups.set(userId, group);
  }

  group.listeners.add(onChange);

  return () => {
    const currentGroup = assignmentRealtimeGroups.get(userId);
    if (!currentGroup) return;

    currentGroup.listeners.delete(onChange);
    if (currentGroup.listeners.size > 0) return;

    assignmentRealtimeGroups.delete(userId);
    void supabase.removeChannel(currentGroup.channel);
  };
};

export const groupNewOrderAssignments = (assignments = []) => assignments.reduce((byOrder, assignment) => {
  if (!assignment?.order_id) return byOrder;
  const current = byOrder[assignment.order_id];
  if (!current || new Date(assignment.assigned_at) > new Date(current.assigned_at)) {
    byOrder[assignment.order_id] = assignment;
  }
  return byOrder;
}, {});

export default function useNewOrderAssignments(userId, assignmentModule) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acknowledgingOrderId, setAcknowledgingOrderId] = useState(null);
  const refreshVersionRef = useRef(0);
  const acknowledgingOrderRef = useRef(null);

  const refresh = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    if (!userId || !assignmentModule) {
      setAssignments([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("order_assignment_receipts")
      .select("id, order_id, assignment_module, assignment_source, source_assignment_id, assigned_at")
      .eq("user_id", userId)
      .eq("assignment_module", assignmentModule)
      .neq("assignment_source", "production_file_transfer")
      .is("seen_at", null)
      .order("assigned_at", { ascending: false });

    if (version !== refreshVersionRef.current) return;
    setAssignments(error || !Array.isArray(data) ? [] : data);
    setLoading(false);
  }, [assignmentModule, userId]);

  useEffect(() => {
    refreshVersionRef.current += 1;
    setAssignments([]);
    setAcknowledgingOrderId(null);
    acknowledgingOrderRef.current = null;
    setLoading(true);
    void refresh();
    return () => { refreshVersionRef.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToAssignmentChanges(userId, refresh);
  }, [refresh, userId]);

  const acknowledgeOrder = useCallback(async (orderId) => {
    if (!orderId || !assignmentModule || acknowledgingOrderRef.current === orderId) return false;
    acknowledgingOrderRef.current = orderId;
    setAcknowledgingOrderId(orderId);

    const { error } = await supabase.rpc("mark_order_assignment_receipts_seen", {
      p_order_id: orderId,
      p_assignment_module: assignmentModule,
    });

    if (error) {
      acknowledgingOrderRef.current = null;
      setAcknowledgingOrderId(null);
      return false;
    }

    setAssignments((current) => current.filter((assignment) => assignment.order_id !== orderId));
    acknowledgingOrderRef.current = null;
    setAcknowledgingOrderId(null);
    return true;
  }, [assignmentModule]);

  const pendingByOrder = useMemo(() => groupNewOrderAssignments(assignments), [assignments]);

  return {
    pendingByOrder,
    pendingCount: assignments.length,
    loading,
    acknowledgingOrderId,
    acknowledgeOrder,
    refresh,
  };
}
