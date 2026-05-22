import { useState, useEffect, useRef } from "react";
import { Icons } from "../utils/icons";
import { formatDate } from "../utils/constants";
import "./NotificationCenter.css";

const TYPE_CONFIG = {
  new_order:       { label: "Nueva orden", icon: "order" },
  order_cancelled: { label: "Cancelada", icon: "cancel" },
  order_returned:  { label: "Devuelta", icon: "return" },
  order_updated:   { label: "Actualizada", icon: "update" },
  order_archived:  { label: "Archivada", icon: "archive" },
  order_completed: { label: "Completada", icon: "complete" },
  order_assigned:  { label: "Asignada", icon: "assign" },
  info:            { label: "Información", icon: "info" },
  system:          { label: "Sistema", icon: "system" },
};

function getTypeClass(type) {
  const map = {
    new_order: "new", order_cancelled: "cancelled", order_returned: "returned",
    order_updated: "updated", order_archived: "archived", order_completed: "completed",
    order_assigned: "assigned", info: "info", system: "system",
  };
  return map[type] || "info";
}

function NotificationToast({ notification, onDismiss }) {
  const [progress, setProgress] = useState(100);
  const startTime = useRef(null);

  useEffect(() => {
    startTime.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime.current;
      const remaining = Math.max(0, 100 - (elapsed / 5000) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const typeClass = getTypeClass(notification.type);

  return (
    <div className={`nc-toast ${typeClass}`} role="alert" aria-live="polite">
      <div className="nc-toast-main">
        <div className="nc-toast-icon">
          {typeClass === "cancelled" ? <Icons.X /> : <Icons.Bell />}
        </div>
        <div className="nc-toast-content">
          <span className="nc-toast-title">{notification.title}</span>
          <span className="nc-toast-text">{notification.message}</span>
        </div>
        <button className="nc-toast-close" onClick={() => onDismiss(notification.id)} aria-label="Cerrar">
          <Icons.X />
        </button>
      </div>
      <div className="nc-toast-track">
        <div className="nc-toast-progress" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default function NotificationCenter({
  notifications = [],
  unreadCount = 0,
  toasts = [],
  onMarkAsRead,
  onMarkAllAsRead,
  onArchive,
  onDelete,
  onDismissToast,
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeNotifications = notifications.filter((n) => !n.is_archived);

  return (
    <>
      <div className="nc-bell-wrap" ref={panelRef}>
        <button
          className="nc-bell-btn"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={`Notificaciones${unreadCount > 0 ? `, ${unreadCount} sin leer` : ""}`}
        >
          <Icons.Bell />
          {unreadCount > 0 && <span className="nc-bell-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>

        {open && (
          <div className="nc-panel">
            <div className="nc-panel-head">
              <div>
                <strong>Notificaciones</strong>
                <span className="nc-panel-sub">{unreadCount} sin leer</span>
              </div>
              {activeNotifications.length > 0 && (
                <button className="nc-link-btn" onClick={onMarkAllAsRead}>
                  Marcar todas leídas
                </button>
              )}
            </div>

            <div className="nc-panel-body">
              {activeNotifications.length === 0 ? (
                <div className="nc-empty">
                  <Icons.Bell />
                  <p>No hay notificaciones</p>
                </div>
              ) : (
                activeNotifications.map((n) => (
                  <div key={n.id} className={`nc-item ${n.is_read ? "read" : "unread"}`}>
                    <div className="nc-item-dot" />
                    <div className="nc-item-body">
                      <div className="nc-item-head">
                        <strong>{n.title}</strong>
                        {n.order_id && <span className="nc-item-order">#{n.order_id.slice(0, 8).toUpperCase()}</span>}
                      </div>
                      <p className="nc-item-msg">{n.message}</p>
                      <span className="nc-item-time">{formatDate(n.created_at)}</span>
                    </div>
                    <div className="nc-item-actions">
                      {!n.is_read && (
                        <button className="nc-action-btn" onClick={() => onMarkAsRead(n.id)} title="Marcar como leída">
                          <Icons.Check />
                        </button>
                      )}
                      <button className="nc-action-btn" onClick={() => onArchive(n.id)} title="Archivar">
                        <Icons.Archive />
                      </button>
                      <button className="nc-action-btn danger" onClick={() => onDelete(n.id)} title="Eliminar">
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="nc-toast-stack">
          {toasts.map((n) => (
            <NotificationToast key={n.id} notification={n} onDismiss={onDismissToast} />
          ))}
        </div>
      )}
    </>
  );
}
