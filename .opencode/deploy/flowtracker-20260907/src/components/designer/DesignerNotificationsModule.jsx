import { useEffect, useMemo, useState } from "react";
import { Icons } from "../../utils/icons";
import { formatDate, formatUiTerms } from "../../utils/constants";
import { filterActiveNotifications, filterArchivedNotifications } from "../../utils/notifications";
import "./DesignerNotificationsModule.css";
import GreetingBanner from "../ui/GreetingBanner";
import MetricCard from "../ui/MetricCard";

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

const CREDIT_EVENT_KINDS = new Set([
  "credit_granted",
  "credit_settled",
  "credit_custom_reminder_due",
  "admin_credit_daily_summary",
]);

const DATE_FILTERS = [
  { value: "all", label: "Todas las fechas" },
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "custom", label: "Personalizado" },
];

const NOTIFICATIONS_PER_PAGE = 15;
const DEFAULT_MODULE_LABEL = "Diseño";
const DEFAULT_MODULE_ICON = Icons.Brush;
const DEFAULT_MODULE_TONE = "design";

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

const isCreditNotification = (notification) => CREDIT_EVENT_KINDS.has(notification?.metadata?.event_kind);

const getStatusBadge = (notification, archived) => {
  if (archived || notification?.is_archived) {
    return { label: "Archivada", tone: "archived", icon: Icons.Archive };
  }

  if (notification?.is_read) {
    return { label: "Leída", tone: "read", icon: Icons.Check };
  }

  return { label: "Pendiente", tone: "pending", icon: Icons.Clock };
};

