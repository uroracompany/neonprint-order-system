import { useCallback, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-delivery.css";
import "../css-components/page-seller.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import { Icons } from "../utils/icons";
import { ORDER_STATUS, DELIVERY_STATUS_OPTIONS, isOrderStatus, ARCHIVE_MODULES, PRODUCTION_AREAS, PRODUCTION_AREA_LABELS, resolveSellerId } from "../utils/constants";
import { StatusBadge, PaymentBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import {
  canArchiveOrder,
  canRestoreOrder,
  archiveOrder,
  restoreOrder,
} from "../utils/archive";

const CARD_ACCENTS = [
  { color: "#0284C7", bg: "#E0F2FE", glow: "radial-gradient(circle, rgba(2,132,199,0.25) 0%, transparent 70%)" },
  { color: "#059669", bg: "#ECFDF5", glow: "radial-gradient(circle, rgba(5,150,105,0.25) 0%, transparent 70%)" },
  { color: "#8B5CF6", bg: "#F3E8FF", glow: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)" },
];

function OrderDetailModal({ onClose, order, onUpdateStatus }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [sellerName, setSellerName] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [prodAssignments, setProdAssignments] = useState([]);

  useEffect(() => {
    if (order?.seller_name) {
      setSellerName(order.seller_name);
      return;
    }
    const sellerId = order?.seller_id || order?.created_by;
    if (!sellerId) {
      setSellerName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", sellerId).single()
      .then(({ data }) => setSellerName(data?.name || ""));
  }, [order?.seller_name, order?.seller_id, order?.created_by]);

  useEffect(() => {
    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", order.designer_id).single()
      .then(({ data }) => setDesignerName(data?.name || ""));
  }, [order?.designer_id]);

  useEffect(() => {
    const quoteId = order?.quote_id || order?.quotation_id || order?.quote_user_id;
    if (!quoteId) {
      setQuoteName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", quoteId).single()
      .then(({ data }) => setQuoteName(data?.name || ""));
  }, [order?.quote_id, order?.quotation_id, order?.quote_user_id]);

  useEffect(() => {
    if (!order?.id) return;
    Promise.all([
      supabase.from("order_production_assignments")
        .select("assigned_to, production_area_code")
        .eq("order_id", order.id),
      supabase.from("order_production_files")
        .select("production_area_code, status, assigned_to")
        .eq("order_id", order.id),
    ]).then(async ([assignRes, filesRes]) => {
      const assignments = assignRes.data || [];
      const files = filesRes.data || [];
      if (assignments.length === 0) {
        setProdAssignments([]);
        return;
      }
      const assignedUserIds = [...new Set(assignments.map(a => a.assigned_to))];
      const fileUserIds = [...new Set(files.map(f => f.assigned_to).filter(Boolean))];
      const allUserIds = [...new Set([...assignedUserIds, ...fileUserIds])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", allUserIds);
      const nameMap = Object.fromEntries((profiles || []).map(p => [p.id, p.name]));
      const filesByArea = {};
      files.forEach(f => {
        const area = f.production_area_code;
        if (!filesByArea[area]) filesByArea[area] = { total: 0, byStatus: {} };
        filesByArea[area].total++;
        filesByArea[area].byStatus[f.status] = (filesByArea[area].byStatus[f.status] || 0) + 1;
      });
      setProdAssignments(assignments.map(a => ({
        area: a.production_area_code,
        name: nameMap[a.assigned_to] || "Asignado",
        hasFiles: (filesByArea[a.production_area_code]?.total || 0) > 0,
        fileCount: filesByArea[a.production_area_code]?.total || 0,
        fileStatuses: filesByArea[a.production_area_code]?.byStatus || {},
      })));
    });
  }, [order?.id]);

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
                <span className="pd-modal-value">{sellerName || "No especificado"}</span>
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
              <Icons.Users />
              <h4>Usuarios del sistema</h4>
            </div>
            <div className="pd-modal-rows">
              <div className="pd-modal-row">
                <span className="pd-modal-row-icon"><Icons.User /></span>
                <div>
                  <p className="pd-modal-row-label">Vendedor</p>
                  <p className="pd-modal-row-value">{sellerName || "No especificado"}</p>
                </div>
              </div>
              <div className="pd-modal-row">
                <span className="pd-modal-row-icon"><Icons.Edit /></span>
                <div>
                  <p className="pd-modal-row-label">Diseñador</p>
                  <p className="pd-modal-row-value">
                    {order?.designer_id ? (designerName || "Asignado") : "La orden no pasó por diseño"}
                  </p>
                </div>
              </div>
              <div className="pd-modal-row">
                <span className="pd-modal-row-icon"><Icons.Money /></span>
                <div>
                  <p className="pd-modal-row-label">Cotizador</p>
                  <p className="pd-modal-row-value">{quoteName || "No asignado"}</p>
                </div>
              </div>
              {prodAssignments.length > 0 && (
                <div className="pd-modal-row-divider" />
              )}
              {prodAssignments.map((pa, i) => (
                <div key={i} className="pd-modal-row">
                  <span className="pd-modal-row-icon"><Icons.Package /></span>
                  <div>
                    <p className="pd-modal-row-label">{PRODUCTION_AREA_LABELS[pa.area] || pa.area}</p>
                    <p className="pd-modal-row-value">{pa.name}</p>
                    <p className={`pd-modal-row-files ${pa.hasFiles ? "" : "pd-modal-row-files-empty"}`}>
                      {pa.hasFiles
                        ? `${pa.fileCount} archivo${pa.fileCount !== 1 ? "s" : ""}`
                        : "Sin archivos asociados"}
                    </p>
                  </div>
                </div>
              ))}
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

          {order.preview_image && (
            <div className="pd-modal-card" style={{ marginTop: 16 }}>
              <div className="pd-modal-card-title">
                <Icons.Eye /><h4>Orden de Trabajo</h4>
              </div>
              <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <img
                  src={order.preview_image}
                  alt="Orden de Trabajo"
                  style={{
                    width: "100%",
                    maxHeight: 200,
                    objectFit: "contain",
                    objectPosition: "left",
                    background: "var(--pd-surface-alt, #f5f7fb)",
                    borderRadius: "var(--pd-radius-md)",
                    border: "1px solid var(--pd-border)",
                    cursor: "pointer",
                    transition: "transform 0.2s, box-shadow 0.2s",
                  }}
                  onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                  onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                />
              </a>
            </div>
          )}

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
  const { user: authUser, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [clients, setClients] = useState([]);
  const [viewMode, setViewMode] = useState("cards");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const notif = useNotifications(user?.id);
  const [page, setPage] = useState(1);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [sellerDirectory, setSellerDirectory] = useState({});
  const PER_PAGE = 15;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const refreshOrders = useCallback(async (silent = false) => {
    if (!user?.id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", DELIVERY_STATUS_OPTIONS)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    if (!silent) setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    setUser(authUser || null);
  }, [authUser]);

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    refreshOrders();
  }, [user?.id, refreshOrders]);

  useEffect(() => {
    const sellerIds = [...new Set(
      orders.map(order => resolveSellerId(order)).filter(Boolean)
    )];
    if (sellerIds.length === 0) return;
    const missingIds = sellerIds.filter(id => !sellerDirectory[id]);
    if (missingIds.length === 0) return;
    supabase
      .from("profiles")
      .select("id, name")
      .in("id", missingIds)
      .then(({ data }) => {
        if (!data) return;
        setSellerDirectory(prev => ({
          ...prev,
          ...Object.fromEntries(data.map(p => [p.id, p.name || "Vendedor"]))
        }));
      });
  }, [orders, sellerDirectory]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`delivery-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => refreshOrders(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshOrders]);

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = !search || 
      order.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      order.id?.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesClient = orderMatchesClientFilter(order, filterClient);
    
    const matchesArchive = 
      (filterArchive === "active" && !order.is_archived_delivery) ||
      (filterArchive === "archived" && order.is_archived_delivery);
    
    return matchesSearch && matchesStatus && matchesClient && matchesArchive;
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
    if (!canArchiveOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id)) return;
    setArchivingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;
    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.DELIVERY);
    setArchiveLoading(false);
    if (!error) {
      setArchivingOrder(null);
      refreshOrders();
    } else {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo archivar la orden.",
      });
    }
  };

  const handleUnarchiveOrder = async (orderId) => {
    const { error } = await restoreOrder({ id: orderId }, ARCHIVE_MODULES.DELIVERY);
    if (!error) {
      refreshOrders();
    } else {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al restaurar",
        orderTitle: `Orden #${orderId?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo restaurar la orden.",
      });
    }
  };

  const formatOrderDate = (value) => {
    if (!value) return "Sin fecha";
    return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
  };

  const renderDeliveryActions = (order, variant = "card") => (
    <>
      {!order.is_archived_delivery && isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED) && (
        <button
          className={variant === "table" ? "table-action-btn deliver" : "pd-card-action-btn deliver"}
          onClick={event => handleQuickMarkDelivered(event, order.id)}
          disabled={updatingOrderId === order.id}
          title="Marcar como entregado"
        >
          {updatingOrderId === order.id ? <span className="pd-btn-spinner" /> : <Icons.Check />}
        </button>
      )}
      {canArchiveOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id) && (
        <button
          className={variant === "table" ? "table-action-btn archive" : "pd-card-action-btn archive"}
          onClick={event => { event.stopPropagation(); handleArchiveOrder(order); }}
          title="Archivar orden"
        >
          <Icons.Archive />
        </button>
      )}
      {filterArchive === "archived" && canRestoreOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id) && (
        <button
          className={variant === "table" ? "table-action-btn unarchive" : "pd-card-action-btn unarchive"}
          onClick={event => { event.stopPropagation(); handleUnarchiveOrder(order.id); }}
          title="Restaurar orden"
        >
          <Icons.Refresh />
        </button>
      )}
      <button
        className={variant === "table" ? "table-action-btn view" : "pd-card-action-btn view"}
        onClick={event => { event.stopPropagation(); setSelectedOrder(order); }}
        title="Ver detalles"
      >
        <Icons.Eye />
      </button>
    </>
  );

  const renderOrderCard = (order) => (
    <article key={order.id} className="pd-order-card" onClick={() => setSelectedOrder(order)}>
      <div className="pd-order-card-header">
        <div className="pd-order-card-identity">
          <span className="pd-order-card-id">#{order.id?.slice(0, 8).toUpperCase() || "---"}</span>
          <span className="pd-order-card-date"><Icons.Clock /> {formatOrderDate(order.created_at)}</span>
        </div>
        <div className="pd-order-card-badges">
          <StatusBadge status={order.status} className="pd-badge" showDot={false} />
        </div>
      </div>

      <div className="pd-order-card-body">
        <div className="pd-order-card-client">{order.client_name || "Cliente sin nombre"}</div>
        <div className="pd-order-card-desc">{order.description || "Sin descripción"}</div>
      </div>

      <div className="pd-order-card-meta">
        <span className="pd-meta-seller"><Icons.User /> {sellerDirectory[resolveSellerId(order)] || order.seller_name || "Vendedor no definido"}</span>
        <span className="pd-meta-date"><Icons.Calendar /> {order.delivery_date ? formatOrderDate(order.delivery_date) : "Por definir"}</span>
      </div>

      <div className="pd-order-card-footer">
        <div className="pd-order-card-type">
          {order.order_type === "orden 911" ? (
            <span className="pd-badge-911">911</span>
          ) : (
            <span className="pd-badge-normal">Normal</span>
          )}
        </div>
        <div className="pd-order-card-actions">
          {renderDeliveryActions(order)}
        </div>
      </div>
    </article>
  );

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
              {activeTab === "dashboard" && user?.displayName && (
                <span className="pd-header-sub">{user.displayName}</span>
              )}
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

        <nav className="pd-mobile-nav">
          <button
            className={`pd-mobile-nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            <Icons.Dashboard />
            <span>Dashboard</span>
          </button>
          <button
            className={`pd-mobile-nav-btn ${activeTab === "orders" ? "active" : ""}`}
            onClick={() => setActiveTab("orders")}
          >
            <Icons.Orders />
            <span>Órdenes</span>
          </button>
          <div className="pd-mobile-nav-spacer" />
          <button className="pd-mobile-nav-btn" onClick={refreshOrders} title="Actualizar">
            <Icons.Refresh />
          </button>
          <button className="pd-mobile-nav-btn pd-mobile-nav-logout" onClick={handleLogout} title="Cerrar sesión">
            <Icons.Logout />
          </button>
        </nav>

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
                <div className="pd-panel-header">
                  <div>
                    <div className="pd-panel-title">Órdenes para Entrega</div>
                    <div className="pd-panel-sub">Últimas órdenes listas para entregar.</div>
                  </div>
                  <div className="pd-recent-header-right">
                    <span className="pd-recent-count">{orders.length} orden{orders.length !== 1 ? "es" : ""}</span>
                    <button className="pd-link-btn" onClick={() => setActiveTab("orders")}>
                      Ver todas <Icons.ArrowRight />
                    </button>
                  </div>
                </div>
                {loading ? (
                  <div className="pd-skeleton-grid" style={{ padding: 16 }}>
                    {[1,2,3].map(i => (
                      <div key={i} className="pd-skeleton-card">
                        <div className="pd-skeleton-line w60" />
                        <div className="pd-skeleton-line w40" />
                        <div className="pd-skeleton-block" />
                      </div>
                    ))}
                  </div>
                ) : orders.length === 0 ? (
                  <div className="pd-empty">
                    <div className="pd-empty-icon"><Icons.Package /></div>
                    <div className="pd-empty-title">No hay órdenes pendientes</div>
                    <div className="pd-empty-sub">Las órdenes aparecerán aquí cuando estén listas para entrega.</div>
                  </div>
                ) : (
                  <div className="pd-orders-grid pd-dashboard-orders">
                    {orders.slice(0, 5).map(order => renderOrderCard(order))}
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
                  <ClientFilterSelect
                    clients={clients}
                    value={filterClient}
                    onChange={setFilterClient}
                    className="pd-input"
                    allLabel="Todos los clientes"
                  />
                  <span className="pd-select-arrow"><Icons.ChevronDown /></span>
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                    <option value="active">Activas</option>
                    <option value="archived">Archivadas</option>
                  </select>
                  <span className="pd-select-arrow"><Icons.ChevronDown /></span>
                </div>
                <div className="pd-view-switch" aria-label="Cambiar vista de órdenes">
                  <button
                    type="button"
                    className={`pd-view-toggle ${viewMode === "table" ? "active" : ""}`}
                    onClick={() => setViewMode("table")}
                    title="Vista de tabla"
                    aria-label="Vista de tabla"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                  <button
                    type="button"
                    className={`pd-view-toggle ${viewMode === "cards" ? "active" : ""}`}
                    onClick={() => setViewMode("cards")}
                    title="Vista de tarjetas"
                    aria-label="Vista de tarjetas"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  </button>
                </div>
                <span className="pd-filters-count">{filteredOrders.length}</span>
              </div>

              {loading ? (
                <div className="pd-skeleton-grid">
                  {[1,2,3,4,5,6].map(i => (
                    <div key={i} className="pd-skeleton-card">
                      <div className="pd-skeleton-line w60" />
                      <div className="pd-skeleton-line w40" />
                      <div className="pd-skeleton-block" />
                      <div className="pd-skeleton-line w80" />
                    </div>
                  ))}
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="pd-empty">
                  <div className="pd-empty-icon"><Icons.Package /></div>
                  <div className="pd-empty-title">No se encontraron órdenes</div>
                  <div className="pd-empty-sub">Intenta ajustar los filtros o buscar con otro término.</div>
                </div>
              ) : viewMode === "table" && !isMobile ? (
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
                              {renderDeliveryActions(order, "table")}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="pd-orders-grid">
                  {paginatedOrders.map(order => renderOrderCard(order))}
                </div>
              )}
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </main>

      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />

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
