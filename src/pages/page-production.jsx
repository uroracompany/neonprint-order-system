import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-production.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import useNotifications from "../hooks/useNotifications";
import { Icons } from "../utils/icons";
import { FlowTracker } from "../components/FlowTracker";
import { StatusBadge, PaymentBadge } from "../components/ui/Badge";
import { AssignModal } from "../components/ui/AssignModal";
import { Pagination } from "../components/ui/Pagination";
import {
  ORDER_STATUS,
  PAYMENT_COLORS,
  PRODUCTION_TRACKING_STATUS_OPTIONS,
  getOrderStatusConfig,
  isOrderStatus,
  isOrderStatusIn,
  getFileNameFromUrl,
  formatDate,
} from "../utils/constants";

const METRIC_ACCENTS = [
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#0284C7", bg: "#E0F2FE", glow: "#E0F2FE" },
  { color: "#059669", bg: "#ECFDF5", glow: "#ECFDF5" },
  { color: "#14532D", bg: "#DCFCE7", glow: "#DCFCE7" },
];

function MetricCard({ icon, label, value, accentIdx = 0 }) {
  const acc = METRIC_ACCENTS[accentIdx];
  return (
    <div
      className="pp-metric-card"
      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = ""}
    >
      <div className="pp-metric-glow" style={{ background: acc.glow }} />
      <div className="pp-metric-icon" style={{ background: acc.bg, color: acc.color }}>
        {icon}
      </div>
      <div className="pp-metric-info">
        <span className="pp-metric-value">{value}</span>
        <span className="pp-metric-label">{label}</span>
      </div>
    </div>
  );
}

