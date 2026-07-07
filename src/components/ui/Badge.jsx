import { getOrderStatusConfig, PAYMENT_COLORS, UI_TERMS } from "../../utils/constants";

export function StatusBadge({ status, className = "badge", showDot = true, bordered = false }) {
  const cfg = getOrderStatusConfig(status);
  return (
    <span className={className} style={{
      background: cfg.bg,
      color: cfg.color,
      ...(bordered ? { border: `1px solid ${cfg.color}20` } : {}),
    }}>
      {showDot && <span className={`${className}-dot`} style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
}

export function PaymentBadge({ status, className = "badge", bordered = false }) {
  const cfg = PAYMENT_COLORS[status] || PAYMENT_COLORS["Pending_Payment"];
  return (
    <span className={className} style={{
      background: cfg.bg,
      color: cfg.color,
      ...(bordered ? { border: `1px solid ${cfg.color}20` } : {}),
    }}>
      {cfg.label}
    </span>
  );
}

export function RoleBadge({ role }) {
  const roleMap = {
    admin: ["Administrador", "danger"],
    seller: ["Vendedor", "info"],
    designer: ["Diseñador", "violet"],
    quote: [UI_TERMS.cotizacion, "info"],
    printer: ["Producción", "warning"],
    digital_producer: ["Produccion Digital", "warning"],
    dtf_producer: ["Produccion DTF", "warning"],
    ploteo_producer: ["Produccion Ploteo", "warning"],
    delivery: [UI_TERMS.delivery, "cyan"],
  };
  const entry = roleMap[role];
  if (!entry) return null;
  return <span className={`acm-badge ${entry[1]}`}>{entry[0]}</span>;
}
