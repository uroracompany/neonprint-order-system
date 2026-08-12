import { useEffect, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { Icons } from "../../utils/icons";
import { getOrderStatusLabel, getPaymentStatusLabel, STATUS_OPTIONS, PAYMENT_OPTIONS, formatDate, isProductionRole } from "../../utils/constants";
import { adminApiFetch } from "../../utils/adminApi";
import "./AdminEmployeeModule.css";

const ORDER_PAGE_SIZE = 7;

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

const getUserDisplayName = (profile) => {
  if (!profile) return "Usuario eliminado";
  const label = profile.name || profile.email || "Usuario eliminado";
  return profile.deleted_at || profile.employment_status === false ? `${label} — dado de baja` : label;
};

const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Caja",
    admin: "Administrador",
    printer: "Producción",
    digital_producer: "Producción Digital",
    dtf_producer: "Producción DTF",
    ploteo_producer: "Producción Ploteo",
    delivery: "Entrega"
  };
  return map[role] || role;
};

const getOrderTone = (status) => {
  const s = String(status || "").toLowerCase();
  if (["in_completed", "in_delivered"].includes(s)) return "success";
  if (s === "cancelled") return "danger";
  if (["in_production", "in_termination"].includes(s)) return "warning";
  return "info";
};

const getPaymentTone = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "pagado") return "success";
  if (s === "credito") return "violet";
  if (s === "parcial") return "warning";
  return "neutral";
};

const EMPTY_METRICS = {
  total_orders: 0,
  active_orders: 0,
  completed_orders: 0,
  delivered_orders: 0,
  cancelled_orders: 0,
};

