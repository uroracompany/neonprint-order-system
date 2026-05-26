import { useCallback, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-delivery.css";
import "../css-components/page-seller.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import useNotifications from "../hooks/useNotifications";
import { Icons } from "../utils/icons";
import { ORDER_STATUS, DELIVERY_STATUS_OPTIONS, isOrderStatus } from "../utils/constants";
import { StatusBadge, PaymentBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";

const CARD_ACCENTS = [
  { color: "#0284C7", bg: "#E0F2FE", glow: "radial-gradient(circle, rgba(2,132,199,0.25) 0%, transparent 70%)" },
  { color: "#059669", bg: "#ECFDF5", glow: "radial-gradient(circle, rgba(5,150,105,0.25) 0%, transparent 70%)" },
  { color: "#8B5CF6", bg: "#F3E8FF", glow: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)" },
];

function OrderDetailModal({ onClose, order, onUpdateStatus }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  const handleUpdateStatus = async (newStatus) => {
    // Validar que no esté archivada
    if (order.is_archived_delivery) {
      console.warn("No se pueden cambiar estados de órdenes archivadas");
      return;
    }
    
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

  return (
    <div className="pd-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pd-modal">
        <div className="pd-modal-stripe" />
        <div className="pd-modal-header">
          <div className="pd-modal-title">
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pd-modal-subtitle">Detalles de entrega</span>
          </div>
          <button className="pd-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>

        <div className="pd-modal-body">
          {updateSuccess && (
            <div className="pd-alert pd-alert-success">
              <Icons.Check />
              Orden marcada como entregada
            </div>
          )}

          {order.is_archived_delivery && (
            <div className="pd-alert pd-alert-warning" style={{ background: "#FEF3C7", color: "#92400E", borderColor: "#F59E0B" }}>
              <span>⚠️ Esta orden está archivada. No se pueden cambiar sus estados.</span>
            </div>
          )}

          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.User />
              <h4>Información del Cliente</h4>
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item">
                <span className="pd-modal-label">Cliente</span>
                <span className="pd-modal-value">{order.client_name || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Vendedor</span>
                <span className="pd-modal-value">{order.seller_name || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Tipo de Orden</span>
                <span className="pd-modal-value">
                  {order.order_type === "orden 911" ? (
                    <span className="pd-badge-911">911 - Urgente</span>
                  ) : (
                    <span className="pd-badge-normal">Normal</span>
                  )}
                </span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Fecha de Creación</span>
                <span className="pd-modal-value">{created}</span>
              </div>
            </div>
          </div>

          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icons.Package />
              <h4>Detalles del Trabajo</h4>
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item full">
                <span className="pd-modal-label">Descrição</span>
                <p className="pd-modal-description">{order.description || "Sin descrição"}</p>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Material</span>
                <span className="pd-modal-value">{order.material || "No especificado"}</span>
              </div>
              {order.width && order.height && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Dimensiones</span>
                  <span className="pd-modal-value">{order.width} x {order.height} cm</span>
                </div>
              )}
              {order.quantity && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Cantidad</span>
                  <span className="pd-modal-value">{order.quantity} unidades</span>
                </div>
              )}
            </div>
          </div>

          <div className="pd-status-bar">
            <div className="pd-status-item">
              <span className="pd-status-label">Estado</span>
              <StatusBadge status={order.status} className="pd-badge" showDot={false} />
            </div>
            <div className="pd-status-item">
              <span className="pd-status-label">Pago</span>
              <PaymentBadge status={order.payment_status} className="pd-badge" />
            </div>
          </div>
        </div>

        <div className="pd-modal-footer">
          <button className="pd-btn pd-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          
          {isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED) && (
            <button 
              className="pd-btn pd-btn-primary"
              onClick={() => handleUpdateStatus(ORDER_STATUS.IN_DELIVERED)}
              disabled={updating || order.is_archived_delivery}
              title={order.is_archived_delivery ? "No se pueden cambiar estados de órdenes archivadas" : ""}
            >
              {updating ? (
                <>
                  <span className="pd-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Check />
                  Marcar entregado
                </>
              )}
            </button>
          )}

          {isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED) && (
            <button
              className="pd-btn pd-btn-primary"
              onClick={() => handleUpdateStatus(ORDER_STATUS.IN_COMPLETED)}
              disabled={updating || order.is_archived_delivery}
              title={order.is_archived_delivery ? "No se pueden cambiar estados de órdenes archivadas" : ""}
            >
              {updating ? (
                <>
                  <span className="pd-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icons.Check />
                  Devolver a Completada
                </>
              )}
            </button>
          )}


        </div>
      </div>
    </div>
  );
}

export default function PageDelivery() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [archivedingOrder, setArchivedingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const notif = useNotifications(user?.id);
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  const refreshOrders = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", DELIVERY_STATUS_OPTIONS)
      .eq("delivery_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    setLoading(false);
  }, [user?.id]);

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

    refreshOrders();
  }, [user?.id, refreshOrders]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`delivery-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => refreshOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshOrders]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = !search || 
      order.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    
    const matchesArchive = 
      (filterArchive === "active" && !order.is_archived_delivery) ||
      (filterArchive === "archived" && order.is_archived_delivery);
    
    return matchesSearch && matchesStatus && matchesArchive;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const metrics = [
    { icon: <Icons.Truck />, label: "Para entregar", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_TERMINATION)).length },
    { icon: <Icons.Check />, label: "Entregado", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)).length },
    { icon: <Icons.Package />, label: "Completadas", value: orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_COMPLETED)).length },
  ];

  const handleQuickMarkDelivered = async (e, orderId) => {
    e.stopPropagation();
    setUpdatingOrderId(orderId);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: ORDER_STATUS.IN_DELIVERED })
        .eq("id", orderId);
      
      if (error) throw error;
      
      if (!user?.id) return;
      const { data, error: fetchError } = await supabase
        .from("orders")
        .select("*")
        .in("status", DELIVERY_STATUS_OPTIONS)
        .eq("delivery_id", user.id)
        .order("created_at", { ascending: false });

      if (!fetchError && data) {
        setOrders(data);
      }
    } catch (err) {
      console.error("Error marking order as delivered:", err);
    }
    setUpdatingOrderId(null);
  };

  const handleArchiveOrder = (order) => {
    // Solo permitir archivar si está entregado
    if (!isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED)) {
      console.warn("Solo se pueden archivar órdenes entregadas");
      return;
    }
    setArchivedingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivedingOrder) return;

    setArchiveLoading(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ is_archived_delivery: true })
        .eq("id", archivedingOrder.id);

      if (error) throw error;

      setArchivedingOrder(null);
      refreshOrders();
    } catch (err) {
      console.error("Error archiving order:", err);
    }
    setArchiveLoading(false);
  };

  const handleUnarchiveOrder = async (orderId) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ is_archived_delivery: false })
        .eq("id", orderId);

      if (error) throw error;

      refreshOrders();
    } catch (err) {
      console.error("Error unarchiving order:", err);
    }
  };

  return (
    <div className="pd-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Entrega"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
          { id: "orders", label: "Órdenes", icon: <Icons.Orders /> }
        ]}
        onLogout={handleLogout}
      />

      <main className="pd-main">
        <header className="pd-header">
          <div className="pd-header-left">
            <button className="pd-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Icons.Menu />
            </button>
            <div className="pd-header-title">
              <h2>{activeTab === "dashboard" ? "Dashboard" : "Órdenes"}</h2>
            </div>
          </div>
          <div className="pd-header-right">
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
            <button className="pd-refresh-btn" onClick={refreshOrders}>
              <Icons.Refresh />
            </button>
          </div>
        </header>

        <div className="pd-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pd-greeting">
                <h2>Bienvenido, <span>{user?.displayName || "Entrega"}</span></h2>
                <p>Gestiona la entrega de órdenes procesadas.</p>
              </div>

              <div className="pd-metrics">
                {metrics.map((m, i) => {
                  const acc = CARD_ACCENTS[i % CARD_ACCENTS.length];
                  return (
                    <div key={i} className="pd-metric-card"
                      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
                      onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
                      <div className="pd-metric-glow" style={{ background: acc.glow }} />
                      <div className="pd-metric-icon" style={{ background: acc.bg, color: acc.color }}>
                        {m.icon}
                      </div>
                      <div className="pd-metric-info">
                        <span className="pd-metric-value">{m.value}</span>
                        <span className="pd-metric-label">{m.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pd-recent-section">
                <div className="pd-panel-stripe" />
                <h3>Órdenes para Entrega</h3>
                {loading ? (
                  <div className="pd-loading">Cargando...</div>
                ) : orders.length === 0 ? (
                  <div className="pd-empty">No hay órdenes</div>
                ) : (
                  <div className="pd-orders-list">
                    {orders.slice(0, 5).map(order => (
                      <div key={order.id} className="pd-order-item" onClick={() => setSelectedOrder(order)}>
                        <div className="pd-order-left">
                          <span className="pd-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <span className="pd-order-client">{order.client_name}</span>
                        </div>
                        <div className="pd-order-center">
                          <span className="pd-order-desc">{order.description?.substring(0, 50)}...</span>
                        </div>
                        <div className="pd-order-right">
                          <StatusBadge status={order.status} className="pd-badge" showDot={false} />
                          {isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED) && (
                            <button 
                              className="pd-action-btn check"
                              onClick={(e) => handleQuickMarkDelivered(e, order.id)}
                              disabled={updatingOrderId === order.id}
                              title="Marcar como entregado"
                            >
                              {updatingOrderId === order.id ? (
                                <span className="pd-btn-spinner"></span>
                              ) : (
                                <Icons.Check />
                              )}
                            </button>
                          )}
                          {isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED) && (
                            <button 
                              className="pd-action-btn check completed"
                              disabled
                              title="Entregado"
                            >
                              <Icons.Check />
                            </button>
                          )}
                          <button className="pd-view-btn"><Icons.Eye /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "orders" && (
            <>
              <div className="pd-filters">
                <div className="pd-search-wrap">
                  <span className="pd-search-icon"><Icons.Search /></span>
                  <input 
                    className="pd-input" 
                    placeholder="Buscar..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">Todos</option>
                    <option value={ORDER_STATUS.IN_TERMINATION}>Terminación</option>
                    <option value={ORDER_STATUS.IN_DELIVERED}>Entregado</option>
                    <option value={ORDER_STATUS.IN_COMPLETED}>Completadas</option>
                  </select>
                  <span className="pd-select-arrow"><Icons.ChevronDown /></span>
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                    <option value="active">Activas</option>
                    <option value="archived">Archivadas</option>
                  </select>
                  <span className="pd-select-arrow"><Icons.ChevronDown /></span>
                </div>
                <span className="pd-filters-count">{filteredOrders.length}</span>
              </div>

              {loading ? (
                <div className="pd-loading">Cargando...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="pd-empty">No hay órdenes</div>
              ) : (
                <div className="pd-orders-table-wrap">
                  <table className="pd-orders-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Descripción</th>
                        <th>Material</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedOrders.map(order => (
                        <tr key={order.id} className="row-hover" onClick={() => setSelectedOrder(order)}>
                          <td className="td-pad td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                          <td className="td-pad td-name">{order.client_name}</td>
                          <td className="td-pad td-desc">{order.description?.substring(0, 40)}</td>
                          <td className="td-pad td-mat">{order.material}</td>
                          <td className="td-pad"><StatusBadge status={order.status} className="pd-badge" showDot={false} /></td>
                          <td className="td-actions">
                            <div className="table-actions">
                              {!order.is_archived_delivery && isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED) && (
                                <button className="table-action-btn archive" onClick={e => { e.stopPropagation(); handleArchiveOrder(order); }} title="Archivar">
                                  <Icons.Archive />
                                </button>
                              )}
                              {order.is_archived_delivery && (
                                <button className="table-action-btn archive" disabled onClick={e => e.stopPropagation()} title="Archivada">
                                  <Icons.Archived />
                                </button>
                              )}
                              <button className="table-action-btn view" onClick={e => { e.stopPropagation(); setSelectedOrder(order); }} title="Ver detalles">
                                <Icons.Eye />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </main>

      {archivedingOrder && (
        <div className="pd-modal-overlay" onClick={() => setArchivedingOrder(null)}>
          <div className="pd-modal" onClick={e => e.stopPropagation()}>
            <div className="pd-modal-stripe" />
            <div className="pd-modal-header">
              <h3>Confirmar archivado</h3>
              <button className="pd-modal-close" onClick={() => setArchivedingOrder(null)}>
                <Icons.Close />
              </button>
            </div>
            <div className="pd-modal-body">
              <p>¿Deseas archivar la orden <strong>#{archivedingOrder.id?.slice(0, 8).toUpperCase()}</strong>?</p>
              <p style={{ color: "var(--pd-text-muted)", fontSize: "12px", marginTop: "8px" }}>
                Las órdenes archivadas no se mostrarán en la vista principal y no podrán cambiar de estado.
              </p>
            </div>
            <div className="pd-modal-footer">
              <button className="pd-btn pd-btn-secondary" onClick={() => setArchivedingOrder(null)}>
                Cancelar
              </button>
              <button 
                className="pd-btn pd-btn-primary" 
                onClick={handleConfirmArchiveOrder}
                disabled={archiveLoading}
              >
                {archiveLoading ? (
                  <>
                    <span className="pd-btn-spinner"></span>
                    Archivando...
                  </>
                ) : (
                  <>
                    <Icons.Archive />
                    Archivar orden
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        order={selectedOrder}
        onUpdateStatus={refreshOrders}
        onUnarchive={handleUnarchiveOrder}
      />
    </div>
  );
}
