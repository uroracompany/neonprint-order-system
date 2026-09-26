import { getOrderStatusConfig, PAYMENT_COLORS, UI_TERMS } from "../../utils/constants";
import { getOrderDeadlineState } from "../../utils/orderDeadline";

export function OrderOverdueBadge({ order, compact = false }) {
  const { daysOverdue, isOverdue } = getOrderDeadlineState(order);
  if (!isOverdue) return null;

  return (
    <span
      className="np-overdue-badge"
      title={`Fecha de entrega vencida hace ${daysOverdue} ${daysOverdue === 1 ? "día" : "días"}`}
      aria-label={`Orden atrasada ${daysOverdue} ${daysOverdue === 1 ? "día" : "días"}`}
    >
      {compact ? `Atrasada · ${daysOverdue}d` : `Atrasada · ${daysOverdue} ${daysOverdue === 1 ? "día" : "días"}`}
    </span>
  );
}

export function StatusBadge({ status, className = "badge", showDot = true, bordered = false, order = null }) {
  const cfg = getOrderStatusConfig(status);
  return <>
    <span className={className} style={{
      background: cfg.bg,
      color: cfg.color,
      ...(bordered ? { border: `1px solid ${cfg.color}20` } : {}),
    }}>
      {showDot && <span className={`${className}-dot`} style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
    {order && <OrderOverdueBadge order={order} compact />}
  </>;
}

export function PaymentBadge({ status, className = "badge", bordered = false, showDot = true }) {
  const cfg = PAYMENT_COLORS[status] || PAYMENT_COLORS["Pending_Payment"];
  return (
    <span className={className} style={{
      background: cfg.bg,
      color: cfg.color,
      ...(bordered ? { border: `1px solid ${cfg.color}20` } : {}),
    }}>
      {showDot && <span className={`${className}-dot`} style={{ background: cfg.dot || cfg.color }} />}
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
    digital_producer: ["Producción Digital", "warning"],
    dtf_producer: ["Producción DTF", "warning"],
    ploteo_producer: ["Producción Ploteo", "warning"],
    delivery: [UI_TERMS.delivery, "cyan"],
  };
  const entry = roleMap[role];
  if (!entry) return null;
  return <span className={`acm-badge ${entry[1]}`}>{entry[0]}</span>;
}
