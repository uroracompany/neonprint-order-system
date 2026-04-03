// QUOTE PAGE - ORDER DASHBOARD FOR QUOTATION USERS

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import "../css-components/page-quote.css";

// Iconos base reutilizados para mantener una interfaz consistente.
const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>),
  Bell: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9 17a3 3 0 0 0 6 0" /></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>),
  X: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  Clock: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>),
  User: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>),
  File: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
  Upload: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>),
  Archive: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8z" /><line x1="10" y1="12" x2="14" y2="12" /></svg>),
  Money: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>),
  Package: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>),
  Eye: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>),
};

// Estados base de orden y pago usados en el módulo.
const STATUS_CONFIG = {
  Pending: { label: "Pendiente", color: "#92620A", bg: "#FEF3C7", dot: "#F59E0B" },
  In_Design: { label: "En Diseño", color: "#5B21B6", bg: "#EDE9FE", dot: "#8B5CF6" },
  cotizacion: { label: "Cotización", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  in_Quotation: { label: "Cotización", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "en produccion": { label: "En Producción", color: "#9A3412", bg: "#FFF7ED", dot: "#F97316" },
  terminacion: { label: "Terminación", color: "#0369A1", bg: "#E0F2FE", dot: "#0284C7" },
  "en entrega": { label: "En Entrega", color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  completada: { label: "Completada", color: "#14532D", bg: "#DCFCE7", dot: "#22C55E" },
  cancelada: { label: "Cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
  cancelado: { label: "Cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
  cancelled: { label: "Cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
};

const PAYMENT_CONFIG = {
  pagado: { label: "Pagado", color: "#14532D", bg: "#DCFCE7" },
  Pending_Payment: { label: "Pago pendiente", color: "#92620A", bg: "#FEF3C7" },
  parcial: { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};

const QUOTE_ASSIGNMENT_FIELDS = ["quote_id", "quotation_id", "quote_user_id"];
const RECEIPT_FIELDS = ["payment_receipt_url", "receipt_image", "invoice_image", "payment_image_url"];
const NOTIFICATION_DURATION = 5000;

// Helpers de normalización para tolerar pequeñas variaciones del backend.
const getStatusConfig = (status) => STATUS_CONFIG[status] || STATUS_CONFIG.Pending;
const getPaymentConfig = (status) => PAYMENT_CONFIG[status] || PAYMENT_CONFIG.Pending_Payment;
const normalizeText = (value) => String(value || "").trim().toLowerCase();
const resolveQuoteAssignmentId = (order) => QUOTE_ASSIGNMENT_FIELDS.map(field => order?.[field]).find(Boolean) || null;
const hasQuoteAssignment = (order, quoteUserId) => QUOTE_ASSIGNMENT_FIELDS.some(field => order?.[field] === quoteUserId);
const resolveSellerId = (order) => order?.seller_id || order?.created_by || null;
const resolveSellerName = (order, sellerDirectory) => order?.seller_name || sellerDirectory?.[resolveSellerId(order)] || "No definido";
const resolveReceiptUrl = (order) => RECEIPT_FIELDS.map(field => order?.[field]).find(Boolean) || "";
const isQuoteEditable = (order) => ["cotizacion", "in_Quotation"].includes(order?.status) && order?.payment_status !== "pagado" && !order?.is_archived_quote;
const isOrderRelevantToQuote = (order, quoteUserId) => Boolean(order?.id) && hasQuoteAssignment(order, quoteUserId);
const formatQuoteDate = (value) => {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
};

const getOrderFiles = (order) => {
  if (!order?.order_file_url) return [];
  try {
    const parsed = JSON.parse(order.order_file_url);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [order.order_file_url];
  }
};

function StatusBadge({ status }) {
  const cfg = getStatusConfig(status);
  return (
    <span className="pq-badge" style={{ background: cfg.bg, color: cfg.color }}>
      <span className="pq-badge-dot" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ status }) {
  const cfg = getPaymentConfig(status);
  return (
    <span className="pq-payment-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function QuoteNotificationToast({ notification, onClose }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = notification.expiresAt - Date.now();
      setProgress(Math.max(0, (remaining / notification.duration) * 100));
    }, 50);

    return () => clearInterval(interval);
  }, [notification.duration, notification.expiresAt]);

  return (
    <div className={`pq-toast ${notification.type}`}>
      <div className="pq-toast-main">
        <div className="pq-toast-icon">
          {notification.type === "cancelled" ? <Icon.X /> : <Icon.Package />}
        </div>
        <div className="pq-toast-content">
          <span className="pq-toast-title">{notification.label}</span>
          <span className="pq-toast-subtitle">{notification.orderTitle}</span>
          <span className="pq-toast-text">{notification.message}</span>
        </div>
        <button className="pq-toast-close" onClick={() => onClose(notification.id)} aria-label="Cerrar notificación">
          <Icon.X />
        </button>
      </div>
      <div className="pq-toast-track">
        <div className="pq-toast-progress" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function ArchiveQuoteOrderModal({ open, onClose, onConfirm, order, loading }) {
  if (!open || !order) return null;

  return (
    <div className="pq-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="pq-dialog">
        <div className="pq-dialog-icon archive">
          <Icon.Archive />
        </div>
        <h3 className="pq-dialog-title">Archivar orden</h3>
        <p className="pq-dialog-text">¿Estás seguro de que deseas archivar esta orden?</p>
        <div className="pq-dialog-order">
          <span className="pq-dialog-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
          <span className="pq-dialog-order-name">{order.client_name || order.description || "Orden sin título"}</span>
        </div>
        <div className="pq-dialog-actions">
          <button className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="pq-btn pq-btn-archive" onClick={onConfirm} disabled={loading}>
            {loading ? "Archivando..." : "Archivar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal principal para revisar el detalle y confirmar el pago.
function QuoteOrderDetailModal({ open, onClose, order, onConfirmPayment, paymentSaving, sellerDirectory }) {
  const [receiptFile, setReceiptFile] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState("pagado");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (open) {
      setReceiptFile(null);
      setPaymentStatus(order?.payment_status === "pagado" ? "pagado" : "pagado");
      setLocalError("");
    }
  }, [open, order]);

  if (!open || !order) return null;

  const orderFiles = getOrderFiles(order);
  const receiptUrl = resolveReceiptUrl(order);
  const createdAt = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const canConfirmPayment = isQuoteEditable(order);
  const readonlyMessage =
    order.is_archived_quote
      ? "Esta orden está en modo lectura porque fue archivada en cotización."
      : order.payment_status === "pagado"
        ? "Esta orden está en modo lectura porque el pago ya fue confirmado."
        : "Esta orden está en modo lectura porque su estado actual no permite confirmar pago.";

  const handleSubmit = () => {
    if (!receiptFile) {
      setLocalError("Debes subir una imagen del recibo o factura antes de confirmar.");
      return;
    }

    if (paymentStatus !== "pagado") {
      setLocalError("Debes cambiar el estado del pago a pagado para continuar.");
      return;
    }

    setLocalError("");
    onConfirmPayment({ order, receiptFile, paymentStatus });
  };

  return (
    <div className="pq-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="pq-modal">
        <div className="pq-modal-header">
          <div>
            <span className="pq-modal-kicker">Detalle de cotización</span>
            <h2 className="pq-modal-title">Orden #{order.id?.slice(0, 8).toUpperCase()}</h2>
          </div>
          <button className="pq-icon-btn" onClick={onClose} aria-label="Cerrar detalle">
            <Icon.X />
          </button>
        </div>

        <div className="pq-modal-body">
          <div className="pq-flow-summary">
            <StatusBadge status={order.status} />
            <PaymentBadge status={order.payment_status} />
            <span className="pq-flow-date"><Icon.Clock /> {createdAt}</span>
          </div>

          <div className="pq-detail-grid">
            <div className="pq-panel">
              <div className="pq-panel-title">Información de la orden</div>
              <div className="pq-info-list">
                <div className="pq-info-row"><span>Cliente</span><strong>{order.client_name || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Vendedor</span><strong>{resolveSellerName(order, sellerDirectory)}</strong></div>
                <div className="pq-info-row"><span>Teléfono</span><strong>{order.client_contact || order.client_phone || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Tipo</span><strong>{order.order_type || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Material</span><strong>{order.material || "No definido"}</strong></div>
              </div>
              <div className="pq-description-box">
                <span className="pq-description-label">Descripción</span>
                <p>{order.description || "Sin descripción"}</p>
              </div>
            </div>

            <div className="pq-panel">
              <div className="pq-panel-title">Archivos entregados</div>
              {orderFiles.length > 0 ? (
                <div className="pq-file-list">
                  {orderFiles.map((fileUrl, index) => (
                    <a key={`${fileUrl}-${index}`} className="pq-file-link" href={fileUrl} target="_blank" rel="noreferrer">
                      <Icon.File />
                      Archivo principal {index + 1}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="pq-empty-panel">No hay archivos principales disponibles.</div>
              )}

              <div className="pq-preview-block">
                <span className="pq-description-label">Orden de trabajo</span>
                {order.preview_image ? (
                  <a href={order.preview_image} target="_blank" rel="noreferrer" className="pq-preview-link">
                    Ver imagen de preview
                  </a>
                ) : (
                  <span className="pq-preview-empty">No hay preview cargado.</span>
                )}
              </div>
            </div>
          </div>

          <div className="pq-panel pq-payment-panel">
            <div className="pq-panel-title">Confirmación de pago</div>

            {!canConfirmPayment && (
              <div className={`pq-readonly-note ${order.payment_status === "pagado" ? "success" : ""}`}>
                <Icon.Check />
                {readonlyMessage}
              </div>
            )}

            <div className="pq-payment-grid">
              <div className="pq-payment-field">
                <label>Estado del pago</label>
                <select
                  className="pq-input"
                  value={paymentStatus}
                  disabled={!canConfirmPayment || paymentSaving}
                  onChange={event => setPaymentStatus(event.target.value)}
                >
                  <option value="pagado">Pagado</option>
                </select>
              </div>

              <div className="pq-payment-field">
                <label>Recibo o factura</label>
                <label className={`pq-upload-box ${!canConfirmPayment ? "disabled" : ""}`}>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={!canConfirmPayment || paymentSaving}
                    onChange={event => {
                      const nextFile = event.target.files?.[0] || null;
                      setReceiptFile(nextFile);
                      setLocalError("");
                    }}
                  />
                  <span><Icon.Upload /> {receiptFile ? receiptFile.name : "Subir imagen del recibo"}</span>
                </label>
              </div>
            </div>

            {receiptUrl && (
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="pq-receipt-link">
                <Icon.Eye />
                Ver comprobante guardado
              </a>
            )}

            {localError && <div className="pq-inline-error">{localError}</div>}

            <div className="pq-modal-actions">
              <button className="pq-btn pq-btn-secondary" onClick={onClose}>Cerrar</button>
              <button className="pq-btn pq-btn-primary" onClick={handleSubmit} disabled={!canConfirmPayment || paymentSaving}>
                {paymentSaving ? "Confirmando..." : "Confirmar pago"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PageQuote() {
  const navigate = useNavigate();

  // Estados globales del apartado Quote.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [notifications, setNotifications] = useState([]);
  const [toastNotifications, setToastNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sellerDirectory, setSellerDirectory] = useState({});

  // Refs auxiliares para detección de nuevas asignaciones y limpieza de notificaciones.
  const previousAssignedIdsRef = useRef(new Set());
  const previousOrdersRef = useRef({});
  const assignmentsInitializedRef = useRef(false);
  const notificationTimeoutsRef = useRef({});

  // Obtiene la sesión y valida explícitamente el rol quote para esta sección.
  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data?.user;

      if (!currentUser) {
        navigate("/");
        return;
      }

      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("id, name, role")
        .eq("id", currentUser.id)
        .single();

      if (!currentProfile || currentProfile.role !== "quote") {
        await supabase.auth.signOut();
        navigate("/");
        return;
      }

      setUser(currentUser);
      setProfile(currentProfile);
    };

    loadSession();
  }, [navigate]);

  // Suscripción en tiempo real para refrescar automáticamente la bandeja de cotización.
  useEffect(() => {
    if (!user?.id) return undefined;

    fetchOrders(user.id);
    const channel = supabase
      .channel(`quote-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        async (payload) => {
          const nextOrder = payload.new;
          const previousOrder = payload.old;

          if (
            isOrderRelevantToQuote(nextOrder, user.id)
            || isOrderRelevantToQuote(previousOrder, user.id)
          ) {
            await fetchOrders(user.id, true);
          }
        }
      )
      .subscribe();

    return () => {
      Object.values(notificationTimeoutsRef.current).forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Cierra el panel de notificaciones al hacer click fuera.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest(".pq-bell-wrap")) {
        setNotificationsOpen(false);
      }
    };

    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  // Consulta órdenes asignadas al usuario quote tolerando distintos nombres de campo.
  const syncSellerDirectory = async (ordersToSync) => {
    const sellerIds = [...new Set(
      (ordersToSync || [])
        .map(order => resolveSellerId(order))
        .filter(Boolean)
    )];

    if (sellerIds.length === 0) return;

    const missingSellerIds = sellerIds.filter(id => !sellerDirectory[id]);
    if (missingSellerIds.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", missingSellerIds);

    if (!error && Array.isArray(data)) {
      setSellerDirectory(prev => ({
        ...prev,
        ...Object.fromEntries(data.map(profile => [profile.id, profile.name || "Vendedor"]))
      }));
    }
  };

  const fetchOrders = async (quoteUserId, silent = false) => {
    if (!silent) setLoading(true);

    let fetchedOrders = [];
    let fetchError = null;

    for (const field of QUOTE_ASSIGNMENT_FIELDS) {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq(field, quoteUserId)
        .order("created_at", { ascending: false });

      if (!error) {
        fetchedOrders = data || [];
        fetchError = null;
        break;
      }

      fetchError = error;
    }

    // Fallback para escenarios donde el filtro directo no sea compatible con el esquema activo.
    if (fetchError && fetchedOrders.length === 0) {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error) {
        fetchedOrders = (data || []).filter(order => hasQuoteAssignment(order, quoteUserId));
        fetchError = null;
      }
    }

    if (fetchError) {
      setOrders([]);
      if (!silent) setLoading(false);
      showActionNotification({
        type: "cancelled",
        label: "Error al cargar",
        orderTitle: "Órdenes de cotización",
        message: "No se pudieron cargar las órdenes asignadas a cotización.",
      });
      return;
    }

    setOrders(fetchedOrders);
    await syncSellerDirectory(fetchedOrders);
    registerNewAssignments(fetchedOrders);
    if (!silent) setLoading(false);
  };

  // Detecta nuevas órdenes asignadas a Quote y genera notificaciones visuales.
  const registerNewAssignments = (nextOrders) => {
    const previousIds = previousAssignedIdsRef.current;
    const previousOrders = previousOrdersRef.current;
    const nextIds = new Set(nextOrders.map(order => order.id));
    const newOrders = nextOrders.filter(order => !previousIds.has(order.id));

    if (!assignmentsInitializedRef.current) {
      previousAssignedIdsRef.current = nextIds;
      previousOrdersRef.current = nextOrders.reduce((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      assignmentsInitializedRef.current = true;
      return;
    }

    if (newOrders.length > 0) {
      newOrders.forEach(order => {
        createPersistentNotification({
          type: "new",
          label: "Nueva orden asignada",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message: "Se asignó una nueva orden a tu bandeja de cotización.",
        });
      });
    }

    nextOrders.forEach(order => {
      const previousOrder = previousOrders[order.id];
      const wasCancelledBefore = ["cancelada", "cancelled"].includes(previousOrder?.status);
      const isCancelledNow = ["cancelada", "cancelled"].includes(order.status);

      if (previousOrder && !wasCancelledBefore && isCancelledNow) {
        createPersistentNotification({
          type: "cancelled",
          label: "Orden cancelada",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message: "Una de tus órdenes asignadas ha sido cancelada.",
        });
      }
    });

    previousAssignedIdsRef.current = nextIds;
    previousOrdersRef.current = nextOrders.reduce((acc, order) => {
      acc[order.id] = order;
      return acc;
    }, {});
  };

  // Crea notificaciones internas del módulo sin usar localStorage.
  const createPersistentNotification = ({ type, label, orderTitle, message }) => {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification = {
      id,
      type,
      label,
      orderTitle,
      message,
      read: false,
      createdAt: Date.now(),
      duration: NOTIFICATION_DURATION,
      expiresAt: Date.now() + NOTIFICATION_DURATION,
    };

    setNotifications(prev => [notification, ...prev].slice(0, 20));
    setToastNotifications(prev => [notification, ...prev].slice(0, 3));

    notificationTimeoutsRef.current[id] = setTimeout(() => {
      removeToastNotification(id);
    }, NOTIFICATION_DURATION);
  };

  const showActionNotification = ({ type = "completed", label, orderTitle, message }) => {
    createPersistentNotification({ type, label, orderTitle, message });
  };

  const removeToastNotification = (id) => {
    setToastNotifications(prev => prev.filter(notification => notification.id !== id));
    if (notificationTimeoutsRef.current[id]) {
      clearTimeout(notificationTimeoutsRef.current[id]);
      delete notificationTimeoutsRef.current[id];
    }
  };

  const markNotificationAsRead = (id) => {
    setNotifications(prev => prev.map(notification => (
      notification.id === id ? { ...notification, read: true } : notification
    )));
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(notification => ({ ...notification, read: true })));
  };

  // Refresca el detalle desde la base antes de abrir el modal.
  const handleViewOrder = async (order) => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .single();

    const nextOrder = data || order;
    await syncSellerDirectory([nextOrder]);
    setSelectedOrder(nextOrder);
  };

  // Confirma el pago solo si la imagen sube correctamente y existe un campo compatible en la orden.
  const handleConfirmPayment = async ({ order, receiptFile, paymentStatus }) => {
    if (!receiptFile) {
      showActionNotification({
        type: "cancelled",
        label: "Imagen requerida",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "No puedes confirmar el pago sin subir la imagen del recibo o factura.",
      });
      return;
    }

    setPaymentSaving(true);

    const fileName = `${Date.now()}-${receiptFile.name}`;
    const storagePath = `orders/${order.id}/payments/${fileName}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("order-docs")
      .upload(storagePath, receiptFile, { upsert: true });

    if (uploadError || !uploadData) {
      setPaymentSaving(false);
      showActionNotification({
        type: "cancelled",
        label: "Error al subir",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo subir la imagen del comprobante. Inténtalo nuevamente.",
      });
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("order-docs")
      .getPublicUrl(storagePath);

    const receiptUrl = publicUrlData?.publicUrl;
    let updatedOrder = null;
    let updateError = null;

    for (const field of RECEIPT_FIELDS) {
      const { data, error } = await supabase
        .from("orders")
        .update({
          payment_status: paymentStatus,
          [field]: receiptUrl,
        })
        .eq("id", order.id)
        .select("*")
        .single();

      if (!error && data) {
        updatedOrder = data;
        updateError = null;
        break;
      }

      updateError = error;
    }

    setPaymentSaving(false);

    if (updateError || !updatedOrder) {
      showActionNotification({
        type: "cancelled",
        label: "Error al confirmar",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo guardar el comprobante en la orden. Verifica el esquema de la base de datos.",
      });
      return;
    }

    setOrders(prev => prev.map(item => item.id === updatedOrder.id ? updatedOrder : item));
    setSelectedOrder(updatedOrder);

    showActionNotification({
      type: "success",
      label: "Pago confirmado",
      orderTitle: updatedOrder.client_name || updatedOrder.description || `Orden #${updatedOrder.id?.slice(0, 8).toUpperCase()}`,
      message: "El pago fue confirmado correctamente y el comprobante quedó guardado.",
    });
  };

  // Archiva órdenes en el campo específico del rol Quote.
  const handleConfirmArchive = async () => {
    if (!archivingOrder) return;

    setArchiveLoading(true);
    const { error } = await supabase
      .from("orders")
      .update({ is_archived_quote: true })
      .eq("id", archivingOrder.id);
    setArchiveLoading(false);

    if (error) {
      showActionNotification({
        type: "cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo archivar la orden.",
      });
      return;
    }

    const nextOrder = { ...archivingOrder, is_archived_quote: true };
    setOrders(prev => prev.map(order => order.id === archivingOrder.id ? nextOrder : order));
    if (selectedOrder?.id === archivingOrder.id) {
      setSelectedOrder(nextOrder);
    }

    showActionNotification({
      type: "success",
      label: "Orden archivada",
      orderTitle: nextOrder.client_name || nextOrder.description || `Orden #${nextOrder.id?.slice(0, 8).toUpperCase()}`,
      message: "La orden fue archivada correctamente.",
    });

    setArchivingOrder(null);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Filtros principales del módulo, alineados con la lógica de Designer.
  const filteredOrders = useMemo(() => {
    const query = normalizeText(search);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return orders.filter(order => {
      const searchableValues = [
        order.client_name,
        order.description,
        order.id,
        order.material,
        resolveSellerName(order, sellerDirectory),
      ];

      const matchesSearch = !query || searchableValues.some(value => normalizeText(value).includes(query));
      const matchesStatus = filterStatus === "all" || order.status === filterStatus;
      const matchesArchive =
        filterArchive === "all" ||
        (filterArchive === "active" && !order.is_archived_quote) ||
        (filterArchive === "archived" && order.is_archived_quote);

      const createdAt = new Date(order.created_at);
      const matchesDate =
        filterDate === "all" ||
        (filterDate === "today" && createdAt >= startOfToday) ||
        (filterDate === "yesterday" && createdAt >= startOfYesterday && createdAt < startOfToday) ||
        (filterDate === "3days" && createdAt >= threeDaysAgo) ||
        (filterDate === "7days" && createdAt >= sevenDaysAgo) ||
        (filterDate === "month" && createdAt >= startOfMonth);

      return matchesSearch && matchesStatus && matchesArchive && matchesDate;
    });
  }, [orders, search, filterStatus, filterArchive, filterDate]);

  const unreadCount = notifications.filter(notification => !notification.read).length;
  const shouldEnableOrdersScroll = filteredOrders.length > 7;

  const metrics = [
    { label: "Órdenes asignadas", value: orders.length, icon: <Icon.Orders /> },
    { label: "Pendientes de pago", value: orders.filter(order => order.payment_status !== "pagado" && !order.is_archived_quote).length, icon: <Icon.Money /> },
    { label: "Pagadas", value: orders.filter(order => order.payment_status === "pagado").length, icon: <Icon.Check /> },
    { label: "Archivadas", value: orders.filter(order => order.is_archived_quote).length, icon: <Icon.Archive /> },
  ];

  const menuItems = [
    { id: "dashboard", label: "Resumen", icon: <Icon.Dashboard /> },
    { id: "orders", label: "Mis órdenes", icon: <Icon.Orders />, badge: orders.filter(order => !order.is_archived_quote).length },
  ];

  const dashboardRecentOrders = orders
    .filter(order => !order.is_archived_quote)
    .slice(0, 4);

  return (
    <div className="pq-root">
      <Sidebar
        isOpen={sidebarOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        role="Quote"
        userName={profile?.name || "Usuario Quote"}
        menuItems={menuItems}
        onLogout={handleLogout}
      />

      <main className="pq-main">
        <header className="pq-header">
          <div className="pq-header-left">
            <button className="pq-mobile-toggle" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Toggle sidebar">
              <Icon.Menu />
            </button>
            <div>
              <span className="pq-header-kicker">Cotización</span>
              {/* Nombre del apartado de la pantalla */}
              <h1 className="pq-header-title">
                {activeTab === "dashboard" ? "Panel de Quote" : "Mis órdenes de cotización"}
              </h1>
            </div>
          </div>

          <div className="pq-header-actions">
            <div className="pq-bell-wrap">
              <button className="pq-bell-btn" onClick={(event) => {
                event.stopPropagation();
                setNotificationsOpen(prev => !prev);
              }}>
                <Icon.Bell />
                {unreadCount > 0 && <span className="pq-bell-count">{unreadCount}</span>}
              </button>

              {notificationsOpen && (
                <div className="pq-notification-panel" onClick={event => event.stopPropagation()}>
                  <div className="pq-notification-panel-head">
                    <div>
                      <strong>Notificaciones</strong>
                      <span>{unreadCount} sin leer</span>
                    </div>
                    {notifications.length > 0 && (
                      <button className="pq-link-btn" onClick={markAllNotificationsAsRead}>Marcar todas</button>
                    )}
                  </div>

                  <div className="pq-notification-panel-body">
                    {notifications.length === 0 ? (
                      <div className="pq-empty-notification">No hay notificaciones por ahora.</div>
                    ) : (
                      notifications.map(notification => (
                        <div key={notification.id} className={`pq-notification-item ${notification.read ? "read" : "unread"}`}>
                          <div className="pq-notification-copy">
                            <strong>{notification.label}</strong>
                            <span>{notification.orderTitle}</span>
                            <p>{notification.message}</p>
                          </div>
                          {!notification.read && (
                            <button className="pq-link-btn" onClick={() => markNotificationAsRead(notification.id)}>
                              Leída
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {activeTab === "dashboard" ? (
          <section className="pq-section">
            <div className="pq-metrics-grid">
              {metrics.map(metric => (
                <article key={metric.label} className="pq-metric-card">
                  <div className="pq-metric-icon">{metric.icon}</div>
                  <div className="pq-metric-copy">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                </article>
              ))}
            </div>

            <div className="pq-panel pq-recent-panel">
              <div className="pq-panel-head">
                <div>
                  <span className="pq-section-kicker">Actividad reciente</span>
                  <h2>Órdenes para Cotizar <span className="pq-orders-count">({dashboardRecentOrders.length})</span></h2>
                </div>
                <button className="pq-link-btn" onClick={() => setActiveTab("orders")}>Ver todas</button>
              </div>

              {loading ? (
                <div className="pq-empty-panel">Cargando órdenes...</div>
              ) : dashboardRecentOrders.length === 0 ? (
                <div className="pq-empty-panel">No hay órdenes asignadas actualmente.</div>
              ) : (
                <div className="pq-recent-list">
                  {dashboardRecentOrders.map(order => (
                    <button key={order.id} type="button" className="pq-recent-item" onClick={() => handleViewOrder(order)}>
                      <div className="pq-recent-primary">
                      <div className="pq-recent-item-header">
                        <span className="pq-recent-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                        <span className="pq-recent-client">{order.client_name || "Cliente sin nombre"}</span>
                      </div>
                      </div>
                      <div className="pq-recent-item-footer">
                        <div className="pq-recent-badges">
                          <StatusBadge status={order.status} />
                          <PaymentBadge status={order.payment_status} />
                        </div>
                        <span className="pq-recent-view-btn" aria-hidden="true">
                          <Icon.Eye />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : (
          // Vista de listado principal de órdenes, con filtros y búsqueda.
          <section className="pq-section">
            {/* Filtros y búsqueda */}
            <div className="pq-filters">
              <div className="pq-search-box">
                <Icon.Search />
                <input
                  type="text"
                  className="pq-search-input"
                  placeholder="Buscar por cliente, ID, vendedor o descripción..."
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </div>

              <select className="pq-input" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
                <option value="all">Todos los estados</option>
                <option value="cotizacion">Cotización</option>
                <option value="in_Quotation">Cotización (legacy)</option>
                <option value="en produccion">En producción</option>
                <option value="cancelada">Cancelada</option>
                <option value="cancelled">Cancelada (EN)</option>
                <option value="completada">Completada</option>
              </select>

              <select className="pq-input" value={filterDate} onChange={event => setFilterDate(event.target.value)}>
                <option value="all">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="yesterday">Ayer</option>
                <option value="3days">Últimos 3 días</option>
                <option value="7days">Últimos 7 días</option>
                <option value="month">Este mes</option>
              </select>

              <select className="pq-input" value={filterArchive} onChange={event => setFilterArchive(event.target.value)}>
                <option value="active">Activas</option>
                <option value="archived">Archivadas</option>
                <option value="all">Todas</option>
              </select>

              <span className="pq-results-count">{filteredOrders.length} orden{filteredOrders.length !== 1 ? "es" : ""}</span>
            </div>

            {loading ? (
              <div className="pq-empty-panel">Cargando órdenes...</div>
            ) : filteredOrders.length === 0 ? (
              <div className="pq-empty-panel">No hay órdenes que coincidan con los filtros.</div>
            ) : (
              <div className={`pq-orders-grid ${shouldEnableOrdersScroll ? "pq-orders-scroll" : ""}`}>
                {filteredOrders.map(order => (
                  <article key={order.id} className="pq-order-card">
                    <div className="pq-order-top">
                      <div className="pq-order-identity">
                        <span className="pq-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                        <span className="pq-order-date">
                          <Icon.Clock /> {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <div className="pq-order-badges">
                        <StatusBadge status={order.status} />
                        <PaymentBadge status={order.payment_status} />
                      </div>
                    </div>

                    <div className="pq-order-heading">
                      <div className="pq-order-client">{order.client_name || "Cliente sin nombre"}</div>
                      <div className="pq-order-description">{order.description || "Sin descripción"}</div>
                    </div>

                    <div className="pq-order-meta">
                      <span><Icon.User /> {resolveSellerName(order, sellerDirectory)}</span>
                      <span><Icon.File /> {order.material || "Material no definido"}</span>
                    </div>
                    {/* Acciones de la orden */}
                    <div className="pq-order-footer">
                      {/* Botón para ver detalles de la orden */}
                      <button className="pq-btn pq-btn-ghost" onClick={() => handleViewOrder(order)}>
                        <Icon.Eye />
                        Ver detalles
                      </button>
                      {/* Botón para archivar la orden */}
                      {!order.is_archived_quote && ["cancelada", "cancelled"].includes(order.status) &&(
                        <button
                          className="pq-btn pq-btn-inline-archive"
                          onClick={() => setArchivingOrder(order)}
                        >
                          <Icon.Archive />
                          Archivar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <QuoteOrderDetailModal
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        onConfirmPayment={handleConfirmPayment}
        paymentSaving={paymentSaving}
        sellerDirectory={sellerDirectory}
      />

      <ArchiveQuoteOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchive}
        order={archivingOrder}
        loading={archiveLoading}
      />

      <div className="pq-toast-stack">
        {toastNotifications.map(notification => (
          <QuoteNotificationToast key={notification.id} notification={notification} onClose={removeToastNotification} />
        ))}
      </div>
    </div>
  );
}