const getTypeBadge = (notification, moduleLabel, ModuleIcon, moduleTone) => {
  const rawCategory = notification?.metadata?.category || notification?.metadata?.module || notification?.type || "";
  const category = normalizeSearch(rawCategory);
  const type = notification?.type || "";

  if (isCreditNotification(notification)) {
    return { label: "Crédito", tone: "credit", icon: Icons.Receipt };
  }

  if (ORDER_NOTIFICATION_TYPES.has(type) || category.includes("design") || category.includes("diseno") || category.includes("diseño")) {
    return { label: moduleLabel, tone: moduleTone, icon: ModuleIcon };
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

function NotificationRow({
  notification,
  archived,
  moduleLabel,
  moduleIcon,
  moduleTone,
  onMarkAsRead,
  onArchive,
  onRequestDelete,
  onOpenCreditTracking,
}) {
  const tone = getTypeTone(notification);
  const typeLabel = TYPE_LABELS[notification.type] || "Notificación";
  const statusBadge = getStatusBadge(notification, archived);
  const typeBadge = getTypeBadge(notification, moduleLabel, moduleIcon, moduleTone);
  const canOpenCreditTracking = isCreditNotification(notification) && typeof onOpenCreditTracking === "function";

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
        {canOpenCreditTracking && (
          <button
            type="button"
            className="dnm-credit-link"
            onClick={() => onOpenCreditTracking(notification)}
          >
            <Icons.Receipt />
            Ver seguimiento
          </button>
        )}
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
  notificationSoundEnabled = true,
  notificationSoundLoading = false,
  onNotificationSoundChange,
  moduleLabel = DEFAULT_MODULE_LABEL,
  moduleIcon: ModuleIcon = DEFAULT_MODULE_ICON,
  moduleTone = DEFAULT_MODULE_TONE,
  onOpenCreditTracking,
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
  const [actionError, setActionError] = useState("");
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
  const runAction = async (action, id, fallbackMessage) => {
    try {
      const result = await action?.(id);
      if (result?.ok === false) {
        setActionError(result.message || fallbackMessage);
        return false;
      }
      if (actionError) setActionError("");
      return true;
    } catch {
      setActionError(fallbackMessage);
      return false;
    }
  };
  const markAllAsRead = () => runAction(
    onMarkAllAsRead,
    undefined,
    "No se pudieron marcar las notificaciones como leídas."
  );
  const markAsRead = (id) => runAction(onMarkAsRead, id, "No se pudo marcar la notificación como leída.");
  const archive = (id) => runAction(onArchive, id, "No se pudo archivar la notificación.");
  const updateNotificationSound = () => runAction(
    onNotificationSoundChange,
    !notificationSoundEnabled,
    "No se pudo guardar la preferencia de sonido."
  );
  const confirmDelete = async () => {
    if (!confirmation) return;
    if (confirmation.scope === "notification") {
      await runAction(onDelete, confirmation.notificationId, "No se pudo eliminar la notificación.");
    } else {
      await runAction(onDeleteAll, confirmation.scope, "No se pudieron eliminar las notificaciones.");
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
      <GreetingBanner
        icon={<Icons.Bell />}
        title="Notificaciones"
        subtitle="Consulta tu bandeja de trabajo y mantén acceso al historial completo de notificaciones."
        badges={[
          { icon: <Icons.Bell />, label: "Bandeja activa", variant: "active", ariaLabel: "Bandeja activa" },
          { icon: <Icons.AlertCircle />, count: unreadCount.toLocaleString("es-DO"), label: "sin leer", variant: "edited", ariaLabel: `${unreadCount.toLocaleString("es-DO")} sin leer` },
          { icon: <Icons.Archive />, count: archivedItems.length.toLocaleString("es-DO"), label: "archivadas", ariaLabel: `${archivedItems.length.toLocaleString("es-DO")} archivadas` },
        ]}
        actions={
          <button
            type="button"
            className="ps-greeting-btn primary"
            onClick={markAllAsRead}
            disabled={unreadCount === 0 || activeItems.length === 0}
          >
            <Icons.Check />
            Marcar leídas
          </button>
        }
      />

      {actionError && <p className="dnm-action-error" role="alert">{actionError}</p>}

      <section className="dnm-sound-setting" aria-label="Preferencia de sonido de notificaciones">
        <div className="dnm-sound-copy">
          <span className="dnm-sound-icon"><Icons.Bell /></span>
          <div>
            <strong>Sonido de notificaciones</strong>
            <p>Reproduce un tono corto cuando recibes una notificación nueva.</p>
          </div>
        </div>
        <button
          type="button"
          className={`dnm-sound-switch ${notificationSoundEnabled ? "is-enabled" : ""}`}
          role="switch"
          aria-checked={notificationSoundEnabled}
          aria-label={`Sonido de notificaciones ${notificationSoundEnabled ? "activado" : "desactivado"}`}
          onClick={updateNotificationSound}
          disabled={notificationSoundLoading}
        >
          <span aria-hidden="true" className="dnm-sound-switch-thumb" />
          <span>{notificationSoundEnabled ? "Activado" : "Desactivado"}</span>
        </button>
      </section>

      <div className="ps-metrics">
        <MetricCard
          icon={<Icons.Bell />}
          label="Activas"
          value={activeItems.length.toLocaleString("es-DO")}
          sub={`En bandeja de ${moduleLabel.toLowerCase()}`}
          accentIdx={5}
        />
        <MetricCard
          icon={<Icons.AlertCircle />}
          label="Sin leer"
          value={unreadCount.toLocaleString("es-DO")}
          sub="Requieren revisión"
          accentIdx={1}
        />
        <MetricCard
          icon={<Icons.Archive />}
          label="Archivadas"
          value={archivedItems.length.toLocaleString("es-DO")}
          sub="Solo consulta"
          accentIdx={0}
        />
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
                moduleLabel={moduleLabel}
                moduleIcon={ModuleIcon}
                moduleTone={moduleTone}
                onMarkAsRead={markAsRead}
                onArchive={archive}
                onRequestDelete={requestDeleteNotification}
                onOpenCreditTracking={onOpenCreditTracking}
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
