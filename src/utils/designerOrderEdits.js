import { ORDER_STATUS, isOrderStatus } from "./constants";

const TRACKED_ORDER_FIELDS = [
  "client_name",
  "client_contact",
  "order_type",
  "created_at",
  "description",
  "material",
];

const normalizeTrackedValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const hasTrackedOrderChanges = (previousOrder, nextOrder) => (
  TRACKED_ORDER_FIELDS.some(field => (
    normalizeTrackedValue(previousOrder?.[field]) !== normalizeTrackedValue(nextOrder?.[field])
  ))
);

export const isReturnedDesignerOrder = (order) => (
  isOrderStatus(order?.status, ORDER_STATUS.IN_DESIGN) &&
  String(order?.return_reason || "").trim().length > 0
);

const hasReturnUpdate = (previousOrder, nextOrder) => {
  if (!isReturnedDesignerOrder(nextOrder)) return false;

  return (
    !isReturnedDesignerOrder(previousOrder) ||
    normalizeTrackedValue(previousOrder?.return_reason) !== normalizeTrackedValue(nextOrder?.return_reason) ||
    normalizeTrackedValue(previousOrder?.returned_to_designer_at) !== normalizeTrackedValue(nextOrder?.returned_to_designer_at)
  );
};

export const shouldMarkDesignerOrderEdited = (previousOrder, nextOrder, currentDesignerId) => {
  if (!previousOrder || isOrderStatus(nextOrder?.status, ORDER_STATUS.CANCELLED)) return false;
  if (currentDesignerId && nextOrder?.updated_by === currentDesignerId) return false;

  return (
    !hasReturnUpdate(previousOrder, nextOrder) &&
    hasTrackedOrderChanges(previousOrder, nextOrder)
  );
};
