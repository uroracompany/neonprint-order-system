import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";

export const groupOrderEventReviews = (reviews = [], actorNames = {}) => {
  const grouped = {};

  reviews.forEach((review) => {
    if (!review?.order_id) return;
    const actorId = review.metadata?.actor_id || null;
    const enrichedReview = {
      ...review,
      actor_name: actorNames[actorId] || "Administrador",
    };

    if (!grouped[review.order_id]) {
      grouped[review.order_id] = {
        order_id: review.order_id,
        label: review.label || "Editada por Admin",
        count: 0,
        reviews: [],
      };
    }

    grouped[review.order_id].reviews.push(enrichedReview);
    grouped[review.order_id].count += 1;
  });

  Object.values(grouped).forEach((group) => {
    group.reviews.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  return grouped;
};

export default function useOrderEventReviews(userId) {
  const [reviews, setReviews] = useState([]);
  const [actorNames, setActorNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [acknowledgingOrderId, setAcknowledgingOrderId] = useState(null);
  const [acknowledgeError, setAcknowledgeError] = useState("");
  const refreshVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const refreshVersion = ++refreshVersionRef.current;

    if (!userId) {
      setReviews([]);
      setActorNames({});
      setAcknowledgingOrderId(null);
      setAcknowledgeError("");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("order_event_reviews")
      .select("id, order_event_id, order_id, label, event_key, source_module, changed_fields, summary, metadata, created_at")
      .eq("user_id", userId)
      .in("event_key", ["admin_edited_order", "admin_intervention"])
      .is("reviewed_at", null)
      .order("created_at", { ascending: true });

    if (refreshVersion !== refreshVersionRef.current) return;

    if (error || !Array.isArray(data)) {
      setReviews([]);
      setActorNames({});
      setLoading(false);
      return;
    }

    setReviews(data);
    const actorIds = [...new Set(data.map((item) => item.metadata?.actor_id).filter(Boolean))];
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", actorIds);

      if (refreshVersion !== refreshVersionRef.current) return;

      setActorNames((profiles || []).reduce((acc, profile) => {
        acc[profile.id] = profile.name || profile.email || "Administrador";
        return acc;
      }, {}));
    } else {
      setActorNames({});
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refreshVersionRef.current += 1;
    setReviews([]);
    setActorNames({});
    setAcknowledgingOrderId(null);
    setAcknowledgeError("");
    setLoading(true);
    void refresh();

    return () => {
      refreshVersionRef.current += 1;
    };
  }, [refresh, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel(`order-event-reviews-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_event_reviews",
          filter: `user_id=eq.${userId}`,
        },
        refresh
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const acknowledgeOrder = useCallback(async (orderId) => {
    if (!orderId || acknowledgingOrderId) return false;
    setAcknowledgingOrderId(orderId);
    setAcknowledgeError("");

    const { error } = await supabase.rpc("mark_order_events_reviewed", {
      p_order_id: orderId,
    });

    if (error) {
      setAcknowledgeError("No se pudieron confirmar los cambios. Intenta nuevamente.");
      setAcknowledgingOrderId(null);
      return false;
    }

    setReviews((current) => current.filter((review) => review.order_id !== orderId));
    setAcknowledgingOrderId(null);
    return true;
  }, [acknowledgingOrderId]);

  const pendingByOrder = useMemo(
    () => groupOrderEventReviews(reviews, actorNames),
    [actorNames, reviews]
  );

  return {
    pendingByOrder,
    pendingCount: reviews.length,
    loading,
    acknowledgingOrderId,
    acknowledgeError,
    acknowledgeOrder,
    refresh,
  };
}
