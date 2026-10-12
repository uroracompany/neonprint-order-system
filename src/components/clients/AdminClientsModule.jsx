import { useCallback, useEffect, useRef, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { SalesFilterToolbar } from "../ui/SalesFilterToolbar";
import { Icons } from "../../utils/icons";
import { adminApiFetch } from "../../utils/adminApi";
import ClientAnalyticsModal from "./ClientAnalyticsModal";
import "./AdminClientsModule.css";

const PAGE_SIZE = 7;
const DEFAULT_FILTERS = {
  credit: "all",
  activity: "all",
  frequency: "all",
  registeredFrom: "",
  registeredTo: "",
  sort: "recent_activity_desc",
};

const numberValue = (value) => Number(value || 0);

const formatDate = (value, includeTime = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
};

const getInitials = (name) => {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return (parts[0][0] + parts[0][0]).toUpperCase();
  return "??";
};

function ClientStatusBadges({ client }) {
  return (
    <div className="acm-badge-stack">
      {client.deleted_at ? (
        <span className="acm-badge neutral">Dado de baja</span>
      ) : client.is_inactive ? (
        <span className="acm-badge neutral">Inactivo</span>
      ) : client.active_orders > 0 ? (
        <span className="acm-badge success">{client.active_orders} activa{client.active_orders === 1 ? "" : "s"}</span>
      ) : (
        <span className="acm-badge info">Sin órdenes activas</span>
      )}
      {client.is_frequent && <span className="acm-badge cyan">Frecuente</span>}
    </div>
  );
}

function ClientList({
  supabase,
  refreshKey,
  onAddClient,
  onEditClient,
  onRequestDelete,
  onRestoreClient,
  onOpenAnalytics,
  onCreateOrder,
  onViewOrders,
  onManageCredit,
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openMoreMenuId, setOpenMoreMenuId] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const closeMenuOnOutsidePointer = (event) => {
      const target = event.target;
      if (target && typeof target.closest === "function" && target.closest("[data-client-more-menu]")) return;
      setOpenMoreMenuId(null);
    };
    const closeMenuOnEscape = (event) => {
      if (event.key === "Escape") setOpenMoreMenuId(null);
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuOnOutsidePointer);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => setPage(1), [query, filters]);

  const loadPage = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");

    const { data, error: rpcError } = await supabase.rpc("admin_list_clients_v2", {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_search: query || null,
      p_credit_filter: filters.credit,
      p_activity_filter: filters.activity,
      p_frequency_filter: filters.frequency,
      p_registered_from: filters.registeredFrom || null,
      p_registered_to: filters.registeredTo || null,
      p_sort: filters.sort,
    });

    if (requestId !== requestIdRef.current) return;
    if (rpcError) {
      setItems([]);
      setTotal(0);
      setError(rpcError.message || "No se pudieron cargar los clientes.");
      setLoading(false);
      return;
    }

    const rows = Array.isArray(data) ? data.map((row) => ({
      ...row,
      total_orders: numberValue(row.total_orders),
      active_orders: numberValue(row.active_orders),
      completed_orders: numberValue(row.completed_orders),
      cancelled_orders: numberValue(row.cancelled_orders),
      active_credit_count: numberValue(row.active_credit_count),
      credit_history_count: numberValue(row.credit_history_count),
      settled_credit_count: numberValue(row.settled_credit_count),
    })) : [];
    const nextTotal = numberValue(rows[0]?.total_count);
    const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));

    if (page > maxPage) {
      setPage(maxPage);
      return;
    }

    setItems(rows);
    setTotal(nextTotal);
    setLoading(false);
  }, [filters, page, query, supabase]);

  useEffect(() => {
    loadPage();
  }, [loadPage, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(search)
    || Object.entries(filters).some(([key, value]) => value !== DEFAULT_FILTERS[key]);
  const activeFilterCount = Number(Boolean(search))
    + Object.entries(filters).filter(([key, value]) => value !== DEFAULT_FILTERS[key]).length;

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => {
    setSearch("");
    setQuery("");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  return (
    <section className="pa-section acm-section" aria-labelledby="clients-title">
      <div className="pa-section-heading acm-heading">
        <div>
          <h2 id="clients-title">Gestión de Clientes</h2>
          <p>Consulta, segmenta y administra los clientes registrados.</p>
          {total > 0 && (
            <div className="acm-total-badge">
              <Icons.Users />
              <strong>{total.toLocaleString("es-PE")}</strong> clientes registrados
            </div>
          )}
        </div>
        <button className="pa-btn primary" onClick={onAddClient}>
          <Icons.Plus /> Agregar cliente
        </button>
      </div>

      <SalesFilterToolbar
        ariaLabel="Filtros de clientes"
        search={{
          label: "Buscar clientes",
          value: search,
          onChange: setSearch,
          placeholder: "Buscar por nombre, teléfono, correo o ID…",
        }}
        controls={[
          { id: "credit", label: "Crédito", icon: <Icons.Receipt />, value: filters.credit, onChange: (value) => updateFilter("credit", value), isActive: filters.credit !== DEFAULT_FILTERS.credit, options: [{ value: "all", label: "Todos" }, { value: "with_credit", label: "Con crédito" }, { value: "without_credit", label: "Sin crédito" }] },
          { id: "activity", label: "Actividad", icon: <Icons.Orders />, value: filters.activity, onChange: (value) => updateFilter("activity", value), isActive: filters.activity !== DEFAULT_FILTERS.activity, options: [{ value: "all", label: "Todos" }, { value: "with_active", label: "Con órdenes activas" }, { value: "without_active", label: "Sin órdenes activas" }, { value: "inactive", label: "Inactivos (180 días)" }] },
          { id: "frequency", label: "Frecuencia", icon: <Icons.TrendUp />, value: filters.frequency, onChange: (value) => updateFilter("frequency", value), isActive: filters.frequency !== DEFAULT_FILTERS.frequency, options: [{ value: "all", label: "Todos" }, { value: "frequent", label: "Frecuentes" }, { value: "not_frequent", label: "No frecuentes" }] },
          { id: "registered-from", label: "Desde", dateLabel: "Registro desde", className: "pp-filter-date--range", type: "date", value: filters.registeredFrom, onChange: (value) => updateFilter("registeredFrom", value), isActive: Boolean(filters.registeredFrom) },
          { id: "registered-to", label: "Hasta", dateLabel: "Registro hasta", className: "pp-filter-date--range", type: "date", value: filters.registeredTo, onChange: (value) => updateFilter("registeredTo", value), isActive: Boolean(filters.registeredTo) },
          { id: "sort", label: "Ordenar por", icon: <Icons.Clock />, value: filters.sort, onChange: (value) => updateFilter("sort", value), isActive: filters.sort !== DEFAULT_FILTERS.sort, options: [{ value: "recent_activity_desc", label: "Actividad reciente" }, { value: "registered_desc", label: "Registro: más reciente" }, { value: "registered_asc", label: "Registro: más antiguo" }, { value: "name_asc", label: "Nombre: A–Z" }, { value: "name_desc", label: "Nombre: Z–A" }] },
        ]}
        resultCount={total}
        resultLabel={`resultado${total === 1 ? "" : "s"}`}
        activeFilters={activeFilterCount}
        onReset={resetFilters}
      />

      <div className="pa-panel acm-table-panel">
        <div className="pa-panel-head mat-unified-head">
          <div>
            <span className="mat-kicker">Gestión de clientes</span>
            <h2>Clientes registrados</h2>
          </div>
          <div className="mat-panel-tools">
            <div className="mat-tabs" role="tablist" aria-label="Filtro de actividad">
              <button
                type="button"
                className={filters.activity === "all" ? "active" : ""}
                onClick={() => updateFilter("activity", "all")}
                aria-selected={filters.activity === "all"}
              >
                <Icons.Users />
                <span>Todos</span>
              </button>
              <button
                type="button"
                className={filters.activity === "with_active" ? "active" : ""}
                onClick={() => updateFilter("activity", filters.activity === "with_active" ? "all" : "with_active")}
                aria-selected={filters.activity === "with_active"}
              >
                <Icons.Orders />
                <span>Con órdenes activas</span>
              </button>
              <button
                type="button"
                className={filters.activity === "without_active" ? "active" : ""}
                onClick={() => updateFilter("activity", filters.activity === "without_active" ? "all" : "without_active")}
                aria-selected={filters.activity === "without_active"}
              >
                <Icons.Users />
                <span>Sin órdenes activas</span>
              </button>
            </div>
          </div>
        </div>

        <div className="ps-table-wrap">
          <table className="ps-table acm-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th>Registro</th>
                <th>Actividad</th>
                <th>Crédito</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: PAGE_SIZE }, (_, index) => (
                  <tr key={index} className="acm-skeleton-row" aria-hidden="true">
                    <td colSpan={6}><span /></td>
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={6} className="ps-table-empty">
                    <div className="acm-error-state">
                      <Icons.AlertCircle />
                      <span>{error}</span>
                      <button className="pa-btn secondary pa-btn-sm" onClick={loadPage}>Reintentar</button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ps-table-empty">
                    <div className="acm-empty-state">
                      <Icons.Users />
                      <strong>No encontramos clientes</strong>
                      <span>{hasFilters ? "Prueba con otros filtros o limpia la búsqueda." : "Agrega el primer cliente para comenzar."}</span>
                      {hasFilters && <button className="pa-btn secondary pa-btn-sm" onClick={resetFilters}>Limpiar filtros</button>}
                    </div>
                  </td>
                </tr>
              ) : items.map((client) => (
                <tr
                  key={client.id}
                  className="row-hover acm-client-row"
                  onClick={() => onOpenAnalytics(client)}
                  onKeyDown={(event) => {
                    if (["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      onOpenAnalytics(client);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="td-pad">
                    <div className="acm-client-cell">
                      <span className="acm-avatar acm-avatar-small">{getInitials(client.name)}</span>
                      <span>
                        <strong>{client.name}</strong>
                      </span>
                    </div>
                  </td>
                  <td className="td-pad acm-contact-cell">
                    <span className="acm-contact-phone">{client.phone || "Sin teléfono"}</span>
                    <small className="acm-contact-email">{client.email || "Sin correo"}</small>
                  </td>
                  <td className="td-pad td-date"><span className="acm-badge neutral">{formatDate(client.created_at)}</span></td>
                  <td className="td-pad"><ClientStatusBadges client={client} /></td>
                  <td className="td-pad">
                    {client.active_credit_count > 0 ? (
                      <span className="acm-badge violet">{client.active_credit_count} pendiente{client.active_credit_count === 1 ? "" : "s"}</span>
                    ) : client.credit_history_count > 0 ? (
                      <span className="acm-badge success">Sin pendientes</span>
                    ) : (
                      <span className="acm-badge neutral">Sin crédito</span>
                    )}
                  </td>
                  <td className="td-pad td-actions" onClick={(event) => event.stopPropagation()}>
                    <div className="table-actions acm-row-actions">
                      {client.deleted_at ? (
                        <button
                          className="table-action-btn view"
                          onClick={() => onRestoreClient(client)}
                          title="Restaurar cliente"
                          aria-label={`Restaurar ${client.name}`}
                        >
                          <Icons.UserCheck />
                        </button>
                      ) : (
                        <>
                          <button className="table-action-btn view" onClick={() => onOpenAnalytics(client)} title="Ver estadísticas" aria-label={`Ver estadísticas de ${client.name}`}><Icons.Eye /></button>
                          <button className="table-action-btn edit" onClick={() => onEditClient(client)} title="Editar cliente" aria-label={`Editar ${client.name}`}><Icons.Edit /></button>
                          <button
                            className="table-action-btn cancel"
                            onClick={() => onRequestDelete(client)}
                            title="Eliminar cliente"
                            aria-label={`Eliminar ${client.name}`}
                          >
                            <Icons.Trash />
                          </button>
                          <details
                            className="acm-more-menu acm-row-more-menu"
                            data-client-more-menu
                            open={openMoreMenuId === client.id}
                          >
                            <summary
                              role="button"
                              aria-expanded={openMoreMenuId === client.id}
                              aria-label={`Más acciones de ${client.name}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setOpenMoreMenuId((current) => current === client.id ? null : client.id);
                              }}
                            >
                              <Icons.ChevronDown aria-hidden="true" />
                            </summary>
                            <div>
                              <button type="button" onClick={() => { setOpenMoreMenuId(null); onCreateOrder?.(client); }}><Icons.Plus /> Nueva orden</button>
                              <button type="button" onClick={() => { setOpenMoreMenuId(null); onViewOrders?.(client.id); }}><Icons.Orders /> Ver todas las órdenes</button>
                              <button type="button" onClick={() => { setOpenMoreMenuId(null); onManageCredit?.(client.id); }}><Icons.Receipt /> Gestionar crédito</button>
                            </div>
                          </details>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && !error && total > 0 && (
          <div className="acm-pagination-footer">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </section>
  );
}

function StatLine({ icon, label, value, tone = "info" }) {
  return (
    <div className="acm-stat-line">
      <span className={`acm-stat-icon ${tone}`}>{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function AdminClientsModule(props) {
  const [selectedClient, setSelectedClient] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const analyticsRequestIdRef = useRef(0);

  const openAnalytics = useCallback(async (client) => {
    if (!client?.id) return;
    const requestId = analyticsRequestIdRef.current + 1;
    analyticsRequestIdRef.current = requestId;
    const placeholder = { client_id: String(client.id), client_name: client.name || "Cliente" };
    setSelectedClient(placeholder);
    setAnalyticsLoading(true);
    setAnalyticsError("");

    try {
      const { response, result } = await adminApiFetch("/api/kpi-data", {
        action: "client_workspace_detail",
        client_id: client.id,
      });
      if (requestId !== analyticsRequestIdRef.current) return;
      if (!response.ok) throw new Error(result?.error || "No se pudieron cargar las estadísticas del cliente.");
      const analytics = result?.client;
      if (!analytics || String(analytics.client_id) !== String(client.id)) {
        throw new Error("La respuesta de estadísticas del cliente está incompleta.");
      }
      setSelectedClient(analytics);
    } catch (error) {
      if (requestId === analyticsRequestIdRef.current) setAnalyticsError(error?.message || "No se pudieron cargar las estadísticas del cliente.");
    } finally {
      if (requestId === analyticsRequestIdRef.current) setAnalyticsLoading(false);
    }
  }, []);

  const closeAnalytics = useCallback(() => {
    analyticsRequestIdRef.current += 1;
    setSelectedClient(null);
    setAnalyticsLoading(false);
    setAnalyticsError("");
  }, []);

  const retryAnalytics = useCallback(() => {
    if (!selectedClient?.client_id) return;
    openAnalytics({ id: selectedClient.client_id, name: selectedClient.client_name });
  }, [openAnalytics, selectedClient]);

  return (
    <>
      <ClientList {...props} onOpenAnalytics={openAnalytics} />
      <ClientAnalyticsModal
        client={selectedClient}
        loading={analyticsLoading}
        error={analyticsError}
        onRetry={retryAnalytics}
        onClose={closeAnalytics}
      />
    </>
  );
}
