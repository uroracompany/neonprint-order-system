export const applyOrdersSnapshot = ({
  orders,
  setOrders,
  setSelectedOrder,
  additionalOrders = [],
  openOrderSetters = [],
  openOrderContainers = [],
  preserveMissingOpenOrders = false,
  preserveOpenOrderState = true,
}) => {
  const nextOrders = Array.isArray(orders) ? orders : [];
  const selectableOrders = [...nextOrders, ...(Array.isArray(additionalOrders) ? additionalOrders : [])];
  const resolveFreshOrder = (currentOrder) => {
    if (!currentOrder?.id) return currentOrder;
    // Realtime snapshots update the collection in the background. Keep the
    // detail object stable while it is open so forms using it as hydration
    // input cannot be reset by an unrelated remote change.
    if (preserveOpenOrderState) return currentOrder;
    const freshOrder = selectableOrders.find((order) => order.id === currentOrder.id);
    // A silent background reconciliation can briefly omit a record (for example,
    // while permissions or pagination are settling). It must not dismiss a modal
    // the user is actively reading or completing solely because of that transient
    // snapshot. Callers can opt into an authoritative reconciliation when they
    // intentionally need to replace or close the open detail.
    if (!freshOrder) return preserveMissingOpenOrders ? currentOrder : null;
    const mergedOrder = { ...currentOrder, ...freshOrder };
    [
      "order_production_files",
      "order_production_assignments",
      "order_production_user_archives",
    ].forEach((key) => {
      if (!Array.isArray(freshOrder[key]) && Array.isArray(currentOrder[key])) {
        mergedOrder[key] = currentOrder[key];
      }
    });
    return mergedOrder;
  };

  setOrders(nextOrders);
  if (typeof setSelectedOrder === "function") {
    setSelectedOrder(resolveFreshOrder);
  }
  openOrderSetters
    .filter((setter) => typeof setter === "function")
    .forEach((setter) => setter(resolveFreshOrder));
  openOrderContainers
    .filter((item) => item && typeof item.setter === "function")
    .forEach(({ setter, orderKey = "order" }) => {
      setter((current) => {
        if (!current?.[orderKey]?.id) return current;
        const freshOrder = resolveFreshOrder(current[orderKey]);
        return freshOrder ? { ...current, [orderKey]: freshOrder } : null;
      });
    });

  return nextOrders;
};
