export const applyOrdersSnapshot = ({
  orders,
  setOrders,
  setSelectedOrder,
  additionalOrders = [],
  openOrderSetters = [],
  openOrderContainers = [],
}) => {
  const nextOrders = Array.isArray(orders) ? orders : [];
  const selectableOrders = [...nextOrders, ...(Array.isArray(additionalOrders) ? additionalOrders : [])];
  const resolveFreshOrder = (currentOrder) => {
    if (!currentOrder?.id) return currentOrder;
    const freshOrder = selectableOrders.find((order) => order.id === currentOrder.id);
    if (!freshOrder) return null;
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
