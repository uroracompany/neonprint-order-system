export const isActiveNotification = (notification) => (
  Boolean(notification) &&
  notification.is_archived !== true &&
  notification.deleted_at == null
);

export const filterActiveNotifications = (notifications = []) => (
  Array.isArray(notifications) ? notifications.filter(isActiveNotification) : []
);

export const getActiveUnreadCount = (notifications = []) => (
  filterActiveNotifications(notifications).filter((notification) => !notification.is_read).length
);

export const isAdminEditNotification = (notification) => {
  if (!notification?.metadata) return false;
  const eventKind = notification.metadata.event_kind;
  const sourceModule = notification.metadata.source_module;
  return (
    eventKind === "admin_order_edit_area_notice" ||
    eventKind === "admin_edited_order" ||
    sourceModule === "admin"
  );
};

export const getAdminEditedOrderIds = (notifications = []) => {
  const ids = new Set();
  filterActiveNotifications(notifications).forEach((n) => {
    if (isAdminEditNotification(n) && n.order_id) {
      ids.add(n.order_id);
    }
  });
  return ids;
};

export const buildPendingReviewFromNotifications = (notifications, orderId, seenOrderIds = {}) => {
  if (!orderId) return null;
  if (seenOrderIds[orderId]) return null;

  const adminNotifs = filterActiveNotifications(notifications).filter(
    (n) => n.order_id === orderId && isAdminEditNotification(n)
  );
  if (adminNotifs.length === 0) return null;

  const changedFields = [];
  adminNotifs.forEach((n) => {
    const fields = n.metadata?.changed_fields;
    if (Array.isArray(fields)) {
      fields.forEach((f) => {
        if (f?.label && !changedFields.some((cf) => cf.label === f.label)) {
          changedFields.push({ field: f.field, label: f.label });
        }
      });
    }
  });

  return {
    label: "Editada por admin",
    changed_fields: changedFields,
    order_id: orderId,
  };
};

export const showCreditActionFeedback = (
  notif,
  { variant = "success", title, message, eventKind = "credit_feedback" } = {}
) => {
  if (!notif?.showActionNotification) return null;

  return notif.showActionNotification({
    type: variant === "error" ? "order_cancelled" : "info",
    title,
    label: title,
    message,
    metadata: { event_kind: eventKind, variant },
  });
};
