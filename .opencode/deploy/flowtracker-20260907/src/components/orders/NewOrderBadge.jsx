import "./NewOrderBadge.css";

export default function NewOrderBadge({ compact = false }) {
  return (
    <span className={`acm-badge pd-new-order-badge${compact ? " pd-new-order-badge--compact" : ""}`}>
      Nueva
    </span>
  );
}
