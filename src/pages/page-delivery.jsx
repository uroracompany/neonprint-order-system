// DELIVERY PAGE - ORDER DASHBOARD FOR DELIVERY MANAGEMENT

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-delivery.css";
import Sidebar from "../components/Sidebar";

const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Logout: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Eye: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>),
  Close: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>),
  Clock: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>),
  Package: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>),
  User: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
  Refresh: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>),
  Truck: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>),
};

const STATUS_CONFIG = {
  "Pending": { label: "Pendiente", value: "Pending", color: "#92620A", bg: "#FEF3C7" },
  "In_Design": { label: "En Diseño", value: "In_Design", color: "#5B21B6", bg: "#EDE9FE" },
  "cotizacion": { label: "Cotización", value: "cotizacion", color: "#0369A1", bg: "#E0F2FE" },
  "pagada": { label: "Pagada", value: "pagada", color: "#059669", bg: "#D1FAE5" },
  "en_impresion": { label: "En Impresión", value: "en_impresion", color: "#9A3412", bg: "#FFF7ED" },
  "terminada": { label: "Terminada", value: "terminada", color: "#0284C7", bg: "#E0F2FE" },
  "entregada": { label: "Entregada", value: "entregada", color: "#059669", bg: "#D1FAE5" },
  "completada": { label: "Completada", value: "completada", color: "#14532D", bg: "#DCFCE7" },
  "cancelada": { label: "Cancelada", value: "cancelada", color: "#991B1B", bg: "#FEF2F2" },
};

const PAYMENT_CONFIG = {
  "pagado": { label: "Pagado", color: "#059669", bg: "#D1FAE5" },
  "Pending_Payment": { label: "Pago Pendiente", color: "#92620A", bg: "#FEF3C7" },
  "parcial": { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["Pending"];
  return (
    <span className="pd-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ status }) {
  const cfg = PAYMENT_CONFIG[status] || PAYMENT_CONFIG["Pending_Payment"];
  return (
    <span className="pd-payment-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function OrderDetailModal({ open, onClose, order, onUpdateStatus }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);

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

  return (
    <div className="pd-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pd-modal">
        <div className="pd-modal-header">
          <div className="pd-modal-title">
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pd-modal-subtitle">Detalles de entrega</span>
          </div>
          <button className="pd-modal-close" onClick={onClose}>
            <Icon.Close />
          </button>
        </div>

        <div className="pd-modal-body">
          {updateSuccess && (
            <div className="pd-alert pd-alert-success">
              <Icon.Check />
              Orden marcada como entregada
            </div>
          )}

          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icon.User />
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
              <Icon.Package />
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
              <StatusBadge status={order.status} />
            </div>
            <div className="pd-status-item">
              <span className="pd-status-label">Pago</span>
              <PaymentBadge status={order.payment_status} />
            </div>
          </div>
        </div>

        <div className="pd-modal-footer">
          <button className="pd-btn pd-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          
          {(order.status === "terminada" || order.status === "en_impresion") && (
            <button 
              className="pd-btn pd-btn-primary"
              onClick={() => handleUpdateStatus("entregada")}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pd-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icon.Check />
                  Marcar como Entregada
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
  const [selectedOrder, setSelectedOrder] = useState(null);

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
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .in("status", ["terminada", "entregada", "completada", "en_impresion"])
        .order("created_at", { ascending: false });

      if (!error && data) {
        setOrders(data);
      }
      setLoading(false);
    };

    fetchOrders();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = !search || 
      order.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || order.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const metrics = [
    { label: "Para Entregar", value: orders.filter(o => o.status === "terminada" || o.status === "en_impresion").length, color: "#0284C7" },
    { label: "Entregadas", value: orders.filter(o => o.status === "entregada").length, color: "#059669" },
    { label: "Completadas", value: orders.filter(o => o.status === "completada").length, color: "#14532D" },
  ];

  const refreshOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["terminada", "entregada", "completada", "en_impresion"])
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    setLoading(false);
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
          { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
          { id: "orders", label: "Órdenes", icon: <Icon.Orders /> }
        ]}
        onLogout={handleLogout}
      />

      <main className="pd-main">
        <header className="pd-header">
          <button className="pd-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Icon.Menu />
          </button>
          <div className="pd-header-title">
            <h2>{activeTab === "dashboard" ? "Dashboard" : "Órdenes"}</h2>
          </div>
          <button className="pd-refresh-btn" onClick={refreshOrders}>
            <Icon.Refresh />
          </button>
        </header>

        <div className="pd-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pd-greeting">
                <h2>Bienvenido, <span>{user?.displayName || "Entrega"}</span></h2>
                <p>Gestiona la entrega de órdenes procesadas.</p>
              </div>

              <div className="pd-metrics">
                {metrics.map((m, i) => (
                  <div key={i} className="pd-metric-card">
                    <div className="pd-metric-icon" style={{ background: m.color }}>
                      <Icon.Truck />
                    </div>
                    <div className="pd-metric-info">
                      <span className="pd-metric-value">{m.value}</span>
                      <span className="pd-metric-label">{m.label}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pd-recent-section">
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
                          <StatusBadge status={order.status} />
                          <button className="pd-view-btn"><Icon.Eye /></button>
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
                  <span className="pd-search-icon"><Icon.Search /></span>
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
                    <option value="terminada">Terminadas</option>
                    <option value="entregada">Entregadas</option>
                    <option value="completada">Completadas</option>
                  </select>
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
                        <th>Material</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map(order => (
                        <tr key={order.id}>
                          <td>#{order.id?.slice(0, 8).toUpperCase()}</td>
                          <td>{order.client_name}</td>
                          <td>{order.material}</td>
                          <td><StatusBadge status={order.status} /></td>
                          <td><button className="pd-action-btn" onClick={() => setSelectedOrder(order)}>Ver</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        order={selectedOrder}
        onUpdateStatus={refreshOrders}
      />
    </div>
  );
}