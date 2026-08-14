import { useCallback, useEffect, useRef, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { SalesFilterToolbar } from "../ui/SalesFilterToolbar";
import { Icons } from "../../utils/icons";
import {
  getOrderStatusLabel,
  getPaymentStatusLabel,
  STATUS_OPTIONS,
  PAYMENT_OPTIONS,
} from "../../utils/constants";
import OrderDetailModal from "../orders/OrderDetailModal";
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

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

const getOrderTone = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (["in_completed", "in_delivered"].includes(normalized)) return "success";
  if (normalized === "cancelled") return "danger";
  if (["in_production", "in_termination"].includes(normalized)) return "warning";
  return "info";
};

const getPaymentTone = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pagado") return "success";
  if (normalized === "credito") return "violet";
  if (normalized === "parcial") return "warning";
  return "neutral";
};

function ClientStatusBadges({ client }) {
  return (
    <div className="acm-badge-stack">
      {client.is_inactive ? (
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
  onOpenDetail,
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

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

    const { data, error: rpcError } = await supabase.rpc("admin_list_clients", {
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
        <div className="pa-panel-stripe" />
        <div className="pa-panel-head pa-panel-head-results">
          <div>
            <h2>Clientes registrados</h2>
            <p className="acm-panel-description">Frecuente: 5 o más órdenes completadas en su historial.</p>
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
                  onClick={() => onOpenDetail(client.id)}
                  onKeyDown={(event) => {
                    if (["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      onOpenDetail(client.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="td-pad">
                    <div className="acm-client-cell">
                      <span className="acm-avatar acm-avatar-small">{getInitials(client.name)}</span>
                      <span>
                        <strong>{client.name}</strong>
                        <small>#{client.id.slice(0, 8).toUpperCase()}</small>
                      </span>
                    </div>
                  </td>
                  <td className="td-pad acm-contact-cell">
                    <span>{client.phone || "Sin teléfono"}</span>
                    <small>{client.email || "Sin correo"}</small>
                  </td>
                  <td className="td-pad td-date">{formatDate(client.created_at)}</td>
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
                      <button className="table-action-btn view" onClick={() => onOpenDetail(client.id)} title="Ver detalle" aria-label={`Ver detalle de ${client.name}`}><Icons.Eye /></button>
                      <button className="table-action-btn edit" onClick={() => onEditClient(client)} title="Editar cliente" aria-label={`Editar ${client.name}`}><Icons.Edit /></button>
                      <button
                        className="table-action-btn cancel"
                        onClick={() => onRequestDelete(client)}
                        title="Eliminar cliente"
                        aria-label={`Eliminar ${client.name}`}
                      >
                        <Icons.Trash />
                      </button>
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

function ClientDetail({
  supabase,
  clientId,
  refreshKey,
  onBack,
  onEditClient,
  onRequestDelete,
  onCreateOrder,
  onViewOrders,
  onManageCredit,
  onRestoreClient,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && menuRef.current.open && !menuRef.current.contains(e.target)) {
        menuRef.current.removeAttribute("open");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const ORDER_PAGE_SIZE = 7;

  const [orderSearch, setOrderSearch] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderItems, setOrderItems] = useState([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderPaymentFilter, setOrderPaymentFilter] = useState("all");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const orderRequestIdRef = useRef(0);
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setOrderQuery(orderSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [orderSearch]);

  useEffect(() => setOrderPage(1), [orderQuery, orderStatusFilter, orderPaymentFilter, orderDateFrom, orderDateTo]);

  const loadOrders = useCallback(async () => {
    const requestId = orderRequestIdRef.current + 1;
    orderRequestIdRef.current = requestId;
    setOrderLoading(true);
    setOrderError("");

    const { data, error: rpcError } = await supabase.rpc("admin_list_client_orders", {
      p_client_id: clientId,
      p_page: orderPage,
      p_page_size: ORDER_PAGE_SIZE,
      p_search: orderQuery || null,
      p_status_filter: orderStatusFilter,
      p_payment_filter: orderPaymentFilter,
      p_date_from: orderDateFrom || null,
      p_date_to: orderDateTo || null,
    });

    if (requestId !== orderRequestIdRef.current) return;
    if (rpcError) {
      setOrderItems([]);
      setOrderTotal(0);
      setOrderError(rpcError.message || "No se pudieron cargar las órdenes.");
      setOrderLoading(false);
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    const nextTotal = Number(rows[0]?.total_count || 0);
    const maxPage = Math.max(1, Math.ceil(nextTotal / ORDER_PAGE_SIZE));

    if (orderPage > maxPage) {
      setOrderPage(maxPage);
      return;
    }

    setOrderItems(rows);
    setOrderTotal(nextTotal);
    setOrderLoading(false);
  }, [clientId, orderPage, orderQuery, orderStatusFilter, orderPaymentFilter, orderDateFrom, orderDateTo, supabase]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const hasOrderFilters = Boolean(orderSearch)
    || orderStatusFilter !== "all"
    || orderPaymentFilter !== "all"
    || Boolean(orderDateFrom)
    || Boolean(orderDateTo);
  const orderActiveFilterCount = [orderSearch, orderStatusFilter !== "all", orderPaymentFilter !== "all", orderDateFrom, orderDateTo].filter(Boolean).length;
  const resetOrderFilters = () => {
    setOrderSearch("");
    setOrderQuery("");
    setOrderStatusFilter("all");
    setOrderPaymentFilter("all");
    setOrderDateFrom("");
    setOrderDateTo("");
    setOrderPage(1);
  };

  const handleOrderClick = useCallback(async (orderId) => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    if (data) setSelectedOrder(data);
  }, [supabase]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("admin_get_client_detail", { p_client_id: clientId });
    if (rpcError) {
      setDetail(null);
      setError(rpcError.message || "No se pudo cargar el detalle del cliente.");
    } else {
      setDetail(data || null);
    }
    setLoading(false);
  }, [clientId, supabase]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail, refreshKey]);

  if (loading) {
    return (
      <section className="pa-section acm-detail-view" aria-busy="true">
        <button className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a clientes</button>
        <div className="acm-detail-loading"><span /><span /><span /></div>
      </section>
    );
  }

  if (error || !detail?.client) {
    return (
      <section className="pa-section acm-detail-view">
        <button className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a clientes</button>
        <div className="pa-panel acm-detail-error">
          <Icons.AlertCircle />
          <h2>No pudimos abrir este cliente</h2>
          <p>{error || "El registro ya no está disponible."}</p>
          <button className="pa-btn secondary" onClick={loadDetail}>Reintentar</button>
      </div>
    </section>
  );
}

  const client = detail.client;
  const stats = Object.fromEntries(Object.entries(detail.stats || {}).map(([key, value]) => (
    [key, typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value]
  )));
  const confirmDelete = () => onRequestDelete(client);

  return (
    <section className="pa-section acm-detail-view" aria-labelledby="client-detail-title">
      <button className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a clientes</button>

      <div className="acm-detail-hero">
        <div className="acm-detail-identity">
          <span className="acm-avatar acm-avatar-large">{getInitials(client.name)}</span>
          <div className="acm-detail-copy">
            <div className="acm-detail-name-line">
              <h2 id="client-detail-title">{client.name}</h2>
            </div>
            <div className="acm-detail-contact">
              <span><Icons.Phone /> {client.phone || "Sin teléfono"}</span>
              <span><Icons.Mail /> {client.email || "Sin correo"}</span>
            </div>
            <div className="acm-detail-status-line">
              {stats.is_frequent ? (
                <span className="acm-profile-status frequent"><Icons.TrendUp /> Cliente frecuente</span>
              ) : stats.is_inactive ? (
                <span className="acm-profile-status inactive">Cliente inactivo</span>
              ) : (
                <span className="acm-profile-status active"><span /> Cliente activo</span>
              )}
              <small>Registrado el {formatDate(client.created_at)}</small>
            </div>
          </div>
        </div>
        <div className="acm-detail-actions">
          <button className="pa-btn primary acm-detail-action-primary" onClick={() => onCreateOrder(client)}>
            <Icons.Plus /> Nueva orden
          </button>
          <details ref={menuRef} className="acm-more-menu">
            <summary aria-label="Más acciones"><Icons.Menu /></summary>
            <div>
              <button onClick={() => onEditClient(client)}><Icons.Edit /> Editar cliente</button>
              <button onClick={() => onViewOrders(client.id)}><Icons.Orders /> Ver todas las órdenes</button>
              <button onClick={() => onManageCredit(client.id)}><Icons.Receipt /> Gestionar crédito</button>
              {client.deleted_at ? (
                <button onClick={() => onRestoreClient?.(client)}>
                  <Icons.UserCheck /> Restaurar cliente
                </button>
              ) : (
                <button className="danger" onClick={confirmDelete}>
                  <Icons.Trash /> Dar de baja
                </button>
              )}
            </div>
          </details>
        </div>
      </div>

      <div className="acm-detail-grid">
        <article className="pa-panel acm-detail-card acm-detail-card-personal">
          <h3>Información personal</h3>
          <dl className="acm-info-list">
            <div><dt>Nombre completo</dt><dd>{client.name}</dd></div>
            <div><dt>Teléfono</dt><dd>{client.phone || "—"}</dd></div>
            <div><dt>Correo</dt><dd>{client.email || "—"}</dd></div>
            <div className="acm-info-divider"><dt>Dirección</dt><dd>{client.address || "—"}</dd></div>
            <div><dt>ID de cliente</dt><dd>#{client.id.slice(0, 8).toUpperCase()}</dd></div>
            <div><dt>Fecha de registro</dt><dd>{formatDate(client.created_at)}</dd></div>
            <div><dt>Última modificación</dt><dd>{formatDate(client.updated_at, true)}</dd></div>
            <div className="acm-info-divider"><dt>Notas internas</dt><dd>{client.notes || "—"}</dd></div>
          </dl>
        </article>

        <article className="pa-panel acm-detail-card acm-detail-card-commerce">
          <h3>Resumen comercial</h3>
          <div className="acm-stat-list">
            <StatLine icon={<Icons.AlertCircle />} label="Ordenes 911" value={numberValue(stats.urgent_911_orders)} tone="danger" />
            <StatLine icon={<Icons.FileText />} label="Ordenes normales" value={numberValue(stats.normal_orders)} tone="info" />
            <StatLine icon={<Icons.Brush />} label="Ordenes diseno interno" value={numberValue(stats.internal_design_orders)} tone="violet" />
            <StatLine icon={<Icons.ExternalLink />} label="Ordenes diseno externo" value={numberValue(stats.external_design_orders)} tone="warning" />
            <StatLine icon={<Icons.Orders />} label="Total de órdenes" value={numberValue(stats.total_orders)} tone="info" />
            <StatLine icon={<Icons.Clock />} label="Órdenes activas / pendientes" value={numberValue(stats.active_orders)} tone="warning" />
            <StatLine icon={<Icons.Check />} label="Órdenes completadas" value={numberValue(stats.completed_orders)} tone="success" />
            <StatLine icon={<Icons.X />} label="Órdenes canceladas" value={numberValue(stats.cancelled_orders)} tone="danger" />
          </div>
          <div className="acm-card-footer-stat">
            <span className="acm-footer-icon info"><Icons.Calendar /></span>
            <span>Última compra</span>
            <strong>{formatDate(stats.last_order_at)}</strong>
          </div>
        </article>

        <article className="pa-panel acm-detail-card acm-detail-card-credit">
          <h3>Crédito</h3>
          <div className="acm-stat-list">
            <StatLine icon={<Icons.Receipt />} label="Facturas de crédito activas" value={numberValue(stats.active_credit_count)} tone="violet" />
            <StatLine icon={<Icons.FileText />} label="Historial total de crédito" value={numberValue(stats.credit_history_count)} tone="info" />
            <StatLine icon={<Icons.Check />} label="Créditos saldados" value={numberValue(stats.settled_credit_count)} tone="success" />
          </div>
          <div className="acm-card-footer-stat">
            <span className="acm-footer-icon danger"><Icons.Calendar /></span>
            <span>Crédito pendiente más antiguo</span>
            <strong>{formatDate(stats.oldest_pending_credit_at)}</strong>
          </div>
        </article>
      </div>

      <SalesFilterToolbar
        ariaLabel="Filtros de actividad"
        search={{
          label: "Buscar en actividad reciente",
          value: orderSearch,
          onChange: setOrderSearch,
          placeholder: "Buscar por orden, factura, estado…",
        }}
        controls={[
          { id: "order-status", label: "Estado operativo", icon: <Icons.FileText />, value: orderStatusFilter, onChange: setOrderStatusFilter, isActive: orderStatusFilter !== "all", options: [{ value: "all", label: "Todos" }, ...STATUS_OPTIONS.map((status) => ({ value: status, label: getOrderStatusLabel(status) }))] },
          { id: "order-payment", label: "Estado de pago", icon: <Icons.Money />, value: orderPaymentFilter, onChange: setOrderPaymentFilter, isActive: orderPaymentFilter !== "all", options: [{ value: "all", label: "Todos" }, ...PAYMENT_OPTIONS.map((payment) => ({ value: payment, label: getPaymentStatusLabel(payment) }))] },
          { id: "order-from", label: "Desde", type: "date", value: orderDateFrom, onChange: setOrderDateFrom, isActive: Boolean(orderDateFrom) },
          { id: "order-to", label: "Hasta", type: "date", value: orderDateTo, onChange: setOrderDateTo, isActive: Boolean(orderDateTo) },
        ]}
        resultCount={orderTotal}
        resultLabel={`resultado${orderTotal === 1 ? "" : "s"}`}
        activeFilters={orderActiveFilterCount}
        onReset={resetOrderFilters}
      />

      <div className="acm-activity-panel">
        <div className="acm-activity-heading">
          <div>
            <h3>Actividad reciente</h3>
            <p>Órdenes registradas para este cliente con búsqueda y filtros.</p>
          </div>
          <div>
            <button onClick={() => onViewOrders(client.id)}>Ver todas las órdenes</button>
            <button onClick={() => onManageCredit(client.id)}>Gestionar crédito</button>
          </div>
        </div>

        <div className="ps-table-wrap">
          <table className="ps-table acm-activity-table">
            <thead><tr><th>Orden / factura</th><th>Fecha</th><th>Estado operativo</th><th>Estado de pago</th><th /></tr></thead>
            <tbody>
              {orderLoading ? (
                Array.from({ length: ORDER_PAGE_SIZE }, (_, index) => (
                  <tr key={index} className="acm-skeleton-row" aria-hidden="true">
                    <td colSpan={5}><span /></td>
                  </tr>
                ))
              ) : orderError ? (
                <tr>
                  <td colSpan={5} className="ps-table-empty">
                    <div className="acm-error-state">
                      <Icons.AlertCircle />
                      <span>{orderError}</span>
                      <button className="pa-btn secondary pa-btn-sm" onClick={loadOrders}>Reintentar</button>
                    </div>
                  </td>
                </tr>
              ) : orderItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ps-table-empty">
                    <div className="acm-empty-state">
                      <Icons.Orders />
                      <strong>No encontramos órdenes</strong>
                      <span>{hasOrderFilters
                        ? "Prueba con otros filtros o limpia la búsqueda."
                        : "Este cliente todavía no tiene órdenes."}</span>
                    </div>
                  </td>
                </tr>
              ) : orderItems.map((order) => (
                <tr key={order.id} className="row-hover" onClick={() => handleOrderClick(order.id)}>
                  <td className="td-pad">
                    <div className="acm-order-id"><Icons.FileText /><span><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{order.invoice_number || "Sin factura"}</small></span></div>
                  </td>
                  <td className="td-pad">{formatDate(order.created_at)}</td>
                  <td className="td-pad"><span className={`acm-badge ${getOrderTone(order.status)}`}>{getOrderStatusLabel(order.status)}</span></td>
                  <td className="td-pad"><span className={`acm-badge ${getPaymentTone(order.payment_status)}`}>{getPaymentStatusLabel(order.payment_status)}</span></td>
                  <td className="td-pad td-actions"><Icons.ChevronRight /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!orderLoading && !orderError && orderTotal > 0 && (
          <div className="acm-pagination-footer">
            <Pagination currentPage={orderPage} totalPages={Math.max(1, Math.ceil(orderTotal / ORDER_PAGE_SIZE))} onPageChange={setOrderPage} />
          </div>
        )}
      </div>

      <OrderDetailModal
        open={!!selectedOrder}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        showPrimaryAction={false}
        adminActions={null}
      />
    </section>
  );
}

export default function AdminClientsModule(props) {
  const [view, setView] = useState("list");
  const [selectedClientId, setSelectedClientId] = useState(null);

  const openDetail = (clientId) => {
    setSelectedClientId(clientId);
    setView("detail");
  };

  const closeDetail = () => {
    setSelectedClientId(null);
    setView("list");
  };

  useEffect(() => {
    if (!selectedClientId && view === "detail") setView("list");
  }, [selectedClientId, view]);

  return view === "detail" && selectedClientId ? (
    <ClientDetail {...props} clientId={selectedClientId} onBack={closeDetail} />
  ) : (
    <ClientList {...props} onOpenDetail={openDetail} />
  );
}
