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
