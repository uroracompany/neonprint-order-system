import { useEffect, useMemo, useState } from "react";
import { Icons } from "../../utils/icons";
import { formatDate, formatUiTerms } from "../../utils/constants";
import { filterActiveNotifications, filterArchivedNotifications } from "../../utils/notifications";
import "./DesignerNotificationsModule.css";

const TYPE_LABELS = {
  new_order: "Nueva orden",
  order_cancelled: "Cancelada",
  order_returned: "Devuelta",
  order_updated: "Actualizada",
  order_archived: "Archivada",
  order_completed: "Completada",
  order_assigned: "Asignada",
  info: "Información",
  system: "Sistema",
};

const ORDER_NOTIFICATION_TYPES = new Set([
  "new_order",
  "order_cancelled",
  "order_returned",
  "order_updated",
  "order_archived",
  "order_completed",
  "order_assigned",
]);

const DATE_FILTERS = [
  { value: "all", label: "Todas las fechas" },
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "custom", label: "Personalizado" },
];

const NOTIFICATIONS_PER_PAGE = 15;

const DELETE_CONFIRMATION_COPY = {
  notification: {
    title: "Eliminar notificación",
    message: "Esta notificación dejará de aparecer en la aplicación. Esta acción es permanente.",
    confirmLabel: "Eliminar",
  },
  active: {
    title: "Eliminar notificaciones activas",
    message: "Se eliminarán todas las notificaciones activas. Esta acción es permanente.",
    confirmLabel: "Eliminar activas",
  },
  archived: {
    title: "Eliminar notificaciones archivadas",
    message: "Se eliminarán todas las notificaciones archivadas. Esta acción es permanente.",
    confirmLabel: "Eliminar archivadas",
  },
  all: {
    title: "Eliminar todas las notificaciones",
    message: "Se eliminarán todas las notificaciones activas y archivadas. Esta acción es permanente.",
    confirmLabel: "Eliminar todas",
  },
};

const getTypeTone = (notification) => {
  const variant = notification?.metadata?.variant;
  if (variant === "success") return "success";
  if (variant === "error") return "danger";
  if (variant === "warning") return "warning";
  if (notification?.type === "order_cancelled") return "danger";
  if (notification?.type === "order_returned") return "warning";
  if (notification?.type === "order_completed") return "success";
  return "info";
};

const getStatusBadge = (notification, archived) => {
  if (archived || notification?.is_archived) {
    return { label: "Archivada", tone: "archived", icon: Icons.Archive };
  }

  if (notification?.is_read) {
    return { label: "Leída", tone: "read", icon: Icons.Check };
  }

  return { label: "Pendiente", tone: "pending", icon: Icons.Clock };
};

const getTypeBadge = (notification) => {
  const rawCategory = notification?.metadata?.category || notification?.metadata?.module || notification?.type || "";
  const category = normalizeSearch(rawCategory);
  const type = notification?.type || "";

  if (ORDER_NOTIFICATION_TYPES.has(type) || category.includes("design") || category.includes("diseno") || category.includes("diseño")) {
    return { label: "Diseño", tone: "design", icon: Icons.Brush };
  }

  if (category.includes("campana") || category.includes("campaña") || type.includes("campaign")) {
    return { label: "Campaña", tone: "campaign", icon: Icons.Bell };
  }

  if (category.includes("usuario") || category.includes("user") || type.includes("user")) {
    return { label: "Usuario", tone: "user", icon: Icons.Users };
  }

  if (category.includes("seguridad") || category.includes("security") || type.includes("security")) {
    return { label: "Seguridad", tone: "security", icon: Icons.AlertCircle };
  }

  return { label: "Sistema", tone: "system", icon: Icons.Settings };
};

const formatNotificationCopy = (value) => (
  formatUiTerms(value)
    ?.replace(/\bDiseno\b/g, "Diseño")
    ?.replace(/\bdiseno\b/g, "diseño")
);

const formatNotificationDateTime = (value) => {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const normalizeSearch = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const parseDateInput = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
};

