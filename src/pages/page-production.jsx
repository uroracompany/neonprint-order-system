// PRODUCTION PAGE - ORDER DASHBOARD FOR PRINTERS

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-production.css";
import Sidebar from "../components/Sidebar";

const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Logout: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Eye: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>),
  Close: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Download: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>),
  File: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>),
  Clock: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>),
  Play: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>),
  Package: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>),
  User: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
  Refresh: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>),
};

const STATUS_CONFIG = {
  "Pending": { label: "Pendiente", value: "Pending", color: "#92620A", bg: "#FEF3C7" },
  "In_Design": { label: "En Diseño", value: "In_Design", color: "#5B21B6", bg: "#EDE9FE" },
  "cotizacion": { label: "Cotización", value: "cotizacion", color: "#0369A1", bg: "#E0F2FE" },
  "pagada": { label: "Pagada", value: "pagada", color: "#059669", bg: "#D1FAE5" },
  "en_impresion": { label: "En Impresión", value: "en_impresion", color: "#9A3412", bg: "#FFF7ED" },
  "terminada": { label: "Terminada", value: "terminada", color: "#0284C7", bg: "#E0F2FE" },
  "completada": { label: "Completada", value: "completada", color: "#14532D", bg: "#DCFCE7" },
  "entregada": { label: "Entregada", value: "entregada", color: "#065F46", bg: "#ECFDF5" },
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
    <span className="pp-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ status }) {
  const cfg = PAYMENT_CONFIG[status] || PAYMENT_CONFIG["Pending_Payment"];
  return (
    <span className="pp-payment-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function OrderDetailModal({ open, onClose, order, onUpdateStatus }) {
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
    ...getDbFiles().map((url, i) => ({ name: url.split('/').pop() || `archivo-${i+1}`, url }))
  ];

  return (
    <div className="pp-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <div className="pp-modal-header">
          <div className="pp-modal-title">
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pp-modal-subtitle">Detalles para producción</span>
          </div>
          <button className="pp-modal-close" onClick={onClose}>
            <Icon.Close />
          </button>
        </div>

        <div className="pp-modal-body">
          {updateSuccess && (
            <div className="pp-alert pp-alert-success">
              <Icon.Check />
              Estado actualizado correctamente
            </div>
          )}

          <div className="pp-modal-card">
            <div className="pp-modal-card-title">
              <Icon.User />
              <h4>Información del Cliente</h4>
            </div>
            <div className="pp-modal-grid">
              <div className="pp-modal-item">
                <span className="pp-modal-label">Cliente</span>
                <span className="pp-modal-value">{order.client_name || "No especificado"}</span>
              </div>
              <div className="pp-modal-item">
                <span className="pp-modal-label">Vendedor</span>
                <span className="pp-modal-value">{order.seller_name || "No especificado"}</span>
              </div>
              <div className="pp-modal-item">
                <span className="pp-modal-label">Tipo de Orden</span>
                <span className="pp-modal-value">
                  {order.order_type === "orden 911" ? (
                    <span className="pp-badge-911">911 - Urgente</span>
                  ) : (
                    <span className="pp-badge-normal">Normal</span>
                  )}
                </span>
              </div>
              <div className="pp-modal-item">
                <span className="pp-modal-label">Fecha de Creación</span>
                <span className="pp-modal-value">{created}</span>
              </div>
            </div>
          </div>

          <div className="pp-modal-card">
            <div className="pp-modal-card-title">
              <Icon.Package />
              <h4>Detalles del Trabajo</h4>
            </div>
            <div className="pp-modal-grid">
              <div className="pp-modal-item full">
                <span className="pp-modal-label">Descripción</span>
                <p className="pp-modal-description">{order.description || "Sin descripción"}</p>
              </div>
              <div className="pp-modal-item">
                <span className="pp-modal-label">Material</span>
                <span className="pp-modal-value">{order.material || "No especificado"}</span>
              </div>
              {order.width && order.height && (
                <div className="pp-modal-item">
                  <span className="pp-modal-label">Dimensiones</span>
                  <span className="pp-modal-value">{order.width} x {order.height} cm</span>
                </div>
              )}
              {order.quantity && (
                <div className="pp-modal-item">
                  <span className="pp-modal-label">Cantidad</span>
                  <span className="pp-modal-value">{order.quantity} unidades</span>
                </div>
              )}
            </div>
          </div>

          <div className="pp-modal-card">
            <div className="pp-modal-card-title">
              <Icon.File />
              <h4>Archivos para Impresión</h4>
            </div>
            
            {loadingFiles ? (
              <div className="pp-loading-files">Cargando archivos...</div>
            ) : allFiles.length > 0 ? (
              <div className="pp-files-list">
                {allFiles.map((file, i) => (
                  <div key={i} className="pp-file-item">
                    <div className="pp-file-icon">
                      <Icon.File />
                    </div>
                    <span className="pp-file-name">{file.name}</span>
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="pp-file-download">
                      <Icon.Download />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pp-no-files">No hay archivos disponibles</div>
            )}
          </div>

          <div className="pp-status-bar">
            <div className="pp-status-item">
              <span className="pp-status-label">Estado</span>
              <StatusBadge status={order.status} />
            </div>
            <div className="pp-status-item">
              <span className="pp-status-label">Pago</span>
              <PaymentBadge status={order.payment_status} />
            </div>
          </div>
        </div>

        <div className="pp-modal-footer">
          <button className="pp-btn pp-btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          
          {order.status === "pagada" && (
            <button 
              className="pp-btn pp-btn-primary"
              onClick={() => handleUpdateStatus("en_impresion")}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icon.Play />
                  Iniciar Impresión
                </>
              )}
            </button>
          )}
          
          {order.status === "en_impresion" && (
            <button 
              className="pp-btn pp-btn-primary"
              onClick={() => handleUpdateStatus("terminada")}
              disabled={updating}
            >
              {updating ? (
                <>
                  <span className="pp-btn-spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <Icon.Check />
                  Marcar Terminada
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
        .in("status", ["pagada", "en_impresion", "terminada"])
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
      order.id?.toLowerCase().includes(search.toLowerCase()) ||
      order.description?.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || order.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const metrics = [
    { label: "Pendientes", value: orders.filter(o => o.status === "pagada").length, color: "#059669" },
    { label: "En Impresión", value: orders.filter(o => o.status === "en_impresion").length, color: "#9A3412" },
    { label: "Terminadas", value: orders.filter(o => o.status === "terminada").length, color: "#0284C7" },
  ];

  const refreshOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["pagada", "en_impresion", "terminada"])
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    setLoading(false);
  };

  return (
    <div className="pp-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Producción"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
          { id: "orders", label: "Órdenes", icon: <Icon.Orders /> }
        ]}
        onLogout={handleLogout}
      />

      <main className="pp-main">
        <header className="pp-header">
          <button className="pp-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Icon.Menu />
          </button>
          <div className="pp-header-title">
            <h2>{activeTab === "dashboard" ? "Dashboard" : "Órdenes"}</h2>
          </div>
          <button className="pp-refresh-btn" onClick={refreshOrders}>
            <Icon.Refresh />
          </button>
        </header>

        <div className="pp-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pp-greeting">
                <h2>Bienvenido, <span>{user?.displayName || "Operador"}</span></h2>
                <p>Estas son las órdenes pagadas listas para producción.</p>
              </div>

              <div className="pp-metrics">
                {metrics.map((m, i) => (
                  <div key={i} className="pp-metric-card">
                    <div className="pp-metric-icon" style={{ background: m.color }}>
                      <Icon.Package />
                    </div>
                    <div className="pp-metric-info">
                      <span className="pp-metric-value">{m.value}</span>
                      <span className="pp-metric-label">{m.label}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pp-recent-section">
                <h3>Órdenes Recientes</h3>
                {loading ? (
                  <div className="pp-loading">Cargando órdenes...</div>
                ) : orders.length === 0 ? (
                  <div className="pp-empty">No hay órdenes para producción</div>
                ) : (
                  <div className="pp-orders-list">
                    {orders.slice(0, 5).map(order => (
                      <div key={order.id} className="pp-order-item" onClick={() => setSelectedOrder(order)}>
                        <div className="pp-order-left">
                          <span className="pp-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <span className="pp-order-client">{order.client_name}</span>
                        </div>
                        <div className="pp-order-center">
                          <span className="pp-order-desc">{order.description?.substring(0, 50) || 'Sin descripción'}...</span>
                        </div>
                        <div className="pp-order-right">
                          <StatusBadge status={order.status} />
                          <button className="pp-view-btn" title="Ver detalle">
                            <Icon.Eye />
                          </button>
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
              <div className="pp-filters">
                <div className="pp-search-wrap">
                  <span className="pp-search-icon"><Icon.Search /></span>
                  <input 
                    className="pp-input" 
                    placeholder="Buscar por cliente o ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div className="pp-select-wrap">
                  <select className="pp-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">Todos los estados</option>
                    <option value="pagada">Pagadas</option>
                    <option value="en_impresion">En Impresión</option>
                    <option value="terminada">Terminadas</option>
                  </select>
                </div>
                <span className="pp-filters-count">{filteredOrders.length} órdenes</span>
              </div>

              {loading ? (
                <div className="pp-loading">Cargando órdenes...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="pp-empty">No hay órdenes que coincidan</div>
              ) : (
                <div className="pp-orders-table-wrap">
                  <table className="pp-orders-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Descripción</th>
                        <th>Material</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map(order => (
                        <tr key={order.id}>
                          <td className="pp-td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                          <td className="pp-td-client">{order.client_name}</td>
                          <td className="pp-td-desc">{order.description?.substring(0, 40)}</td>
                          <td className="pp-td-material">{order.material}</td>
                          <td><StatusBadge status={order.status} /></td>
                          <td className="pp-td-date">{new Date(order.created_at).toLocaleDateString("es-DO")}</td>
                          <td>
                            <button className="pp-action-btn" onClick={() => setSelectedOrder(order)}>Ver</button>
                          </td>
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