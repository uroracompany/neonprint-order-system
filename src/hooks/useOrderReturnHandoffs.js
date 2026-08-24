import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";

const enrichHandoffs = async (handoffs) => {
  const ids = [...new Set(handoffs.flatMap((handoff) => [handoff.cashier_id, handoff.recipient_id, handoff.responded_by, handoff.acknowledged_by]).filter(Boolean))];
  if (!ids.length) return handoffs;

  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", ids);
  const names = (profiles || []).reduce((result, profile) => ({
    ...result,
    [profile.id]: profile.name || profile.email || "Usuario",
  }), {});

  return handoffs.map((handoff) => ({
    ...handoff,
    cashier_name: names[handoff.cashier_id] || "Caja",
    recipient_name: names[handoff.recipient_id] || "Usuario",
    responded_by_name: names[handoff.responded_by] || "Usuario",
  }));
};

export const groupOrderReturnHandoffs = (handoffs, userId) => {
  const incomingByOrder = {};
  const acknowledgementByOrder = {};
  const historyByOrder = {};

  handoffs.forEach((handoff) => {
    (historyByOrder[handoff.order_id] ||= []).push(handoff);
    if (handoff.recipient_id === userId && !handoff.responded_at && !handoff.acknowledged_at) {
      incomingByOrder[handoff.order_id] = handoff;
    }
    if (handoff.cashier_id === userId && handoff.responded_at && !handoff.acknowledged_at) {
      acknowledgementByOrder[handoff.order_id] = handoff;
    }
  });

  return { incomingByOrder, acknowledgementByOrder, historyByOrder };
};

export default function useOrderReturnHandoffs(userId) {
  const [handoffs, setHandoffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++versionRef.current;
    if (!userId) {
      setHandoffs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("order_return_handoffs")
      .select("*")
      .or(`cashier_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("returned_at", { ascending: false });

    if (version !== versionRef.current) return;
    if (error || !Array.isArray(data)) {
      setHandoffs([]);
      setLoading(false);
      return;
    }

    const enriched = await enrichHandoffs(data);
    if (version !== versionRef.current) return;
    setHandoffs(enriched);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    return () => { versionRef.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`order-return-handoffs-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_return_handoffs" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, userId]);

  return useMemo(() => {
    const grouped = groupOrderReturnHandoffs(handoffs, userId);
    return { handoffs, loading, refresh, ...grouped };
  }, [handoffs, loading, refresh, userId]);
}
