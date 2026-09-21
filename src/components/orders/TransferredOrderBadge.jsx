import "./TransferredOrderBadge.css";

export default function TransferredOrderBadge({ compact = false }) {
  return (
    <span className={`transferred-order-badge${compact ? " transferred-order-badge--compact" : ""}`}>
      TRASPASADA
    </span>
  );
}
