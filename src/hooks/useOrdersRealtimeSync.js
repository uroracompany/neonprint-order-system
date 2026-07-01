import { useCallback, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";

const REFRESH_COALESCE_MS = 75;
const FAILURE_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export default function useOrdersRealtimeSync({ userId, scope, refreshOrders }) {
  const refreshRef = useRef(refreshOrders);
  const refreshTimerRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refreshOrders;
  }, [refreshOrders]);

  const runRefresh = useCallback(async () => {
    if (disposedRef.current) return;
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    try {
      await refreshRef.current?.();
    } catch (error) {
      console.warn("No se pudo reconciliar las ordenes en tiempo real:", error?.message || error);
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current && !disposedRef.current) {
        refreshPendingRef.current = false;
        refreshTimerRef.current = window.setTimeout(() => {
          refreshTimerRef.current = null;
          void runRefresh();
        }, REFRESH_COALESCE_MS);
      }
    }
  }, []);

  const requestRefresh = useCallback(() => {
    if (disposedRef.current) return;
    refreshPendingRef.current = true;
    if (refreshTimerRef.current !== null) return;

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refreshPendingRef.current = false;
      void runRefresh();
    }, REFRESH_COALESCE_MS);
  }, [runRefresh]);

  useEffect(() => {
    if (!userId || !scope) return undefined;

    disposedRef.current = false;
    let cancelled = false;
    let broadcastChannel = null;
    let fallbackChannel = null;

    const reportStatus = (transport, status, error) => {
      if (disposedRef.current) return;
      if (status === "SUBSCRIBED") {
        requestRefresh();
      } else if (FAILURE_STATUSES.has(status)) {
        console.warn(`Realtime de ordenes (${transport}) en estado ${status}.`, error || "");
      }
    };

    const connect = async () => {
      try {
        await supabase.realtime.setAuth();
      } catch (error) {
        console.warn("No se pudo autorizar el canal Broadcast de ordenes:", error?.message || error);
      }
      if (cancelled) return;

      broadcastChannel = supabase
        .channel(`orders:user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "order_changed" }, requestRefresh)
        .subscribe((status, error) => reportStatus("broadcast", status, error));

      fallbackChannel = supabase
        .channel(`orders-fallback:${scope}:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          requestRefresh
        )
        .subscribe((status, error) => reportStatus("postgres_changes", status, error));
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return;
      requestRefresh();
    };

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", requestRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void connect();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      refreshPendingRef.current = false;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", requestRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (broadcastChannel) supabase.removeChannel(broadcastChannel);
      if (fallbackChannel) supabase.removeChannel(fallbackChannel);
    };
  }, [requestRefresh, scope, userId]);
}
