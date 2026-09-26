import { Icons } from "../../utils/icons";

const getAssignmentVariant = (order) => {
  const isExternalDesign = order?.order_design_type === "EXTERNAL_DESING";
  return isExternalDesign
    ? {
        background: "linear-gradient(135deg, #0369A1 0%, #0284C7 100%)",
        boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
      }
    : {
        background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
        boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)",
      };
};

export default function OrderAssignmentAction({
  order,
  label,
  onClick,
  disabled = false,
  loading = false,
  bare = false,
}) {
  const variant = getAssignmentVariant(order);

  const button = (
    <button
        onClick={() => onClick?.(order)}
        disabled={disabled || loading}
        style={{
          width: "100%",
          padding: "14px 20px",
          background: variant.background,
          border: "none",
          borderRadius: "var(--radius-md)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "'Poppins', sans-serif",
          cursor: disabled || loading ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: disabled || loading ? "none" : variant.boxShadow,
          opacity: disabled || loading ? 0.65 : 1,
          transition: "all 0.2s",
        }}
      >
        <Icons.Edit style={{ width: 18, height: 18 }} />
        {loading ? "Asignando..." : label}
    </button>
  );

  if (bare) return button;

  return (
    <div style={{ marginTop: 16 }}>
      {button}
    </div>
  );
}
