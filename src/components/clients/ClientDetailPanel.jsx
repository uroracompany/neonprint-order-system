import { useState, useEffect, useCallback, useMemo } from "react";
import { Icons } from "../../utils/icons";
import { formatDominicanPhone } from "../../utils/clients";

const ORDERS_PAGE_SIZE = 5;

function formatDate(dateStr) {
  if (!dateStr) return "---";
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 0 });
}

const STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En proceso",
  in_design: "En diseno",
  in_production: "En produccion",
  in_quality: "En control",
  ready: "Listo",
  in_delivered: "Entregado",
  in_completed: "Completado",
  cancelled: "Cancelado",
};

const PAYMENT_LABELS = {
  pending: "Pendiente",
  paid: "Pagado",
  partial: "Parcial",
  credited: "A credito",
};

function getStatusConfig(status) {
  const s = String(status || "").toLowerCase();
  if (s === "cancelled") return { label: "Cancelado", cls: "danger" };
  if (s === "in_completed" || s === "in_delivered") return { label: "Completado", cls: "success" };
  if (s === "pending") return { label: "Pendiente", cls: "warning" };
  return { label: STATUS_LABELS[s] || status || "---", cls: "info" };
}

function getPaymentConfig(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return { label: "Pagado", cls: "success" };
  if (s === "partial") return { label: "Parcial", cls: "warning" };
  if (s === "credited") return { label: "Credito", cls: "cyan" };
  return { label: "Pendiente", cls: "danger" };
}