function OrderDetailModal({ open, onClose, order, onUpdateStatus, onCompleteOrder }) {
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [orderFiles, setOrderFiles] = useState([]);
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  useEffect(() => {
    if (order?.id) {
      fetchOrderFiles();
    }
  }, [order?.id]);

  const fetchOrderFiles = async () => {
    setLoadingFiles(true);
    try {
      const { data, error } = await supabase.storage
        .from("order-docs")
        .list(`orders/${order.id}/files/`);

      if (!error && data) {
        const files = data.map(f => ({
          name: f.name,
          url: supabase.storage.from("order-docs").getPublicUrl(`orders/${order.id}/files/${f.name}`).data.publicUrl
        }));
        setOrderFiles(files);
      }
    } catch (err) {
      console.error("Error fetching files:", err);
    }
    setLoadingFiles(false);
  };

  const handleUpdateStatus = async (newStatus) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", order.id);

      if (error) throw error;

      setUpdateSuccess(true);
      setTimeout(() => {
        setUpdateSuccess(false);
        onUpdateStatus?.();
        onClose();
      }, 1500);
    } catch (err) {
      console.error("Error updating status:", err);
    }
    setUpdating(false);
  };

  if (!order) return null;

  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const statusCfg = getOrderStatusConfig(order.status);

  const getDbFiles = () => {
    if (!order.order_file_url) return [];
    try {
      const urls = JSON.parse(order.order_file_url);
      return Array.isArray(urls) ? urls : [urls];
    } catch {
      return order.order_file_url ? [order.order_file_url] : [];
    }
  };

  const allFiles = [
    ...orderFiles.map(f => ({ name: f.name, url: f.url })),
    ...getDbFiles().map((url, i) => ({ name: getFileNameFromUrl(url), url }))
  ];

  const isInProduction = isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION);
  const isInTermination = isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION);

  return (
    <div className="pp-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <div className="pp-modal-stripe" />
        <div className="pp-modal-header">
          <div>
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pp-modal-subtitle">Detalles para producción</span>
          </div>
          <button className="pp-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>

        <div className="pp-modal-body">
          {updateSuccess && (
            <div className="pp-modal-alert pp-alert-success">
              <Icons.Check />
              Estado actualizado correctamente
            </div>
          )}

          <div className="pp-modal-grid">
            <div>
              <div className="pp-modal-card">
                <div className="pp-modal-card-title">
                  <Icons.User />
                  <h4>Información del Cliente</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.User /></span>
                    <div>
                      <p className="pp-modal-row-label">Cliente</p>
                      <p className="pp-modal-row-value">{order.client_name || "No especificado"}</p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Users /></span>
                    <div>
                      <p className="pp-modal-row-label">Vendedor</p>
                      <p className="pp-modal-row-value">{order.seller_name || "No especificado"}</p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Package /></span>
                    <div>
                      <p className="pp-modal-row-label">Tipo de Orden</p>
                      <p className="pp-modal-row-value">
                        {order.order_type === "orden 911" ? (
                          <span className="pp-badge-911">911 - Urgente</span>
                        ) : (
                          <span className="pp-badge-normal">Normal</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Clock /></span>
                    <div>
                      <p className="pp-modal-row-label">Fecha de Creación</p>
                      <p className="pp-modal-row-value">{created}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pp-modal-card" style={{ marginTop: 16 }}>
                <div className="pp-modal-card-title">
                  <Icons.FileText />
                  <h4>Detalles del Trabajo</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div>
                    <p className="pp-modal-row-label">Descripción</p>
                    <p className="pp-modal-description">{order.description || "Sin descripción"}</p>
                  </div>
                  <div className="pp-modal-row" style={{ marginTop: 10 }}>
                    <span className="pp-modal-row-icon"><Icons.Package /></span>
                    <div>
                      <p className="pp-modal-row-label">Material</p>
                      <p className="pp-modal-row-value">{order.material || "No especificado"}</p>
                    </div>
                  </div>
                  {order.width && order.height && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Clipboard /></span>
                      <div>
                        <p className="pp-modal-row-label">Dimensiones</p>
                        <p className="pp-modal-row-value">{order.width} x {order.height} cm</p>
                      </div>
                    </div>
                  )}
                  {order.quantity && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Clipboard /></span>
                      <div>
                        <p className="pp-modal-row-label">Cantidad</p>
                        <p className="pp-modal-row-value">{order.quantity} unidades</p>
                      </div>
                    </div>
                  )}
                  {order.termination_type && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Check /></span>
                      <div>
                        <p className="pp-modal-row-label">Terminación</p>
                        <p className="pp-modal-row-value">{order.termination_type}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="pp-modal-status-card">
                <div className="pp-modal-status-glow" style={{ background: statusCfg?.bg || "transparent" }} />
                <p className="pp-modal-status-title">Estado & Pago</p>
                <div className="pp-modal-status-grid">
                  <div className="pp-modal-status-section">
                    <span className="pp-modal-status-label">Estado Actual</span>
                    <StatusBadge status={order.status} className="pp-badge" bordered />
                  </div>
                  <div className="pp-modal-status-section">
                    <span className="pp-modal-status-label">Estado de Pago</span>
                    <PaymentBadge status={order.payment_status} className="pp-badge" bordered />
                  </div>
                  {order.price && (
                    <div className="pp-price-box">
                      <p className="pp-price-box-label">PRECIO</p>
                      <p className="pp-price-box-value">RD$ {Number(order.price).toLocaleString("es-DO")}</p>
                    </div>
                  )}
                </div>
                <div className="pp-flowtracker-wrap">
                  <FlowTracker currentStatus={order.status} />
                </div>
              </div>

              <div className="pp-modal-card" style={{ marginTop: 16 }}>
                <div className="pp-modal-card-title">
                  <Icons.Key />
                  <h4>Información del Sistema</h4>
                </div>
                <div className="pp-modal-card-body">
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Key /></span>
                    <div>
                      <p className="pp-modal-row-label">ID Orden</p>
                      <p className="pp-modal-row-value">{order.id?.slice(0, 8) || "---"}</p>
                    </div>
                    <span className="pp-modal-row-value-right" style={{ fontFamily: "monospace", fontSize: 11, color: "var(--pp-text-muted)" }}>
                      {order.id?.slice(8, 13) || ""}
                    </span>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Clock /></span>
                    <div>
                      <p className="pp-modal-row-label">Creada</p>
                      <p className="pp-modal-row-value">{formatDate(order.created_at)}</p>
                    </div>
                  </div>
                  {order.updated_at && (
                    <div className="pp-modal-row">
                      <span className="pp-modal-row-icon"><Icons.Refresh /></span>
                      <div>
                        <p className="pp-modal-row-label">Actualizada</p>
                        <p className="pp-modal-row-value">{formatDate(order.updated_at)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="pp-files-section" style={{ marginTop: 18 }}>
            <div className="pp-files-title">
              <Icons.File />
              Archivos para Impresión
            </div>
            {loadingFiles ? (
              <div className="pp-loading-files">Cargando archivos...</div>
            ) : allFiles.length > 0 ? (
              <div className="pp-files-grid">
                {allFiles.map((file, i) => (
                  <div key={i} className="pp-file-item">
                    <div className="pp-file-icon">
                      <Icons.File />
                    </div>
                    <div className="pp-file-info">
                      <span className="pp-file-name">{file.name}</span>
                    </div>
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="pp-file-download" title="Descargar">
                      <Icons.Download />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pp-no-files">No hay archivos disponibles</div>
            )}
          </div>
        </div>

        <div className="pp-modal-footer">
          <button className="pp-btn pp-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          {isInProduction && (
            <button
              className="pp-btn pp-btn-primary"
              onClick={() => handleUpdateStatus(ORDER_STATUS.IN_TERMINATION)}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Play />
                  Marcar en terminación
                </>
              )}
            </button>
          )}
          {isInTermination && (
            // Solo mostrar botón de completado si ya está en terminación
            <button
              className="pp-btn pp-btn-success"
              onClick={() => onCompleteOrder?.(order)}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Check />
                  Marcar como completado
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PageProduction() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;
  const [viewMode, setViewMode] = useState("table");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [assignDeliveryOrder, setAssignDeliveryOrder] = useState(null);
  const [assignDeliverySaving, setAssignDeliverySaving] = useState(false);

  const handleConfirmAssignDelivery = async (deliveryUserId) => {
    if (!assignDeliveryOrder) return;
    setAssignDeliverySaving(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: ORDER_STATUS.IN_COMPLETED, delivery_id: deliveryUserId })
        .eq("id", assignDeliveryOrder.id);
      if (error) throw error;
      setAssignDeliveryOrder(null);
      await refreshOrders();
    } catch (err) {
      console.error("Error assigning delivery:", err);
    }
    setAssignDeliverySaving(false);
  };
  const notif = useNotifications(user?.id);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/");
        return;
      }
      setUser(user);
    };
    getUser();
  }, [navigate]);

  useEffect(() => {
    if (!user?.id) return;
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("production_id", user.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setOrders(data.filter(order => isOrderStatusIn(order.status, PRODUCTION_TRACKING_STATUS_OPTIONS)));
      }
      setLoading(false);
    };

    fetchOrders();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`production-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => refreshOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const filteredOrders = orders.filter(order => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      order.client_name?.toLowerCase().includes(q) ||
      order.id?.toLowerCase().includes(q) ||
      order.description?.toLowerCase().includes(q);

    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesPayment = filterPayment === "all" || order.payment_status === filterPayment;

    return matchesSearch && matchesStatus && matchesPayment;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const metrics = [
    { icon: <Icons.Package />, label: "Producción", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length, accentIdx: 0 },
    { icon: <Icons.Package />, label: "Terminación", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_TERMINATION)).length, accentIdx: 1 },
    { icon: <Icons.Truck />, label: "Entregadas", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)).length, accentIdx: 2 },
    { icon: <Icons.Check />, label: "Completadas", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_COMPLETED)).length, accentIdx: 3 },
  ];

  const refreshOrders = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("production_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data.filter(order => isOrderStatusIn(order.status, PRODUCTION_TRACKING_STATUS_OPTIONS)));
    }
    setLoading(false);
  };

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
  };

  const canAdvance = (order) => {
    return isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION) ||
           isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION);
  };

  const getAdvanceIcon = (order) => {
    if (isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)) return <Icons.Play />;
    if (isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)) return <Icons.Check />;
    return null;
  };

  const getAdvanceLabel = (order) => {
    if (isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)) return "Terminación";
    if (isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)) return "Completado";
    return "";
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="pp-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Producción"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
          { id: "orders", label: "Órdenes", icon: <Icons.Orders /> }
        ]}
        onLogout={handleLogout}
      />

      <main className="pp-main">
        <header className="pp-header">
          <button className="pp-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
          </button>
          <div className="pp-header-title">
            <h2>{activeTab === "dashboard" ? "Dashboard" : "Órdenes de Producción"}</h2>
          </div>
          <span className="pp-header-date">{dateStr}</span>
          <NotificationCenter
            notifications={notif.notifications}
            unreadCount={notif.unreadCount}
            toasts={notif.toasts}
            onMarkAsRead={notif.markAsRead}
            onMarkAllAsRead={notif.markAllAsRead}
            onArchive={notif.archive}
            onDelete={notif.deleteNotification}
            onDismissToast={notif.dismissToast}
          />
          <button className="pp-refresh-btn" onClick={refreshOrders} title="Actualizar">
            <Icons.Refresh />
          </button>
        </header>

        <div className="pp-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pp-greeting">
                <h2>Buen día, <span>{user?.displayName || "Operador"}</span> 👋</h2>
                <p>Aquí tienes el resumen de las órdenes en producción.</p>
              </div>

              <div className="pp-metrics">
                {metrics.map((m, i) => (
                  <MetricCard key={i} {...m} />
                ))}
              </div>

              <div className="pp-panel">
                <div className="pp-panel-stripe" />
                <div className="pp-panel-header">
                  <div>
                    <div className="pp-panel-title">Órdenes Recientes</div>
                    <div className="pp-panel-sub">Las últimas 5 órdenes en el flujo de producción</div>
                  </div>
                  <button className="pp-link-btn" onClick={() => setActiveTab("orders")}>
                    Ver todas <Icons.ArrowRight />
                  </button>
                </div>
                <div className="pp-table-wrap">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Descripción</th>
                        <th>Material</th>
                        <th>Estado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="pp-table-empty">Cargando órdenes...</td>
                        </tr>
                      ) : orders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="pp-table-empty">No hay órdenes para producción</td>
                        </tr>
                      ) : (
                        orders.slice(0, 5).map(order => (
                          <tr key={order.id} className="row-hover" onClick={() => handleViewOrder(order)}>
                            <td className="td-pad td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                            <td className="td-pad td-client">{order.client_name}</td>
                            <td className="td-pad td-desc">{order.description}</td>
                            <td className="td-pad td-material">{order.material}</td>
                            <td className="td-pad"><StatusBadge status={order.status} className="pp-badge" bordered /></td>
                            <td className="td-pad td-actions">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={e => { e.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === "orders" && (
            <>
              <div className="pp-filters">
                <div className="pp-search-wrap">
                  <span className="pp-search-icon"><Icons.Search /></span>
                  <input
                    className="pp-input with-icon"
                    placeholder="Buscar por cliente, descripción o ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="all">Todos los estados</option>
                      <option value={ORDER_STATUS.IN_PRODUCTION}>Producción</option>
                      <option value={ORDER_STATUS.IN_TERMINATION}>Terminación</option>
                      <option value={ORDER_STATUS.IN_DELIVERED}>Entregadas</option>
                      <option value={ORDER_STATUS.IN_COMPLETED}>Completadas</option>
                    </select>
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                      <option value="all">Pago: Todos</option>
                      {Object.entries(PAYMENT_COLORS).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setViewMode("table")}
                      className={`pp-view-toggle ${viewMode === "table" ? "active" : ""}`}
                      title="Vista de tabla"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </button>
                    <button
                      onClick={() => setViewMode("cards")}
                      className={`pp-view-toggle ${viewMode === "cards" ? "active" : ""}`}
                      title="Vista de tarjetas"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    </button>
                  </div>
                </div>
                <span className="pp-filters-count">{filteredOrders.length} resultado{filteredOrders.length !== 1 ? "s" : ""}</span>
              </div>

              {loading ? (
                <div className="pp-loading">Cargando órdenes...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="pp-loading">No hay órdenes que coincidan</div>
              ) : viewMode === "table" ? (
                <div className="pp-panel">
                  <div className="pp-panel-stripe" />
                  <div className="pp-table-wrap">
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Cliente</th>
                          <th>Descripción</th>
                          <th>Material</th>
                          <th>Cant.</th>
                          <th>Estado</th>
                          <th>Pago</th>
                          <th>Tipo</th>
                          <th>Fecha</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map(order => (
                          <tr key={order.id} className="row-hover">
                            <td className="td-pad td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                            <td className="td-pad td-client">{order.client_name}</td>
                            <td className="td-pad td-desc">{order.description?.substring(0, 40)}</td>
                            <td className="td-pad td-material">{order.material}</td>
                            <td className="td-pad td-qty">{order.quantity || "-"}</td>
                            <td className="td-pad"><StatusBadge status={order.status} className="pp-badge" bordered /></td>
                            <td className="td-pad"><PaymentBadge status={order.payment_status} className="pp-badge" bordered /></td>
                            <td className="td-pad">
                              {order.order_type === "orden 911" ? (
                                <span className="pp-badge-911">911</span>
                              ) : (
                                <span className="pp-badge-normal">Normal</span>
                              )}
                            </td>
                            <td className="td-pad td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="td-pad td-actions">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={() => handleViewOrder(order)} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                                {canAdvance(order) && (
                                  <button
                                    className={`table-action-btn play ${isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION) ? "completed" : ""}`}
                                    onClick={() => handleViewOrder(order)}
                                    title={`Avanzar a ${getAdvanceLabel(order)}`}
                                  >
                                    {getAdvanceIcon(order)}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="pp-panel">
                  <div className="pp-panel-stripe" />
                  <div className="pp-cards-grid">
                    {paginatedOrders.map(order => (
                      <div key={order.id} className="pp-order-card" onClick={() => handleViewOrder(order)}>
                        <div className="pp-order-card-header">
                          <span className="pp-order-card-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <div className="pp-order-card-badges">
                            <StatusBadge status={order.status} className="pp-badge" bordered />
                          </div>
                        </div>
                        <div className="pp-order-card-client">{order.client_name}</div>
                        <div className="pp-order-card-desc">{order.description || "Sin descripción"}</div>
                        <div className="pp-order-card-meta">
                          <span className="pp-order-card-material">{order.material}</span>
                          <PaymentBadge status={order.payment_status} className="pp-badge" bordered />
                        </div>
                        <div className="pp-order-card-footer">
                          <span className="pp-order-card-date">
                            {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                          <div className="pp-order-card-actions">
                            <button className="table-action-btn view" onClick={e => { e.stopPropagation(); handleViewOrder(order); }} title="Ver detalles">
                              <Icons.Eye />
                            </button>
                            {canAdvance(order) && (
                              <button
                                className={`table-action-btn play ${isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION) ? "completed" : ""}`}
                                onClick={e => { e.stopPropagation(); handleViewOrder(order); }}
                                title={`Avanzar a ${getAdvanceLabel(order)}`}
                              >
                                {getAdvanceIcon(order)}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </main>

      <OrderDetailModal
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        onUpdateStatus={refreshOrders}
        onCompleteOrder={(order) => { setSelectedOrder(null); setAssignDeliveryOrder(order); }}
      />
      <AssignModal
        open={!!assignDeliveryOrder}
        onClose={() => setAssignDeliveryOrder(null)}
        order={assignDeliveryOrder}
        role="delivery"
        onConfirm={handleConfirmAssignDelivery}
        loading={assignDeliverySaving}
      />
    </div>
  );
}


