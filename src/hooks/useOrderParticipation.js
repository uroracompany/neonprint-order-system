import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../supabaseClient";

export function useOrderParticipation(orderId) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState(null);
  const [loadedOrderId, setLoadedOrderId] = useState(null);
  const requestIdRef = useRef(0);

  const fetchTimeline = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!orderId) {
      setTimeline([]);
      setError(null);
      setLoading(false);
      setLoadedOrderId(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc("get_order_participation_timeline", {
        p_order_id: orderId,
      });

      if (error) throw error;
      if (requestId !== requestIdRef.current) return;
      setTimeline(Array.isArray(data) ? data : []);
      setLoadedOrderId(orderId);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      console.error("useOrderParticipation error:", e);
      setError(e.message || "Error al cargar historial");
      setTimeline([]);
      setLoadedOrderId(orderId);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // Subscribe to realtime changes on order_events for this order
  useEffect(() => {
    if (!orderId) return;

    const channel = supabase
      .channel(`participation-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_events",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          // Refetch timeline when new events arrive
          fetchTimeline();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_production_files",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          fetchTimeline();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_production_assignments",
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          fetchTimeline();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, fetchTimeline]);

  const orderChanged = Boolean(orderId && loadedOrderId !== orderId);
  return {
    timeline: orderChanged ? [] : timeline,
    loading: loading || orderChanged,
    error: orderChanged ? null : error,
    refetch: fetchTimeline,
  };
}