const getDateBounds = (filter, customFrom, customTo) => {
  if (filter === "all") return null;

  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (filter === "custom") {
    return {
      start: parseDateInput(customFrom),
      end: parseDateInput(customTo, true),
    };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (filter === "week") {
    const daysFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
  }

  if (filter === "month") {
    start.setDate(1);
  }

  return { start, end };
};

const matchesNotificationFilters = (notification, filters) => {
  const typeLabel = TYPE_LABELS[notification.type] || "Notificación";
  const query = normalizeSearch(filters.search);

  if (query) {
    const searchableText = normalizeSearch([
      notification.title,
      notification.message,
      notification.type,
      typeLabel,
      notification.order_id,
    ].filter(Boolean).join(" "));

    if (!searchableText.includes(query)) return false;
  }

  if (filters.type !== "all" && notification.type !== filters.type) {
    return false;
  }

  const bounds = getDateBounds(filters.date, filters.customFrom, filters.customTo);
  if (bounds) {
    const createdAt = new Date(notification.created_at);
    if (Number.isNaN(createdAt.getTime())) return false;
    if (bounds.start && createdAt < bounds.start) return false;
    if (bounds.end && createdAt > bounds.end) return false;
  }

  return true;
};

function NotificationBadge({ meta, kind }) {
  const Icon = meta.icon;
  return (
    <span className={`dnm-badge dnm-badge-${kind} ${meta.tone}`}>
      <Icon />
      {meta.label}
    </span>
  );
}

function EmptyState({ archived = false, filtered = false }) {
  if (filtered) {
    return (
      <div className="dnm-empty">
        <Icons.Search />
        <strong>Sin resultados</strong>
        <p>Ajusta la busqueda, el tipo o la fecha para encontrar otras notificaciones.</p>
      </div>
    );
  }

  return (
    <div className="dnm-empty">
      {archived ? <Icons.Archive /> : <Icons.Bell />}
      <strong>{archived ? "Sin notificaciones archivadas" : "Sin notificaciones activas"}</strong>
      <p>{archived ? "Las notificaciones archivadas aparecerán aquí." : "Cuando llegue algo nuevo, aparecerá en esta bandeja."}</p>
    </div>
  );
}

function NotificationRow({ notification, archived, onMarkAsRead, onArchive, onRequestDelete }) {
  const tone = getTypeTone(notification);
  const typeLabel = TYPE_LABELS[notification.type] || "Notificación";
  const statusBadge = getStatusBadge(notification, archived);
  const typeBadge = getTypeBadge(notification);

  return (
    <article className={`dnm-item ${notification.is_read ? "is-read" : "is-unread"} ${archived ? "is-archived" : ""}`}>
      <div className={`dnm-item-icon ${tone}`}>
        {archived ? <Icons.Archive /> : <Icons.Bell />}
      </div>
      <div className="dnm-item-body">
        <div className="dnm-item-head">
          <strong>{formatNotificationCopy(notification.title || typeLabel)}</strong>
          <NotificationBadge meta={statusBadge} kind="status" />
        </div>
        <p>{formatNotificationCopy(notification.message || "Sin detalle disponible.")}</p>
        <div className="dnm-item-meta">
          <NotificationBadge meta={typeBadge} kind="type" />
          <span className={`dnm-event-badge ${tone}`}>{typeLabel}</span>
          {notification.order_id && <span className="dnm-order-id">Orden #{notification.order_id.slice(0, 8).toUpperCase()}</span>}
          <span className="dnm-item-date">{formatNotificationDateTime(notification.created_at)}</span>
        </div>
      </div>
      <div className="dnm-item-actions" aria-label="Acciones de notificación">
        {!archived && !notification.is_read && (
          <button type="button" className="dnm-icon-btn mark-read" onClick={() => onMarkAsRead(notification.id)} title="Marcar como leída">
            <Icons.Check />
          </button>
        )}
        {!archived && (
          <button type="button" className="dnm-icon-btn archive" onClick={() => onArchive(notification.id)} title="Archivar">
            <Icons.Archive />
          </button>
        )}
        {archived && (
          <button type="button" className="dnm-icon-btn danger" onClick={() => onRequestDelete(notification)} title="Eliminar notificación">
            <Icons.Trash />
          </button>
        )}
      </div>
    </article>
  );
}

export default function DesignerNotificationsModule({
  notifications = [],
  archivedNotifications = [],
  unreadCount = 0,
  loading = false,
  archivedLoading = false,
  onMarkAsRead,
  onMarkAllAsRead,
  onArchive,
  onDelete,
  onDeleteAll,
}) {
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const activeItems = useMemo(() => filterActiveNotifications(notifications), [notifications]);
  const archivedItems = useMemo(() => filterArchivedNotifications(archivedNotifications), [archivedNotifications]);
  const visibleItems = tab === "archived" ? archivedItems : activeItems;
  const isLoading = tab === "archived" ? archivedLoading : loading;
  const typeOptions = useMemo(() => {
    const options = new Map();
    [...activeItems, ...archivedItems].forEach((notification) => {
      const type = notification.type || "info";
      options.set(type, TYPE_LABELS[type] || "Notificación");
    });
    return Array.from(options, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [activeItems, archivedItems]);
  const filters = useMemo(() => ({
    search,
    type: typeFilter,
    date: dateFilter,
    customFrom,
    customTo,
  }), [customFrom, customTo, dateFilter, search, typeFilter]);
  const filteredItems = useMemo(
    () => visibleItems.filter((notification) => matchesNotificationFilters(notification, filters)),
    [filters, visibleItems]
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / NOTIFICATIONS_PER_PAGE));
  const pageItems = useMemo(() => {
    const start = (page - 1) * NOTIFICATIONS_PER_PAGE;
    return filteredItems.slice(start, start + NOTIFICATIONS_PER_PAGE);
  }, [filteredItems, page]);
  const pageStart = filteredItems.length === 0 ? 0 : ((page - 1) * NOTIFICATIONS_PER_PAGE) + 1;
  const pageEnd = Math.min(filteredItems.length, page * NOTIFICATIONS_PER_PAGE);
  const hasFilters = Boolean(search.trim())
    || typeFilter !== "all"
    || dateFilter !== "all"
    || Boolean(customFrom)
    || Boolean(customTo);
  const resetFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setDateFilter("all");
    setCustomFrom("");
    setCustomTo("");
  };
  const requestDeleteNotification = (notification) => {
    setConfirmation({
      scope: "notification",
      notificationId: notification.id,
      ...DELETE_CONFIRMATION_COPY.notification,
    });
  };
  const requestBulkDelete = (scope) => {
    setActionsOpen(false);
    setConfirmation({
      scope,
      ...DELETE_CONFIRMATION_COPY[scope],
    });
  };
  const closeConfirmation = () => setConfirmation(null);
  const confirmDelete = async () => {
    if (!confirmation) return;
    if (confirmation.scope === "notification") {
      await onDelete?.(confirmation.notificationId);
    } else {
      await onDeleteAll?.(confirmation.scope);
    }
    setConfirmation(null);
  };

  useEffect(() => {
    setPage(1);
  }, [tab, search, typeFilter, dateFilter, customFrom, customTo]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <section className="dnm-shell" aria-labelledby="designer-notifications-title">
      <div className="dnm-hero">
        <div className="dnm-hero-identity">
          <span className="dnm-hero-icon"><Icons.Bell /></span>
          <div className="dnm-hero-copy">
            <div className="dnm-hero-title-line">
              <h2 id="designer-notifications-title">Notificaciones</h2>
            </div>
            <div className="dnm-hero-meta">
              <span><Icons.Brush /> Módulo de diseño</span>
              <span><Icons.Archive /> Historial archivado</span>
            </div>
            <div className="dnm-hero-status-line">
              <span className="dnm-status-pill"><span /> Bandeja activa</span>
              <small>{unreadCount.toLocaleString("es-DO")} sin leer · {archivedItems.length.toLocaleString("es-DO")} archivadas</small>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="dnm-mark-all"
          onClick={onMarkAllAsRead}
          disabled={unreadCount === 0 || activeItems.length === 0}
        >
          <Icons.Check />
          Marcar leídas
        </button>
      </div>

      <div className="dnm-summary-grid">
        <div className="dnm-summary-card">
          <span className="dnm-summary-icon info"><Icons.Bell /></span>
          <div>
            <span className="dnm-badge dnm-badge-status active">Activas</span>
            <strong>{activeItems.length.toLocaleString("es-DO")}</strong>
            <small>En bandeja de diseño</small>
          </div>
        </div>
        <div className="dnm-summary-card unread">
          <span className="dnm-summary-icon warning"><Icons.AlertCircle /></span>
          <div>
            <span className="dnm-badge dnm-badge-status pending">Sin leer</span>
            <strong>{unreadCount.toLocaleString("es-DO")}</strong>
            <small>Requieren revisión</small>
          </div>
        </div>
        <div className="dnm-summary-card archived">
          <span className="dnm-summary-icon muted"><Icons.Archive /></span>
          <div>
            <span className="dnm-badge dnm-badge-status archived">Archivadas</span>
            <strong>{archivedItems.length.toLocaleString("es-DO")}</strong>
            <small>Solo consulta</small>
          </div>
        </div>
      </div>

      <div className="dnm-filter-bar" aria-label="Filtros de notificaciones">
        <label className="dnm-filter-control dnm-filter-search">
          <Icons.Search />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar notificaciones"
            aria-label="Buscar notificaciones"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
              <Icons.X />
            </button>
          )}
        </label>

        <label className="dnm-filter-control dnm-filter-select">
          <Icons.FileText />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filtrar por tipo">
            <option value="all">Todos los tipos</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Icons.ChevronDown />
        </label>

        <label className="dnm-filter-control dnm-filter-select">
          <Icons.Calendar />
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filtrar por fecha">
            {DATE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Icons.ChevronDown />
        </label>

        {dateFilter === "custom" && (
          <div className="dnm-custom-range" aria-label="Rango personalizado">
            <label>
              <span>Desde</span>
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} aria-label="Fecha desde" />
            </label>
            <label>
              <span>Hasta</span>
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} aria-label="Fecha hasta" />
            </label>
          </div>
        )}

        {hasFilters && (
          <button type="button" className="dnm-clear-filters" onClick={resetFilters}>
            <Icons.X />
            Limpiar
          </button>
        )}
      </div>

      <div className="dnm-panel">
        <div className="dnm-panel-heading">
          <div>
            <span className="dnm-kicker">Bandeja de trabajo</span>
            <h3>{tab === "archived" ? "Notificaciones archivadas" : "Notificaciones activas"}</h3>
          </div>
          <div className="dnm-panel-tools">
            <div className="dnm-tabs" role="tablist" aria-label="Filtro de notificaciones">
              <button type="button" className={tab === "active" ? "active" : ""} onClick={() => setTab("active")} aria-selected={tab === "active"}>
                <Icons.Bell />
                <span>Activas</span>
                <strong>{activeItems.length}</strong>
              </button>
              <button type="button" className={tab === "archived" ? "active" : ""} onClick={() => setTab("archived")} aria-selected={tab === "archived"}>
                <Icons.Archive />
                <span>Archivadas</span>
                <strong>{archivedItems.length}</strong>
              </button>
            </div>
            <div className="dnm-actions-menu">
              <button
                type="button"
                className="dnm-actions-trigger"
                onClick={() => setActionsOpen((current) => !current)}
                aria-expanded={actionsOpen}
              >
                <Icons.Trash />
                Limpiar
                <Icons.ChevronDown />
              </button>
              {actionsOpen && (
                <div className="dnm-actions-popover" role="menu">
                  <button type="button" role="menuitem" onClick={() => requestBulkDelete("active")} disabled={activeItems.length === 0}>
                    Eliminar activas
                  </button>
                  <button type="button" role="menuitem" onClick={() => requestBulkDelete("archived")} disabled={archivedItems.length === 0}>
                    Eliminar archivadas
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={() => requestBulkDelete("all")} disabled={activeItems.length + archivedItems.length === 0}>
                    Eliminar todas
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="dnm-list">
          {isLoading ? (
            <div className="dnm-loading">Cargando notificaciones...</div>
          ) : filteredItems.length === 0 ? (
            <EmptyState archived={tab === "archived"} filtered={hasFilters} />
          ) : (
            pageItems.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                archived={tab === "archived"}
                onMarkAsRead={onMarkAsRead}
                onArchive={onArchive}
                onRequestDelete={requestDeleteNotification}
              />
            ))
          )}
        </div>

        {!isLoading && filteredItems.length > 0 && (
          <div className="dnm-pagination" aria-label="Paginación de notificaciones">
            <span>{pageStart}-{pageEnd} de {filteredItems.length} notificaciones</span>
            <div>
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
                <Icons.ChevronLeft />
                Anterior
              </button>
              <strong>Página {page} de {totalPages}</strong>
              <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>
                Siguiente
                <Icons.ChevronRight />
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmation && (
        <div className="dnm-confirm-overlay" role="presentation">
          <div className="dnm-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="dnm-confirm-title">
            <span className="dnm-confirm-icon"><Icons.Trash /></span>
            <h3 id="dnm-confirm-title">{confirmation.title}</h3>
            <p>{confirmation.message}</p>
            <div className="dnm-confirm-actions">
              <button type="button" className="dnm-confirm-cancel" onClick={closeConfirmation}>Cancelar</button>
              <button type="button" className="dnm-confirm-delete" onClick={confirmDelete}>
                <Icons.Trash />
                {confirmation.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