export default function ClientDetailPanel({ supabase, clientId, onBack, onViewOrder }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ordersPage, setOrdersPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.rpc("caja_get_client_detail", {
          p_client_id: clientId,
        });
        if (error) throw error;
        if (!cancelled) setDetail(data);
      } catch (err) {
        console.error("Error loading client detail:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, clientId]);

  const client = detail?.client;
  const stats = detail?.stats;
  const recentOrders = useMemo(() => {
    const orders = detail?.recent_orders || [];
    if (statusFilter === "all") return orders;
    return orders.filter(o => {
      const s = String(o.status || "").toLowerCase();
      if (statusFilter === "active") return !["cancelled", "in_completed", "in_delivered"].includes(s);
      if (statusFilter === "completed") return s === "in_completed" || s === "in_delivered";
      if (statusFilter === "cancelled") return s === "cancelled";
      return true;
    });
  }, [detail, statusFilter]);

  const ordersTotalPages = Math.max(1, Math.ceil(recentOrders.length / ORDERS_PAGE_SIZE));
  const safeOrdersPage = Math.min(ordersPage, ordersTotalPages);
  const paginatedOrders = recentOrders.slice(
    (safeOrdersPage - 1) * ORDERS_PAGE_SIZE,
    safeOrdersPage * ORDERS_PAGE_SIZE
  );

  useEffect(() => {
    setOrdersPage(1);
  }, [statusFilter, clientId]);

  if (loading) {
    return (
      <section className="pq-section pq-credit-layout">
        <div className="pa-credit-detail-banner">
          <div className="pq-clients-loading">Cargando cliente...</div>
        </div>
      </section>
    );
  }

  if (!client) {
    return (
      <section className="pq-section pq-credit-layout">
        <div className="pa-credit-detail-banner">
          <div className="pq-clients-loading">Cliente no encontrado.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="pq-section pq-credit-layout">
      {/* Banner del cliente */}
      <div className="pa-credit-detail-banner">
        <div className="pa-credit-detail-banner-top">
          <div className="pa-credit-detail-client-avatar">
            {client.name?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div className="pa-credit-detail-banner-info">
            <h3>{client.name}</h3>
            <span className="pq-clients-detail-contact">
              <Icons.Phone /> {formatDominicanPhone(client.phone)}
              {client.email && <><span className="pq-clients-detail-sep">·</span><Icons.Mail /> {client.email}</>}
            </span>
          </div>
          <div className="pa-credit-detail-client-stats">
            <span className="pq-greeting-count pq-greeting-count--pending">
              <strong>{stats?.total_orders || 0}</strong> Ordenes
            </span>
            <span className="pq-greeting-count">
              <strong>{formatCurrency(stats?.total_spent || 0)}</strong> Facturado
            </span>
            <span className={`pq-greeting-count ${stats?.pending_credit ? "pq-greeting-count--pending" : "pq-greeting-count--paid-today"}`}>
              <strong>{stats?.pending_credit ? "Si" : "No"}</strong> Credito
            </span>
          </div>
        </div>
        <div className="pa-credit-detail-banner-bottom">
          <button className="pa-credit-detail-back" onClick={onBack}>
            <Icons.ChevronLeft />
            Volver a clientes
          </button>
        </div>
      </div>

      {/* Panel de historial de ordenes */}
      <div className="pq-panel pq-credit-panel">
        <div className="pq-panel-head">
          <div>
            <span className="acm-badge info">Historial</span>
            <h2>Ordenes del cliente</h2>
          </div>
        </div>

        <div className="ps-filters pq-clients-detail-filters">
          <div className="ps-select-wrap">
            <select
              className="ps-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ minWidth: 150, paddingRight: 32, cursor: "pointer", appearance: "none" }}
            >
              <option value="all">Todos</option>
              <option value="active">Activas</option>
              <option value="completed">Completadas</option>
              <option value="cancelled">Canceladas</option>
            </select>
            <span className="ps-select-arrow"><Icons.ChevronDown /></span>
          </div>
          <span className="ps-filters-count">
            {recentOrders.length} orden{recentOrders.length !== 1 ? "es" : ""}
          </span>
        </div>

        <div className="ps-table-wrap pa-credit-invoice-wrap">
          <table className="ps-table acm-table">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Descripcion</th>
                <th>Estado</th>
                <th>Pago</th>
                <th>Fecha</th>
                <th>Total</th>
                <th className="pq-clients-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="ps-table-empty">
                    <div className="acm-empty-state">
                      <Icons.Orders />
                      <strong>No hay ordenes</strong>
                      <span>Este cliente no tiene ordenes registradas.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((order) => {
                  const statusCfg = getStatusConfig(order.status);
                  const paymentCfg = getPaymentConfig(order.payment_status);
                  return (
                    <tr
                      key={order.id}
                      className="row-hover acm-client-row"
                      onClick={() => onViewOrder && onViewOrder({ id: order.id })}
                      tabIndex={0}
                    >
                      <td className="td-pad">{order.invoice_number || "---"}</td>
                      <td className="td-pad pq-clients-desc-cell">{order.description || "---"}</td>
                      <td className="td-pad">
                        <span className={`acm-badge ${statusCfg.cls}`}>{statusCfg.label}</span>
                      </td>
                      <td className="td-pad">
                        <span className={`acm-badge ${paymentCfg.cls}`}>{paymentCfg.label}</span>
                      </td>
                      <td className="td-pad">{formatDate(order.created_at)}</td>
                      <td className="td-pad pq-clients-amount">{formatCurrency(order.price)}</td>
                      <td className="td-pad td-actions">
                        <div className="table-actions acm-row-actions">
                          <button
                            className="table-action-btn view"
                            onClick={(e) => { e.stopPropagation(); onViewOrder && onViewOrder({ id: order.id }); }}
                            title="Ver orden"
                          >
                            <Icons.Eye />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {recentOrders.length > ORDERS_PAGE_SIZE && (
          <div className="pq-clients-pagination">
            <button
              className="pq-clients-page-btn"
              disabled={safeOrdersPage <= 1}
              onClick={() => setOrdersPage(p => Math.max(1, p - 1))}
            >
              <Icons.ChevronLeft />
            </button>
            <span className="pq-clients-page-info">
              Pagina {safeOrdersPage} de {ordersTotalPages}
            </span>
            <button
              className="pq-clients-page-btn"
              disabled={safeOrdersPage >= ordersTotalPages}
              onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))}
            >
              <Icons.ChevronRight />
            </button>
          </div>
        )}
      </div>

      {/* Panel de informacion personal */}
      <div className="pq-panel pq-credit-panel">
        <div className="pq-panel-head">
          <div>
            <span className="acm-badge info">Datos</span>
            <h2>Informacion personal</h2>
          </div>
        </div>
        <div className="pq-clients-info-grid">
          <div className="pq-clients-info-item">
            <span className="pq-clients-info-label"><Icons.User /> Nombre</span>
            <span className="pq-clients-info-value">{client.name}</span>
          </div>
          <div className="pq-clients-info-item">
            <span className="pq-clients-info-label"><Icons.Phone /> Telefono</span>
            <span className="pq-clients-info-value">{formatDominicanPhone(client.phone)}</span>
          </div>
          {client.email && (
            <div className="pq-clients-info-item">
              <span className="pq-clients-info-label"><Icons.Mail /> Email</span>
              <span className="pq-clients-info-value">{client.email}</span>
            </div>
          )}
          {client.address && (
            <div className="pq-clients-info-item">
              <span className="pq-clients-info-label"><Icons.Clipboard /> Direccion</span>
              <span className="pq-clients-info-value">{client.address}</span>
            </div>
          )}
          {client.notes && (
            <div className="pq-clients-info-item pq-clients-info-full">
              <span className="pq-clients-info-label"><Icons.FileText /> Notas</span>
              <span className="pq-clients-info-value">{client.notes}</span>
            </div>
          )}
          <div className="pq-clients-info-item">
            <span className="pq-clients-info-label"><Icons.Calendar /> Registro</span>
            <span className="pq-clients-info-value">{formatDate(client.created_at)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