function EmployeeMetricsCards({ profile }) {
  const role = profile?.role;
  const userId = profile?.id;
  const isProduction = isProductionRole(role);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [productionMetrics, setProductionMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function fetchEmployeeMetrics() {
      setLoadingMetrics(true);
      try {
        const res = await adminApiFetch('/api/admin', {
          action: 'employee-detail',
          userId,
          page: 1,
          pageSize: 1,
        });
        if (res.response.ok && !cancelled) {
          setMetrics(res.result?.metrics || EMPTY_METRICS);
          setProductionMetrics(res.result?.productionMetrics || null);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoadingMetrics(false);
    }
    fetchEmployeeMetrics();
    return () => { cancelled = true; };
  }, [userId]);

  const activeOrders = metrics?.active_orders || 0;
  const completedOrders = metrics?.completed_orders || 0;
  const deliveredOrders = metrics?.delivered_orders || 0;
  const cancelledOrders = metrics?.cancelled_orders || 0;

  return (
    <div className="acm-detail-grid">
      <article className="pa-panel acm-detail-card acm-detail-card-personal">
        <h3>Información personal</h3>
        <dl className="acm-info-list">
          <div><dt>Nombre completo</dt><dd>{getUserDisplayName(profile)}</dd></div>
          <div><dt>Correo electrónico</dt><dd>{profile?.email || "—"}</dd></div>
          <div><dt>Rol del sistema</dt><dd><span className="acm-badge info">{getRoleLabel(role)}</span></dd></div>
          <div className="acm-info-divider"><dt>ID de empleado</dt><dd>#{profile?.id?.slice(0, 8).toUpperCase()}</dd></div>
          <div><dt>Fecha de registro</dt><dd>{formatDate(profile?.created_at)}</dd></div>
          <div><dt>Estado laboral</dt><dd><span className={`acm-badge ${profile?.employment_status !== false && !profile?.deleted_at ? "success" : "neutral"}`}>{profile?.employment_status !== false && !profile?.deleted_at ? "Activo" : "Dado de baja"}</span></dd></div>
        </dl>
      </article>

      <article className="pa-panel acm-detail-card acm-detail-card-commerce">
        <h3>Resumen de órdenes</h3>
        <div className="acm-stat-list">
          <div className="acm-stat-line">
            <span className="acm-stat-icon info"><Icons.Orders /></span>
            <span>Órdenes asignadas</span>
            <strong>{metrics?.total_orders || 0}</strong>
          </div>
          <div className="acm-stat-line">
            <span className="acm-stat-icon warning"><Icons.Clock /></span>
            <span>Órdenes activas</span>
            <strong>{activeOrders}</strong>
          </div>
          <div className="acm-stat-line">
            <span className="acm-stat-icon success"><Icons.Check /></span>
            <span>Órdenes completadas</span>
            <strong>{completedOrders}</strong>
          </div>
          <div className="acm-stat-line">
            <span className="acm-stat-icon cyan"><Icons.Truck /></span>
            <span>Órdenes entregadas</span>
            <strong>{deliveredOrders}</strong>
          </div>
        </div>
        <div className="acm-card-footer-stat">
          <span className="acm-footer-icon danger"><Icons.X /></span>
          <span>Órdenes canceladas</span>
          <strong>{cancelledOrders}</strong>
        </div>
      </article>

      <article className="pa-panel acm-detail-card acm-detail-card-credit">
        <h3>Información del rol</h3>
        <div className="acm-stat-list">
          <div className="acm-stat-line">
            <span className="acm-stat-icon violet"><Icons.User /></span>
            <span>Rol actual</span>
            <span className="acm-badge info">{getRoleLabel(role)}</span>
          </div>
        </div>
        {isProduction && (
          <div className="acm-production-metrics">
            {loadingMetrics ? (
              <div className="acm-production-loading">
                <div className="kpi-spinner" />
                <span>Cargando metricas de produccion...</span>
              </div>
            ) : productionMetrics ? (
              <>
                <div className="acm-production-header">
                  <Icons.Refresh />
                  <span>Metricas de Produccion (Mes Actual)</span>
                </div>
                <div className="acm-stat-list">
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon info"><Icons.Package /></span>
                    <span>Archivos procesados</span>
                    <strong>{productionMetrics.total_files || 0}</strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon success"><Icons.Check /></span>
                    <span>Completados</span>
                    <strong>{productionMetrics.completed || 0}</strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon warning"><Icons.Clock /></span>
                    <span>En proceso</span>
                    <strong>{(productionMetrics.in_production || 0) + (productionMetrics.in_termination || 0)}</strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon violet"><Icons.TrendUp /></span>
                    <span>Eficiencia</span>
                    <strong className={productionMetrics.efficiency_score >= 70 ? "text-success" : productionMetrics.efficiency_score >= 40 ? "text-warning" : "text-danger"}>
                      {productionMetrics.efficiency_score || 0} pts
                    </strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon cyan"><Icons.Clock /></span>
                    <span>Tiempo promedio</span>
                    <strong>{productionMetrics.avg_time_days || 0}d</strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon success"><Icons.CheckCircle /></span>
                    <span>Calidad (sin rev.)</span>
                    <strong className={productionMetrics.first_time_right >= 90 ? "text-success" : productionMetrics.first_time_right >= 70 ? "text-warning" : "text-danger"}>
                      {productionMetrics.first_time_right || 100}%
                    </strong>
                  </div>
                  <div className="acm-stat-line">
                    <span className="acm-stat-icon info"><Icons.TrendUp /></span>
                    <span>Archivos/dia</span>
                    <strong>{productionMetrics.files_per_day || 0}</strong>
                  </div>
                </div>
                {productionMetrics.alerts && productionMetrics.alerts.length > 0 && (
                  <div className="acm-production-alerts">
                    {productionMetrics.alerts.map((alert, i) => (
                      <div key={i} className={`acm-production-alert ${alert.severity}`}>
                        <Icons.AlertCircle />
                        <span>{alert.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="pa-emp-production-notice">
                <Icons.Clock />
                <span>Sin datos de produccion para este periodo.</span>
              </div>
            )}
          </div>
        )}
        <div className="acm-card-footer-stat">
          <span className="acm-footer-icon info"><Icons.Calendar /></span>
          <span>Registrado el</span>
          <strong>{formatDate(profile?.created_at)}</strong>
        </div>
      </article>
    </div>
  );
}

function EmployeeOrdersPanel({ profile, onViewOrder }) {
  const userId = profile?.id;

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [employeeOrders, setEmployeeOrders] = useState([]);
  const [totalOrders, setTotalOrders] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [query, statusFilter, paymentFilter]);

  useEffect(() => {
    if (!userId) {
      setEmployeeOrders([]);
      setTotalOrders(0);
      return undefined;
    }

    let cancelled = false;
    async function fetchEmployeeOrders() {
      try {
        const res = await adminApiFetch('/api/admin', {
          action: 'employee-detail',
          userId,
          page,
          pageSize: ORDER_PAGE_SIZE,
          status: statusFilter,
          paymentStatus: paymentFilter,
          search: query,
        });
        if (res.response.ok && !cancelled) {
          setEmployeeOrders(Array.isArray(res.result?.orders) ? res.result.orders : []);
          setTotalOrders(Number(res.result?.total) || 0);
        }
      } catch {
        if (!cancelled) {
          setEmployeeOrders([]);
          setTotalOrders(0);
        }
      }
    }
    fetchEmployeeOrders();
    return () => { cancelled = true; };
  }, [userId, page, statusFilter, paymentFilter, query]);

  const totalPages = Math.max(1, Math.ceil(totalOrders / ORDER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = employeeOrders;

  const hasFilters = Boolean(query) || statusFilter !== "all" || paymentFilter !== "all";

  return (
    <>
      <div className="acm-filter-panel acm-activity-filter-panel" aria-label="Filtros de órdenes del empleado">
        <div className="acm-activity-search-row">
          <div className="pa-search-box acm-search">
            <Icons.Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, factura, estado…"
              aria-label="Buscar en órdenes del empleado"
            />
            {search && (
              <button className="acm-search-clear" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
                <Icons.X />
              </button>
            )}
          </div>
          <span className="pa-results-count">{totalOrders} resultado{totalOrders === 1 ? "" : "s"}</span>
        </div>

        <div className="acm-filter-grid">
          <label>
            <span>Estado operativo</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{getOrderStatusLabel(s)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Estado de pago</span>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="all">Todos</option>
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p} value={p}>{getPaymentStatusLabel(p)}</option>
              ))}
            </select>
          </label>
        </div>

        {hasFilters && (
          <button className="acm-reset" onClick={() => { setSearch(""); setQuery(""); setStatusFilter("all"); setPaymentFilter("all"); }}>
            <Icons.X /> Limpiar filtros
          </button>
        )}
      </div>

      <div className="acm-activity-panel">
        <div className="acm-activity-heading">
          <div>
            <h3>Órdenes del empleado</h3>
            <p>Órdenes registradas para este empleado con búsqueda y filtros.</p>
          </div>
          <div />
        </div>

        <div className="ps-table-wrap">
          <table className="ps-table acm-activity-table">
            <thead>
              <tr>
                <th>Cliente / Factura</th>
                <th>Fecha</th>
                <th>Estado operativo</th>
                <th>Estado de pago</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ps-table-empty">
                    <div className="acm-empty-state">
                      <Icons.Orders />
                      <strong>No encontramos órdenes</strong>
                      <span>{hasFilters ? "Prueba con otros filtros o limpia la búsqueda." : "Este empleado todavía no tiene órdenes asignadas."}</span>
                      {hasFilters && <button className="pa-btn secondary pa-btn-sm" onClick={() => { setSearch(""); setQuery(""); setStatusFilter("all"); setPaymentFilter("all"); }}>Limpiar filtros</button>}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((order) => (
                  <tr key={order.id} className="row-hover" onClick={() => onViewOrder?.(order)}>
                    <td className="td-pad">
                      <div className="acm-order-id">
                        <Icons.FileText />
                        <span>
                          <strong>{order.client_name || "Sin cliente"}</strong>
                          <small>{order.invoice_number || "Sin factura"}</small>
                        </span>
                      </div>
                    </td>
                    <td className="td-pad">{formatDate(order.created_at)}</td>
                    <td className="td-pad">
                      <span className={`acm-badge ${getOrderTone(order.status)}`}>
                        {getOrderStatusLabel(order.status)}
                      </span>
                    </td>
                    <td className="td-pad">
                      <span className={`acm-badge ${getPaymentTone(order.payment_status)}`}>
                        {getPaymentStatusLabel(order.payment_status)}
                      </span>
                    </td>
                    <td className="td-pad td-actions"><Icons.ChevronRight /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalOrders > 0 && (
          <div className="acm-pagination-footer">
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

export default function AdminEmployeeModule({ profile, onBack, onEditUser, onViewOrder, onDeleteUser, onRestoreUser, currentUserId }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  if (!profile) {
    return (
      <section className="pa-section acm-detail-view">
        <button className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a empleados</button>
        <div className="pa-panel acm-detail-error">
          <Icons.AlertCircle />
          <h2>No pudimos abrir este empleado</h2>
          <p>El registro ya no está disponible.</p>
          <button className="pa-btn secondary" onClick={onBack}>Volver</button>
        </div>
      </section>
    );
  }

  const isActive = profile?.employment_status !== false && !profile?.deleted_at;

  return (
    <section className="pa-section acm-detail-view" aria-labelledby="employee-detail-title">
      <button className="acm-back" onClick={onBack}><Icons.ArrowLeft /> Volver a empleados</button>

      <div className="acm-detail-hero">
        <div className="acm-detail-identity">
          <span className="acm-avatar acm-avatar-large">{getInitials(getUserDisplayName(profile))}</span>
          <div className="acm-detail-copy">
            <div className="acm-detail-name-line">
              <h2 id="employee-detail-title">{getUserDisplayName(profile)}</h2>
            </div>
            <div className="acm-detail-contact">
              <span><Icons.Mail /> {profile?.email || "Sin correo"}</span>
            </div>
            <div className="acm-detail-status-line">
              {isActive ? (
                <span className="acm-profile-status active"><span /> Empleado activo</span>
              ) : (
                <span className="acm-profile-status inactive">Empleado inactivo</span>
              )}
              <small>Registrado el {formatDate(profile?.created_at)}</small>
            </div>
          </div>
        </div>
        <div className="acm-detail-actions">
          {!profile.deleted_at && <button className="pa-btn secondary" onClick={() => onEditUser?.(profile)}>
            <Icons.Edit /> Editar empleado
          </button>}
          {profile.deleted_at && (
            <button className="pa-btn primary" onClick={() => onRestoreUser?.(profile)}>
              <Icons.UserCheck /> Restaurar empleado
            </button>
          )}
          {profile.id !== currentUserId && !profile.deleted_at && (
            <button className="pa-btn danger" onClick={() => onDeleteUser?.(profile)}>
              <Icons.UserMinus /> Dar de baja
            </button>
          )}
        </div>
      </div>

      <EmployeeMetricsCards profile={profile} />

      <EmployeeOrdersPanel profile={profile} onViewOrder={onViewOrder} />
    </section>
  );
}
