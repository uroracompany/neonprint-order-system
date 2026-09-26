export function ReturnedToCashierBadge({ compact = false }) {
  return (
    <span className={`ps-returned-badge${compact ? " compact" : ""}`} style={{ borderColor: "#BFDBFE", background: "#EFF6FF", color: "#1D4ED8" }}>
      Regresada
    </span>
  );
}

export function OrderReturnHandoffPanel({ incomingHandoff, acknowledgementHandoff, history = [], onAcknowledge, acknowledging = false }) {
  if (!incomingHandoff && !acknowledgementHandoff && !history.length) return null;

  return (
    <section className="order-detail-section" style={{ background: "var(--surface)", padding: 16, marginBottom: 18 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#1E40AF", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        Historial de devolución
      </p>
      {incomingHandoff && (
        <div style={{ padding: 13, border: "1px solid #FECACA", borderRadius: 10, background: "#FEF2F2", marginBottom: 10 }}>
          <strong style={{ color: "#991B1B", fontSize: 13 }}>Devuelta por {incomingHandoff.cashier_name}</strong>
          <p style={{ margin: "7px 0 0", color: "#7F1D1D", fontSize: 13, lineHeight: 1.5 }}>{incomingHandoff.return_reason}</p>
        </div>
      )}
      {acknowledgementHandoff && (
        <div style={{ padding: 13, border: "1px solid #BFDBFE", borderRadius: 10, background: "#EFF6FF", marginBottom: 10 }}>
          <strong style={{ color: "#1D4ED8", fontSize: 13 }}>Regresada por {acknowledgementHandoff.recipient_name}</strong>
          <p style={{ margin: "7px 0", color: "#1E3A8A", fontSize: 13, lineHeight: 1.5 }}>{acknowledgementHandoff.response_note}</p>
          <button type="button" onClick={() => onAcknowledge?.(acknowledgementHandoff)} disabled={acknowledging} className="pq-btn pq-btn-primary">
            {acknowledging ? "Marcando..." : "Marcar entendido"}
          </button>
        </div>
      )}
      {history.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {history.slice(0, 5).map((handoff) => (
            <div key={handoff.id} style={{ paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text)" }}>
              <strong style={{ color: "#1E40AF" }}>{handoff.cashier_name}</strong> devolvió la orden a <strong style={{ color: "#1E40AF" }}>{handoff.recipient_name}</strong>.
              {handoff.responded_at && <> Fue regresada con la corrección indicada por <strong style={{ color: "#1E40AF" }}>{handoff.responded_by_name}</strong>.</>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
