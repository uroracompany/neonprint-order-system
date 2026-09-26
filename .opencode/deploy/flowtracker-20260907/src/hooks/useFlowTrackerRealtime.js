import { useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";

const COALESCE_MS = 100;

// Public tracking is anonymous, so the tracking token scopes the channel. The
// channel carries only a change signal; the existing server endpoint remains
// the source of truth for the data rendered by FlowTrackClient.
export default function useFlowTrackerRealtime({ token, onChange }) {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!token || typeof onChangeRef.current !== "function") return undefined;

    let active = true;
    let timer = null;
    const topic = `flowtrack:${token}`;

    const dispatch = () => {
      timer = null;
      if (!active) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void onChangeRef.current?.();
    };

    const schedule = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (timer !== null) return;
      timer = window.setTimeout(dispatch, COALESCE_MS);
    };

    const channel = supabase
      .channel(topic, { config: { private: false } })
      .on("broadcast", { event: "flowtrack_changed" }, schedule)
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("FlowTracker Realtime no disponible:", error?.message || status);
        }
      });

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [token]);
}
