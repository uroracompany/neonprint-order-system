import { Icons } from "../../utils/icons";
import { useOrderParticipation } from "../../hooks/useOrderParticipation";
import "./OrderDetailModal.css";

const ROLE_ICON_MAP = {
  seller: Icons.User,
  design: Icons.Brush,
  quote: Icons.Money,
  production: Icons.Package,
  delivery: Icons.Truck,
  admin: Icons.Settings,
};

const ROLE_COLOR_MAP = {
  seller: "var(--pink)",
  design: "#8B5CF6",
  quote: "#F59E0B",
  production: "#10B981",
  delivery: "#3B82F6",
  admin: "var(--text-muted)",
};

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("es-DO", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function OrderParticipationTimeline({ orderId }) {
  const { timeline, loading, error } = useOrderParticipation(orderId);

  if (!orderId) return null;

  return (
    <section className="order-detail-section" style={{ background: "var(--surface)", padding: 16, marginBottom: 18 }}>
      <p style={{
        fontSize: 11, fontWeight: 700, color: "#1E40AF",
        textTransform: "uppercase", letterSpacing: "0.07em",
        marginBottom: 12,
        display: "flex", alignItems: "center", gap: 6
      }}>
        <Icons.Clock /> Historial de Participación
      </p>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
          <div style={{
            width: 14, height: 14,
            border: "2px solid var(--border)", borderTopColor: "var(--primary)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite"
          }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Cargando historial...</span>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "#991B1B", margin: 0 }}>{error}</p>
      )}

      {!loading && !error && timeline.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
          Sin registros de participación aún.
        </p>
      )}

      {!loading && !error && timeline.length > 0 && (
        <div className="participation-timeline">
          {timeline.map((entry, idx) => {
            const IconComp = ROLE_ICON_MAP[entry.role] || Icons.User;
            const iconColor = ROLE_COLOR_MAP[entry.role] || "var(--text-muted)";

            return (
              <div key={idx} className="participation-entry">
                <div className="participation-icon" style={{ background: `${iconColor}15`, color: iconColor }}>
                  <IconComp />
                </div>
                <div className="participation-content">
                  <div className="participation-header">
                    <span className="participation-role" style={{ color: "#1E40AF" }}>
                      {entry.role_label}
                    </span>
                    <span className="participation-user">{entry.user_name}</span>
                  </div>
                  <p className="participation-action">{entry.action}</p>
                  {entry.metadata?.production_area && (
                    <p className="participation-meta">
                      Departamento: {entry.metadata.production_area}
                    </p>
                  )}
                  {entry.metadata?.filename && (
                    <p className="participation-meta">
                      Archivo: {entry.metadata.filename}
                    </p>
                  )}
                  {entry.metadata?.reason && (
                    <p className="participation-meta">
                      Motivo: {entry.metadata.reason}
                    </p>
                  )}
                  <time className="participation-time">{formatTimestamp(entry.timestamp)}</time>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
