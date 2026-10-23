import { useEffect, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { buildOrderTrackingUrl } from "../../utils/orderTrackingUrl";

export default function OrderTrackingLink({ orderId, trackingToken }) {
  const [resolvedToken, setResolvedToken] = useState({ orderId: null, token: null });
  const [copiedLink, setCopiedLink] = useState(null);

  const hasResolvedCurrentOrder = resolvedToken.orderId === orderId;
  const activeToken = trackingToken || (hasResolvedCurrentOrder ? resolvedToken.token : null);
  const loading = Boolean(orderId && !trackingToken && !hasResolvedCurrentOrder);
  const copied = copiedLink?.orderId === orderId && copiedLink?.token === activeToken;

  useEffect(() => {
    let active = true;

    if (!orderId || trackingToken || resolvedToken.orderId === orderId) {
      return () => { active = false; };
    }

    supabase
      .from("orders")
      .select("tracking_token")
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setResolvedToken({ orderId, token: error ? null : data?.tracking_token || null });
      })
      .catch(() => {
        if (!active) return;
        setResolvedToken({ orderId, token: null });
      });

    return () => { active = false; };
  }, [orderId, trackingToken, resolvedToken.orderId]);

  const trackingUrl = buildOrderTrackingUrl(activeToken);

  const handleCopy = async () => {
    const tokenToCopy = trackingToken || (resolvedToken.orderId === orderId ? resolvedToken.token : null);
    if (!orderId || !tokenToCopy || !trackingUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trackingUrl);
      } else {
        throw new Error("Clipboard API no disponible");
      }
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = trackingUrl;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      let copiedToClipboard = false;
      try {
        textArea.select();
        copiedToClipboard = Boolean(document.execCommand?.("copy"));
      } catch {
        copiedToClipboard = false;
      } finally {
        document.body.removeChild(textArea);
      }
      if (!copiedToClipboard) return;
    }
    const copiedKey = { orderId, token: tokenToCopy };
    setCopiedLink(copiedKey);
    window.setTimeout(() => {
      setCopiedLink((current) => current === copiedKey ? null : current);
    }, 2000);
  };

  if (loading) {
    return <p className="order-tracking-link__message" role="status" style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Cargando enlace de seguimiento...</p>;
  }

  if (!trackingUrl) {
    return <p className="order-tracking-link__message" style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>El enlace estará disponible cuando la orden tenga un token de seguimiento.</p>;
  }

  return (
    <div className="order-tracking-link" style={{ display: "flex", gap: 8, minWidth: 0 }}>
      <input
        type="text"
        readOnly
        aria-label="Enlace de seguimiento para el cliente"
        value={trackingUrl}
        onClick={(event) => event.currentTarget.select()}
        style={{ flex: 1, minWidth: 0, padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "'SF Mono', 'Fira Code', monospace", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-alt)", color: "var(--text)", outline: "none", cursor: "text" }}
      />
      <button type="button" onClick={handleCopy} aria-live="polite" style={{ padding: "8px 14px", background: copied ? "#10B981" : "var(--primary)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "background 0.2s", fontFamily: "'Poppins', sans-serif" }}>
        {copied ? "✓ Copiado" : "Copiar enlace"}
      </button>
    </div>
  );
}
