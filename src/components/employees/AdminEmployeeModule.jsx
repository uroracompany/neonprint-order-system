import { useEffect, useMemo, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { Icons } from "../../utils/icons";
import { getOrderStatusLabel, getPaymentStatusLabel, STATUS_OPTIONS, PAYMENT_OPTIONS, formatDate, isProductionRole, normalizeText } from "../../utils/constants";
import "./AdminEmployeeModule.css";

const ORDER_PAGE_SIZE = 7;

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Caja",
    admin: "Administrador",
    printer: "Producción",
    digital_producer: "Produccion Digital",
    dtf_producer: "Produccion DTF",
    ploteo_producer: "Produccion Ploteo",
    delivery: "Entrega"
  };
  return map[role] || role;
};

const resolveAssignmentIdsByRole = (order, role) => {
  const normalizedRole = normalizeText(role);
  if (["seller", "admin"].includes(normalizedRole)) {
    return [(order?.seller_id || order?.created_by)].filter(Boolean);
  }
  if (normalizedRole === "designer") {
    return [order?.designer_id].filter(Boolean);
  }
  if (normalizedRole === "quote") {
    return ["quote_id", "quotation_id", "quote_user_id"].map((field) => order?.[field]).filter(Boolean);
  }
  if (normalizedRole === "delivery") {
    return [order?.delivery_id].filter(Boolean);
  }
  return [];
};

const orderMatchesEmployee = (order, userId, role) => {
  if (!userId) return false;
  return resolveAssignmentIdsByRole(order, role).includes(userId);
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

function EmployeeMetricsCards({ profile, orders }) {
  const role = profile?.role;
  const userId = profile?.id;
  const isProduction = isProductionRole(role);

  const employeeOrders = useMemo(() => {
    return orders.filter((o) => orderMatchesEmployee(o, userId, role));
  }, [orders, userId, role]);

  const activeOrders = employeeOrders.filter((o) =>
    !["cancelled", "in_Completed", "in_Delivered"].includes(o?.status)
  ).length;

  const completedOrders = employeeOrders.filter((o) =>
    o?.status === "in_Completed"
  ).length;

  const deliveredOrders = employeeOrders.filter((o) =>
    o?.status === "in_Delivered"
  ).length;

  const cancelledOrders = employeeOrders.filter((o) =>
    o?.status === "cancelled"
  ).length;

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
          <div><dt>Estado laboral</dt><dd><span className={`acm-badge ${profile?.employment_status !== false ? "success" : "neutral"}`}>{profile?.employment_status !== false ? "Activo" : "Inactivo"}</span></dd></div>
        </dl>
      </article>

      <article className="pa-panel acm-detail-card acm-detail-card-commerce">
        <h3>Resumen de órdenes</h3>
        <div className="acm-stat-list">
          <div className="acm-stat-line">
            <span className="acm-stat-icon info"><Icons.Orders /></span>
            <span>Órdenes asignadas</span>
            <strong>{employeeOrders.length}</strong>
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
          <div className="pa-emp-production-notice">
            <Icons.Clock />
            <span>Las métricas detalladas de producción (archivos por área) estarán disponibles próximamente.</span>
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

function EmployeeOrdersPanel({ profile, orders, onViewOrder }) {
  const role = profile?.role;
  const userId = profile?.id;

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [query, statusFilter, paymentFilter]);

  const employeeOrders = useMemo(() => {
    let filtered = orders.filter((o) => orderMatchesEmployee(o, userId, role));
    if (query) {
      const q = normalizeText(query);
      filtered = filtered.filter((o) =>
        [o?.client_name, o?.invoice_number, o?.status, o?.id]
          .some((v) => normalizeText(v).includes(q))
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((o) => o?.status === statusFilter);
    }
    if (paymentFilter !== "all") {
      filtered = filtered.filter((o) => o?.payment_status === paymentFilter);
    }
    return filtered;
  }, [orders, userId, role, query, statusFilter, paymentFilter]);

  const totalPages = Math.max(1, Math.ceil(employeeOrders.length / ORDER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = employeeOrders.slice(
    (safePage - 1) * ORDER_PAGE_SIZE,
    safePage * ORDER_PAGE_SIZE
  );

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
          <span className="pa-results-count">{employeeOrders.length} resultado{employeeOrders.length === 1 ? "" : "s"}</span>
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
                  <td colSpan={5} className="ps-table-empty acm-empty-state">
                    <Icons.Orders />
                    <strong>No encontramos órdenes</strong>
                    <span>{hasFilters ? "Prueba con otros filtros o limpia la búsqueda." : "Este empleado todavía no tiene órdenes asignadas."}</span>
                    {hasFilters && <button className="pa-btn secondary pa-btn-sm" onClick={() => { setSearch(""); setQuery(""); setStatusFilter("all"); setPaymentFilter("all"); }}>Limpiar filtros</button>}
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

        {employeeOrders.length > 0 && (
          <div className="acm-pagination-footer">
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

export default function AdminEmployeeModule({ profile, orders, onBack, onEditUser, onViewOrder, onDeleteUser }) {
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

  const isActive = profile?.employment_status !== false;

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
          <button className="pa-btn secondary" onClick={() => onEditUser?.(profile)}>
            <Icons.Edit /> Editar empleado
          </button>
          <button className="pa-btn danger" onClick={() => onDeleteUser?.(profile)}>
            <Icons.Trash /> Eliminar empleado
          </button>
        </div>
      </div>

      <EmployeeMetricsCards profile={profile} orders={orders} />

      <EmployeeOrdersPanel profile={profile} orders={orders} onViewOrder={onViewOrder} />
    </section>
  );
}
