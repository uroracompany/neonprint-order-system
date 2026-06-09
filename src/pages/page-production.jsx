import { useCallback, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-production.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import { Icons } from "../utils/icons";
import { StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import {
  ORDER_STATUS,
  PAYMENT_COLORS,
  PRODUCTION_TRACKING_STATUS_OPTIONS,
  PRODUCTION_FILE_STATUS,
  getProductionAreaForRole,
  getProductionAreaLabel,
  getOrderStatusConfig,
  isOrderStatus,
  formatDate,
} from "../utils/constants";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import { getReferenceImages } from "../utils/orderAssets";
import {
  filterProductionOrdersByArchiveState,
  filterProductionFilesForRole,
  getNextProductionFileStatus,
  getProductionFileStatusLabel,
  getProductionSummary,
  isProductionOrderArchivedForUser,
} from "../utils/production";

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

function OrderDetailModal({ onClose, order, producerRole, onUpdateStatus }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [designerName, setDesignerName] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [sellerName, setSellerName] = useState("");

  const handleUpdateFileStatus = async (fileId, nextStatus) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .rpc("update_production_file_status", { p_file_id: fileId, p_next_status: nextStatus });

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
  const handleUpdateStatus = () => {};
  const onCompleteOrder = null;

  useEffect(() => {
    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", order.designer_id)
      .single()
      .then(({ data }) => {
        setDesignerName(data?.name || "");
      });
  }, [order?.designer_id]);

  useEffect(() => {
    const quoteId = order?.quote_id || order?.quotation_id || order?.quote_user_id;
    if (!quoteId) {
      setQuoteName("");
      return;
    }
    supabase
      .from("profiles")
      .select("name")
      .eq("id", quoteId)
      .single()
      .then(({ data }) => {
        setQuoteName(data?.name || "");
      });
  }, [order?.quote_id, order?.quotation_id, order?.quote_user_id]);

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
    supabase
      .from("profiles")
      .select("name")
      .eq("id", sellerId)
      .single()
      .then(({ data }) => {
        setSellerName(data?.name || "");
      });
  }, [order?.seller_name, order?.seller_id, order?.created_by]);

  if (!order) return null;

  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const statusCfg = getOrderStatusConfig(order.status);
  const isInProduction = false;
  const isInTermination = false;

  const isExternal = order?.order_design_type === "EXTERNAL_DESING";
  const areaCode = getProductionAreaForRole(producerRole);
  const areaFiles = filterProductionFilesForRole(order, producerRole);
  const areaSummary = getProductionSummary(areaFiles);
  const referenceImageUrls = getReferenceImages(order);
  const hasAreaFiles = areaFiles.length > 0;

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
                      <p className="pp-modal-row-value">{sellerName || "No especificado"}</p>
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
                <p style={{ marginTop: 10, fontSize: 12, color: "var(--pp-text-muted)" }}>
                  Area {getProductionAreaLabel(areaCode)}: {areaSummary.completed}/{areaSummary.total} completados
                </p>
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
                <p className="pp-modal-status-title">Estado</p>
                <div className="pp-modal-status-grid">
                  <div className="pp-modal-status-section">
                    <span className="pp-modal-status-label">Estado Actual</span>
                    <StatusBadge status={order.status} className="pp-badge" bordered />
                  </div>
                  {order.price && (
                    <div className="pp-price-box">
                      <p className="pp-price-box-label">PRECIO</p>
                      <p className="pp-price-box-value">RD$ {Number(order.price).toLocaleString("es-DO")}</p>
                    </div>
                  )}
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
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.Edit /></span>
                    <div>
                      <p className="pp-modal-row-label">Diseñador</p>
                      <p className="pp-modal-row-value">
                        {isExternal ? "La orden es externa" : (designerName || "No asignado")}
                      </p>
                    </div>
                  </div>
                  <div className="pp-modal-row">
                    <span className="pp-modal-row-icon"><Icons.User /></span>
                    <div>
                      <p className="pp-modal-row-label">Responsable de caja</p>
                      <p className="pp-modal-row-value">{quoteName || "No asignado"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {hasAreaFiles ? (
            <div className="pp-files-section" style={{ marginTop: 18 }}>
              <div className="pp-files-title">
                <Icons.File />
                Archivos Adjuntos
              </div>
              <div style={{ display: "grid", gridTemplateColumns: order.preview_image && areaFiles.length > 0 ? "1fr 1fr" : "1fr", gap: 16, marginTop: 12 }}>
                {order.preview_image && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icons.Eye /> Orden de Trabajo
                    </p>
                    <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <img
                        src={order.preview_image}
                        alt="preview"
                        style={{
                          width: "100%",
                          borderRadius: "var(--pp-radius-md)",
                          border: "1px solid var(--pp-border)",
                          cursor: "pointer",
                          transition: "transform 0.2s, box-shadow 0.2s",
                        }}
                        onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                        onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                      />
                    </a>
                  </div>
                )}
                {areaFiles.length > 0 && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icons.Brush /> Diseño del cliente
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {areaFiles.map((file) => {
                        const nextStatus = getNextProductionFileStatus(file.status);
                        return (
                        <div key={file.id} className="pp-file-item" style={{ margin: 0 }}>
                          <div className="pp-file-icon">
                            <Icons.File />
                          </div>
                          <div className="pp-file-info">
                            <span className="pp-file-name">{file.filename}</span>
                            <span style={{ fontSize: 11, color: "var(--pp-text-muted)" }}>{getProductionFileStatusLabel(file.status)}</span>
                          </div>
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="pp-file-download" title="Descargar">
                            <Icons.Download />
                          </a>
                          {nextStatus && (
                            <button
                              className="pp-file-download"
                              onClick={() => handleUpdateFileStatus(file.id, nextStatus)}
                              disabled={updating}
                              title={nextStatus === PRODUCTION_FILE_STATUS.COMPLETED ? "Marcar completado" : "Marcar en terminacion"}
                            >
                              {nextStatus === PRODUCTION_FILE_STATUS.COMPLETED ? <Icons.Check /> : <Icons.Play />}
                            </button>
                          )}
                        </div>
                      );})}
                    </div>
                  </div>
                )}
              </div>
              {referenceImageUrls.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pp-text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Image /> Imágenes de referencia
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {referenceImageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                        <img
                          src={url}
                          alt={`Ref ${i + 1}`}
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: "var(--pp-radius-md)",
                            border: "1px solid var(--pp-border)",
                            cursor: "pointer",
                            transition: "transform 0.2s, box-shadow 0.2s",
                          }}
                          onMouseEnter={e => { e.target.style.transform = "scale(1.05)"; e.target.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)"; }}
                          onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pp-modal-card" style={{ marginTop: 18 }}>
              Esta orden no contiene archivos relacionados con tu area. No se requiere tu participacion en este proceso.
            </div>
          )}
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
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [profileRole, setProfileRole] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;
  const [viewMode, setViewMode] = useState("table");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [archivedingOrder, setArchivedingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [filterArchive, setFilterArchive] = useState("active");
  const [clients, setClients] = useState([]);
  const notif = useNotifications(user?.id);

  const refreshOrders = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_production_files(*), order_production_assignments(*), order_production_user_archives(*)")
      .in("status", PRODUCTION_TRACKING_STATUS_OPTIONS)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setOrders(data);
    }
    setLoading(false);
  }, [user?.id]);

  const handleArchiveOrder = (order) => {
    if (!isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)) return;
    setArchivedingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivedingOrder) return;
    setArchiveLoading(true);
    try {
      const { error } = await supabase
        .rpc("set_production_order_archive", { p_order_id: archivedingOrder.id, p_archived: true });
      if (error) throw error;
      setArchivedingOrder(null);
      await refreshOrders();
    } catch (err) {
      console.error("Error archiving order:", err);
    }
    setArchiveLoading(false);
  };

  const handleRestoreOrder = async (order) => {
    if (!order?.id) return;
    setArchiveLoading(true);
    try {
      const { error } = await supabase
        .rpc("set_production_order_archive", { p_order_id: order.id, p_archived: false });
      if (error) throw error;
      await refreshOrders();
    } catch (err) {
      console.error("Error restoring order:", err);
    }
    setArchiveLoading(false);
  };

  useEffect(() => {
    setUser(authUser || null);
    setProfileRole(authProfile?.role || "");
  }, [authProfile?.role, authUser]);

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  useEffect(() => {
    if (!user?.id || !profileRole) return;
    refreshOrders();
  }, [user?.id, profileRole, refreshOrders]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`production-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => refreshOrders()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_production_files" },
        () => refreshOrders()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_production_user_archives" },
        () => refreshOrders()
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

  const activeOrders = filterProductionOrdersByArchiveState(orders, user?.id, "active");
  const archiveScopedOrders = filterProductionOrdersByArchiveState(orders, user?.id, filterArchive);

  const filteredOrders = archiveScopedOrders.filter(order => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      order.client_name?.toLowerCase().includes(q) ||
      order.id?.toLowerCase().includes(q) ||
      order.description?.toLowerCase().includes(q);

    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesPayment = filterPayment === "all" || order.payment_status === filterPayment;
    const matchesClient = orderMatchesClientFilter(order, filterClient);

    return matchesSearch && matchesStatus && matchesPayment && matchesClient;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const metrics = [
    { icon: <Icons.Package />, label: "Producción", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length, accentIdx: 0 },
    { icon: <Icons.Package />, label: "Terminación", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_TERMINATION)).length, accentIdx: 1 },
    { icon: <Icons.Truck />, label: "Entregadas", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)).length, accentIdx: 2 },
    { icon: <Icons.Check />, label: "Completadas", value: activeOrders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_COMPLETED)).length, accentIdx: 3 },
  ];

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
  };

  const isArchivedByCurrentUser = (order) => (
    isProductionOrderArchivedForUser(order, user?.id)
  );

  const canArchiveOrder = (order) => (
    isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED) && !isArchivedByCurrentUser(order)
  );

  const canRestoreOrder = (order) => (
    filterArchive === "archived" && isArchivedByCurrentUser(order)
  );

  const canAdvance = (order) => {
    void order;
    return false;
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
                      ) : activeOrders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="pp-table-empty">No hay órdenes para producción</td>
                        </tr>
                      ) : (
                        activeOrders.slice(0, 5).map(order => (
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
                  <div className="pp-select-wrap">
                    <ClientFilterSelect
                      clients={clients}
                      value={filterClient}
                      onChange={setFilterClient}
                      className="pp-input"
                      allLabel="Todos los clientes"
                    />
                    <span className="pp-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="pp-select-wrap">
                    <select className="pp-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                      <option value="active">Activas</option>
                      <option value="archived">Archivadas</option>
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
                                {canArchiveOrder(order) && (
                                  <button
                                    className="table-action-btn archive"
                                    onClick={(e) => { e.stopPropagation(); handleArchiveOrder(order); }}
                                    title="Archivar orden"
                                  >
                                    <Icons.Archive />
                                  </button>
                                )}
                                {canRestoreOrder(order) && (
                                  <button
                                    className="table-action-btn unarchive"
                                    onClick={(e) => { e.stopPropagation(); handleRestoreOrder(order); }}
                                    disabled={archiveLoading}
                                    title="Restaurar orden"
                                  >
                                    <Icons.Refresh />
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
                            {canArchiveOrder(order) && (
                              <button
                                className="table-action-btn archive"
                                onClick={e => { e.stopPropagation(); handleArchiveOrder(order); }}
                                title="Archivar orden"
                              >
                                <Icons.Archive />
                              </button>
                            )}
                            {canRestoreOrder(order) && (
                              <button
                                className="table-action-btn unarchive"
                                onClick={e => { e.stopPropagation(); handleRestoreOrder(order); }}
                                disabled={archiveLoading}
                                title="Restaurar orden"
                              >
                                <Icons.Refresh />
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
        producerRole={profileRole}
        onUpdateStatus={refreshOrders}
      />

      {archivedingOrder && (
        <div className="pp-modal-overlay" onClick={() => setArchivedingOrder(null)}>
          <div className="pp-modal" onClick={e => e.stopPropagation()}>
            <div className="pp-modal-stripe" />
            <div className="pp-modal-header">
              <h3>Archivar orden</h3>
              <button className="pp-modal-close" onClick={() => setArchivedingOrder(null)}>
                <Icons.Close />
              </button>
            </div>
            <div className="pp-modal-body">
              <p>¿Deseas archivar la orden <strong>#{archivedingOrder.id?.slice(0, 8).toUpperCase()}</strong>?</p>
              <p style={{ color: "var(--pp-text-muted)", fontSize: "12px", marginTop: "8px" }}>
                Las órdenes archivadas no se mostrarán en la vista principal.
              </p>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn pp-btn-secondary" onClick={() => setArchivedingOrder(null)}>
                Cancelar
              </button>
              <button className="pp-btn pp-btn-primary" onClick={handleConfirmArchiveOrder} disabled={archiveLoading}>
                {archiveLoading ? (
                  <>
                    <span className="pp-btn-spinner"></span>
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
    </div>
  );
}


