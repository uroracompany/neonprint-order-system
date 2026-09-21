export const getReturnPresentation = (order, targetOverride) => (
  targetOverride === "designer"
    ? { label: "Diseñador", nextStatusLabel: "En Diseño" }
    : order?.order_design_type === "EXTERNAL_DESING"
      ? { label: "Vendedor", nextStatusLabel: "Pendiente" }
      : { label: "Diseñador", nextStatusLabel: "En Diseño" }
);

export const getReturnTargetLabel = (order) => getReturnPresentation(order).label;
