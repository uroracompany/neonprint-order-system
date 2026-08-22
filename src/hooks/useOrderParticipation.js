import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";

export function useOrderParticipation(orderId) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTimeline = useCallback(async () => {
    if (!orderId) {
      setTimeline([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, err } = await supabase.rpc("get_order_participation_timeline", {
        p_order_id: orderId,
      });

      if (err) throw err;
      setTimeline(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("useOrderParticipation error:", e);
      setError(e.message || "Error al cargar historial");
      setTimeline([]);
    } finally {
      setLoading(false);
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

  return { timeline, loading, error, refetch: fetchTimeline };
}
