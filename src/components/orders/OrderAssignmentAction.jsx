import { Icons } from "../../utils/icons";

export default function OrderAssignmentAction({
  order,
  label,
  onClick,
  disabled = false,
  loading = false,
  bare = false,
}) {
  const button = (
    <button
      type="button"
      className="pa-order-action pa-order-action-production"
      onClick={() => onClick?.(order)}
      disabled={disabled || loading}
    >
      <span className="pa-order-action-icon" aria-hidden="true"><Icons.Send /></span>
      <span>{loading ? "Asignando..." : label}</span>
    </button>
  );

  if (bare) return button;

  return (
    <div style={{ marginTop: 16 }}>
      {button}
    </div>
  );
}
