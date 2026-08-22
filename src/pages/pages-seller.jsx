import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-seller.css";
import "../css-components/page-production.css";
import "../css-components/page-quote.css";
import Sidebar from "../components/Sidebar";
import { Icons } from "../utils/icons";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import CreateClientModal from "../components/ui/CreateClientModal";
import {
  canArchiveOrder,
} from "../utils/archive";
import { StatusBadge as SharedStatusBadge, PaymentBadge } from "../components/ui/Badge";
import { AssignModal } from "../components/ui/AssignModal";
import { Pagination } from "../components/ui/Pagination";
import { SalesFilterToolbar } from "../components/ui/SalesFilterToolbar";
import {
  ORDER_STATUS,
  isPaymentCredit,
  isPaymentPaid,
  isPaymentPartial,
  PAYMENT_COLORS,
  STATUS_OPTIONS,
  ARCHIVE_MODULES,
  getOrderStatusConfig,
  isOrderStatus,
  isOrderStatusIn,
} from "../utils/constants";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import useOrderEventReviews from "../hooks/useOrderEventReviews";
import useOrderReturnHandoffs from "../hooks/useOrderReturnHandoffs";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";
import NotificationCenter from "../components/NotificationCenter";
import SharedCreateOrderModal from "../components/orders/CreateOrderModal";
import SharedEditOrderModal from "../components/orders/EditOrderModal";
import SharedOrderDetailModal from "../components/orders/OrderDetailModal";
import OrderReviewBadge from "../components/orders/OrderReviewBadge";
import OrderAssignmentAction from "../components/orders/OrderAssignmentAction";
import SellerProfileModule from "../components/seller/SellerProfileModule";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import "../components/designer/DesignerNotificationsModule.css";
import { loadClients, searchClients } from "../utils/clients";
import { adminApiFetch } from "../utils/adminApi";
import { getAvatarInitials } from "../utils/avatar-initials";
import ReturnToCashierModal from "../components/orders/ReturnToCashierModal";

export { default as OrderDetailModal } from "../components/orders/OrderDetailModal";

const isReturnedOrder = (order) => {
  if (!order || !order.return_reason) return false;
  const validStatuses = order.order_design_type === "EXTERNAL_DESING"
    ? [ORDER_STATUS.PENDING]
    : [ORDER_STATUS.IN_DESIGN];
  return isOrderStatusIn(order.status, validStatuses);
};

const canSellerEditOrder = (order) => (
  Boolean(order) &&
  !order.is_archived &&
  !isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
);

const isInteractiveOrderRowTarget = (target) => Boolean(
  target?.closest?.("button, a, input, select, textarea, [data-row-action]")
);

const SELLER_HIDDEN_NOTIFICATION_EVENTS = new Set([
  "admin_edited_order",
  "designer_assigned",
  "quote_assigned",
]);

const ACTIVE_WORKFLOW_STATUSES_FOR_SELLER = [
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.CANCELLED,
];

const SELLER_ORDER_PAGE_SIZE = 15;
const SELLER_CARD_PAGE_SIZE = 10;
const EMPTY_SELLER_SUMMARY = {
  todayOrders: 0,
  pending: 0,
  inDesign: 0,
  inQuote: 0,
  inProduction: 0,
  inTermination: 0,
  completed: 0,
  returned: 0,
  active: 0,
  unarchived: 0,
};

const isSellerVisibleNotification = (notification) => {
  const eventKind = notification?.metadata?.event_kind;
  return !SELLER_HIDDEN_NOTIFICATION_EVENTS.has(eventKind);
};

const PHONE_PLACEHOLDER = "Seleccionar Cliente";

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
  { color: "#1E40AF", bg: "#dbeafe", glow: "#dbeafe" },
];






function StatusBadge({ status, type = "status" }) {
  if (type === "payment") {
    return <PaymentBadge status={status} className="ps-badge" bordered />;
  }
  return <SharedStatusBadge status={status} className="ps-badge" showDot bordered />;
}

// CARTA DE METRICA PARA DASHBOARD
function MetricCard({ icon, label, value, sub, accentIdx = 0, trend, subColor }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="ps-card">
      <div className="ps-card-glow" style={{ background: acc.glow }} />
      {trend !== undefined && <span className="ps-trend-badge"><Icons.TrendUp /> +{trend}%</span>}
      <div className="ps-card-icon" style={{ background: acc.bg, color: acc.color }}>{icon}</div>
      <div className="ps-card-value">{value}</div>
      <div className="ps-card-label">{label}</div>
      {sub && <div className="ps-card-sub" style={{ color: subColor || acc.color }}>{sub}</div>}
    </div>
  );
}

//OVERLAY DE LOS MODALES, RECIBE PROPS DE CONTROL Y CONTENIDO
function Modal({ open, onClose, title, children, wide, stickyHeader = false }) {
  if (!open) return null;
  return (
    // onClick={e => e.target === e.currentTarget && onClose()}
    // Overlay del modal de crear video 
    <div className="ps-modal-overlay">
      <div className={`ps-modal ${wide ? "wide" : "narrow"}`}>
        <div className="ps-modal-stripe" />
        <div className={`ps-modal-header ${stickyHeader ? "is-sticky" : ""}`}>
          <span className="ps-modal-title">{title}</span>
          <button className="ps-modal-close" onClick={onClose}><Icons.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}

// CAMPO DE FORMULARIO QUE RECIBE VALORES
function ReturnedBadge({ compact = false }) {
  return (
    <span className={`ps-returned-badge${compact ? " compact" : ""}`} title="Orden devuelta desde caja">
      Devuelta
    </span>
  );
}

function CancelOrderModal({ open, onClose, onConfirm, order, loading }) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);
  
  const isPaid = isPaymentPaid(order?.payment_status);
  const isPartial = isPaymentPartial(order?.payment_status);
  const isCredit = isPaymentCredit(order?.payment_status);

  return (
    <Modal open={open} onClose={onClose} title="Cancelar Orden">
      <div style={{ minWidth: 350, paddingTop: 8 }}>
        {isPaid || isPartial || isCredit ? (
          <>
            <p style={{ fontSize: 14, color: "#991B1B", marginBottom: 16, lineHeight: 1.5, fontWeight: 500 }}>
              âš ï¸ No se puede cancelar esta orden
            </p>
            <p style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 20, lineHeight: 1.5 }}>
              {isPartial
                ? "Esta orden tiene pago parcial. No se puede cancelar hasta que este totalmente pagada."
                : "Esta orden ya ha sido pagada. No se permite cancelar ordenes con pago confirmado. Si necesitas anular esta orden, contacta con el administrador."}
            </p>
            {order && (
              <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                Orden #{order.id?.slice(0, 8)} - {order.client_name}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button 
                className="ps-btn-cancel" 
                onClick={onClose}
              >
                Entendido
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "#4A5E80", marginBottom: 16, lineHeight: 1.5 }}>
              Estas seguro de que deseas cancelar esta orden?{order && (
                <span style={{ display: "block", marginTop: 8, fontWeight: 500, color: "#0f1e40" }}>
                  Orden #{order.id?.slice(0, 8)} - {order.client_name}
                </span>
              )}
            </p>
            <p style={{ fontSize: 13, color: "#8899B5", marginBottom: 20, lineHeight: 1.5 }}>
              El estado de la orden cambiara a "Cancelada" y esta accion no podra ser revertida facilmente.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f1e40", marginBottom: 8 }}>
                Motivo de cancelacion
              </label>
              <textarea
                className="ps-form-input textarea"
                placeholder="Describe por que se cancela esta orden..."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={loading}
                rows={4}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button 
                className="ps-btn-cancel" 
                onClick={onClose}
                disabled={loading}
              >
                Mantener orden
              </button>
              <button 
                className="ps-btn-submit" 
                onClick={() => onConfirm(reason)}
                disabled={loading || !reason.trim()}
                style={{ background: "#EF4444", border: "1px solid #DC2626" }}
              >
                {loading ? "Cancelando..." : "Si, cancelar orden"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// â”€â”€â”€ ARCHIVAR ORDEN VENTANA DE CONFIRMACION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€




// â”€â”€â”€ MAIN PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function PageSeller() {
  const navigate = useNavigate();
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sellerSummary, setSellerSummary] = useState(EMPTY_SELLER_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterArchive, setFilterArchive] = useState("all");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState("table");
  const [showCreate, setShowCreate] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [clientToSelectInOrderForm, setClientToSelectInOrderForm] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cancelingOrder, setCancelingOrder] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [sendingToDesigner, setSendingToDesigner] = useState(null);
  const [sendingToQuotation, setSendingToQuotation] = useState(null);
  const [sendingLoading, setSendingLoading] = useState(false);
  const [returningToCashier, setReturningToCashier] = useState(null);
  const [returningToCashierLoading, setReturningToCashierLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimeoutRef = useRef(null);
  const ordersRequestIdRef = useRef(0);
  const visibleOrdersLoadIdRef = useRef(0);
  const visibleOrdersLoadingRef = useRef(false);
  const notif = useNotifications(user?.id);
  const orderReviews = useOrderEventReviews(user?.id);
  const orderReturns = useOrderReturnHandoffs(user?.id);
  const pendingOrderReviews = orderReviews.pendingByOrder;
  const selectedOrderReview = selectedOrder ? pendingOrderReviews[selectedOrder.id] || null : null;
  const showToast = useCallback((message, type = "success") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMsg({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToastMsg(null), 1500);
  }, []);

  useEffect(() => () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  const runSellerOrderAction = useCallback(async (action, payload = {}) => {
    const { response, result } = await adminApiFetch("/api/seller-orders", {
      action,
      ...payload,
    });

    if (!response.ok) {
      throw new Error(result?.error || "No se pudo completar la accion.");
    }

    return result;
  }, []);

  const fetchOrders = useCallback(async ({
    nextPage = page,
    includeDashboard = true,
    silent = false,
  } = {}) => {
    if (!authUser?.id) {
      setOrders([]);
      setRecentOrders([]);
      setOrdersTotal(0);
      setTotalPages(1);
      setSellerSummary(EMPTY_SELLER_SUMMARY);
      visibleOrdersLoadingRef.current = false;
      setLoading(false);
      return;
    }

    const requestId = ordersRequestIdRef.current + 1;
    ordersRequestIdRef.current = requestId;
    const isVisibleLoad = !silent;
    const visibleLoadId = isVisibleLoad ? visibleOrdersLoadIdRef.current + 1 : null;
    if (isVisibleLoad) {
      visibleOrdersLoadIdRef.current = visibleLoadId;
      visibleOrdersLoadingRef.current = true;
      setLoading(true);
    }

    try {
      const isReturnedFilter = filterArchive === "returned";
      const result = await runSellerOrderAction("list", {
        page: isReturnedFilter ? 1 : nextPage,
        pageSize: isReturnedFilter ? 500 : (viewMode === "cards" ? SELLER_CARD_PAGE_SIZE : SELLER_ORDER_PAGE_SIZE),
        search: debouncedSearch,
        status: filterStatus,
        paymentStatus: filterPayment,
        clientId: filterClient,
        archive: isReturnedFilter ? "all" : filterArchive,
        dateFilter: filterDate,
        includeDashboard,
      });

      if (requestId !== ordersRequestIdRef.current) return;

      const rawOrders = Array.isArray(result?.orders) ? result.orders : [];
      const nextOrders = isReturnedFilter ? rawOrders.filter(o => isReturnedOrder(o)) : rawOrders;
      const filteredTotal = isReturnedFilter ? nextOrders.length : (Number(result?.total) || 0);
      const filteredPageSize = viewMode === "cards" ? SELLER_CARD_PAGE_SIZE : SELLER_ORDER_PAGE_SIZE;
      const resolvedTotalPages = Math.max(isReturnedFilter
        ? Math.ceil(nextOrders.length / filteredPageSize)
        : Number(result?.totalPages) || 1, 1);

      if (nextPage > resolvedTotalPages) {
        setPage(resolvedTotalPages);
        return;
      }

      setOrders(nextOrders);
      setRecentOrders(Array.isArray(result?.recent_orders) ? result.recent_orders : []);
      setOrdersTotal(filteredTotal);
      setTotalPages(resolvedTotalPages);
      setSellerSummary({ ...EMPTY_SELLER_SUMMARY, ...(result?.summary || {}) });
      if (Number(result?.page) && Number(result.page) !== page) setPage(Number(result.page));
      setSelectedOrder((current) => {
        if (!current?.id) return current;
        return nextOrders.find((order) => order.id === current.id) || current;
      });
    } catch (error) {
      if (requestId !== ordersRequestIdRef.current) return;
      if (silent) {
        console.warn("No se pudo refrescar ordenes en segundo plano:", error?.message || error);
      } else {
        showToast(error?.message || "No se pudieron cargar las ordenes", "error");
        setOrders([]);
        setRecentOrders([]);
        setOrdersTotal(0);
        setTotalPages(1);
        setSellerSummary(EMPTY_SELLER_SUMMARY);
      }
    } finally {
      if (isVisibleLoad && visibleLoadId === visibleOrdersLoadIdRef.current) {
        visibleOrdersLoadingRef.current = false;
        setLoading(false);
      }
    }
  }, [
    authUser?.id,
    debouncedSearch,
    filterArchive,
    filterClient,
    filterDate,
    filterPayment,
    filterStatus,
    page,
    runSellerOrderAction,
    viewMode,
    showToast,
  ]);

  const openOrderDetail = useCallback((order) => {
    setSelectedOrder(order);
  }, []);




  // Carga inicial + listener de sesiÃ³n
  useEffect(() => {
    if (!authUser) {
      setUser(null);
      setOrders([]);
      setRecentOrders([]);
      setOrdersTotal(0);
      setTotalPages(1);
      setSellerSummary(EMPTY_SELLER_SUMMARY);
      return;
    }

    const displayName =
      authUser.user_metadata?.display_name ||
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.user_metadata?.first_name ||
      authUser.email?.split("@")[0];

    setUser({ ...authUser, displayName });
  }, [authUser]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterDate, filterStatus, filterPayment, filterClient, filterArchive]);

  useEffect(() => {
    setPage(1);
  }, [viewMode]);

  useEffect(() => {
    fetchOrders({ nextPage: page, includeDashboard: true });
  }, [fetchOrders, page]);

  // SincronizaciÃ³n en tiempo real + refresco al volver a la pÃ¡gina
  const sellerUserId = user?.id;
  const refreshSellerOrdersSilently = useCallback(async () => {
    if (!sellerUserId) return;
    if (visibleOrdersLoadingRef.current) return;
    await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });
  }, [fetchOrders, page, sellerUserId]);

  useOrdersRealtimeSync({
    userId: sellerUserId,
    scope: "seller",
    refreshOrders: refreshSellerOrdersSilently,
  });

  useEffect(() => {
    supabase.from("materials").select("name").order("name").then(({ data }) => {
      setMaterialOptions(data?.map(m => m.name) || []);
    });
    setClientsLoading(true);
    loadClients(supabase)
      .then(setClients)
      .finally(() => setClientsLoading(false));
  }, []);

  const handleClientSearch = useCallback(async (query) => {
    const results = await searchClients(supabase, query);
    setClients((prev) => {
      const byId = new Map(prev.map((client) => [client.id, client]));
      results.forEach((client) => byId.set(client.id, client));
      return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    return results;
  }, []);

  const handleLogout = async () => { await signOut(); navigate("/"); };

  const handleNewClientCreated = async (newClient) => {
    setClients(prev => {
      const exists = prev.some(c => c.id === newClient.id);
      return exists ? prev : [...prev, newClient].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    if (showCreate) {
      setClientToSelectInOrderForm(newClient);
    }
    showToast("Cliente creado correctamente.");
  };

  // â”€â”€ Funcion para cancelar orden â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCancelOrder = (order) => {
    if (isPaymentPartial(order?.payment_status)) {
      showToast("No se puede cancelar una orden con pago parcial", "error");
      return;
    }

    // ValidaciÃ³n: No permitir cancelar Ã³rdenes pagadas
    if (isPaymentPaid(order?.payment_status)) {
      showToast("No se puede cancelar una orden que ya ha sido pagada", "error");
      return;
    }
    setCancelingOrder(order);
  };

  const handleConfirmCancel = async (reason) => {
    if (!cancelingOrder) return;
    
    // ValidaciÃ³n adicional: Verificar nuevamente que no estÃ© pagada
    if (isPaymentPartial(cancelingOrder?.payment_status)) {
      showToast("No se puede cancelar una orden con pago parcial", "error");
      setCancelingOrder(null);
      return;
    }

    if (isPaymentPaid(cancelingOrder?.payment_status)) {
      showToast("No se puede cancelar una orden que ya ha sido pagada", "error");
      setCancelingOrder(null);
      return;
    }
    
    if (!String(reason || "").trim()) {
      showToast("Debes indicar el motivo de cancelacion", "error");
      return;
    }
    
    setCancelLoading(true);
    try {
      const result = await runSellerOrderAction("cancel", {
        order_id: cancelingOrder.id,
        reason: String(reason).trim(),
      });

      setCancelingOrder(null);
      if (result?.order) setSelectedOrder((current) => current?.id === result.order.id ? result.order : current);
      await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });
      await notif.refresh({ showNewToasts: true });
    } catch (error) {
      showToast(error?.message || "Error al cancelar la orden", "error");
    } finally {
      setCancelLoading(false);
    }
  };

  // â”€â”€ Ver detalles de orden â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleViewOrder = useCallback(async (order) => {
    if (!order?.id) return;

    try {
      const result = await runSellerOrderAction("detail", { order_id: order.id });
      openOrderDetail(result?.order || order);
    } catch (error) {
      showToast(error?.message || "No se pudo cargar el detalle de la orden", "error");
      openOrderDetail(order);
    }
  }, [openOrderDetail, runSellerOrderAction, showToast]);

  const handleSellerOrderRowClick = useCallback((event, order) => {
    if (isInteractiveOrderRowTarget(event.target)) return;
    handleViewOrder(order);
  }, [handleViewOrder]);

  const handleSellerOrderRowKeyDown = useCallback((event, order) => {
    if (!["Enter", " "].includes(event.key)) return;
    if (isInteractiveOrderRowTarget(event.target)) return;
    event.preventDefault();
    handleViewOrder(order);
  }, [handleViewOrder]);

  // â”€â”€ Enviar a DiseÃ±o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSendToDesigner = (order) => {
    setSendingToDesigner(order);
  };

  // â”€â”€ Enviar a CotizaciÃ³n (DiseÃ±o Externo) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSendToQuotation = (order) => {
    setSelectedOrder(null);
    setSendingToQuotation(order);
  };

  const handleConfirmSendToQuotation = async (quoteUserId) => {
    if (!sendingToQuotation) return;

    setSendingLoading(true);

    try {
      await runSellerOrderAction("send_to_quote", {
        order_id: sendingToQuotation.id,
        quote_user_id: quoteUserId,
      });

      setSendingToQuotation(null);
      setSelectedOrder(null);
      await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });
      await notif.refresh({ showNewToasts: true });
    } catch (error) {
      showToast(error?.message || "Error al enviar a caja", "error");
    } finally {
      setSendingLoading(false);
    }
  };

  const handleReturnToCashier = async (correctionNote) => {
    if (!returningToCashier) return;
    setReturningToCashierLoading(true);
    const { error } = await supabase.rpc("return_order_to_cashier", {
      p_handoff_id: returningToCashier.id,
      p_correction_note: correctionNote,
    });
    setReturningToCashierLoading(false);
    if (error) {
      showToast(error.message || "No se pudo regresar la orden a Caja", "error");
      return;
    }
    setReturningToCashier(null);
    setSelectedOrder(null);
    await Promise.all([
      fetchOrders({ nextPage: page, includeDashboard: true, silent: true }),
      orderReturns.refresh(),
      notif.refresh({ showNewToasts: true }),
    ]);
  };

  const handleConfirmSendToDesigner = async (designerId) => {
    if (!sendingToDesigner) return;

    setSendingLoading(true);

    try {
      const result = await runSellerOrderAction("send_to_designer", {
        order_id: sendingToDesigner.id,
        designer_id: designerId,
      });

      setSendingToDesigner(null);
      await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });
      await notif.refresh({ showNewToasts: true });

      if (result?.order) {
        setSelectedOrder(result.order);
      }
    } catch (err) {
      console.error("Error inesperado:", err);
      showToast(`Error inesperado: ${err.message}`, "error");
    } finally {
      setSendingLoading(false);
    }
  };


  // â”€â”€ Funcion para archivar orden â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleArchiveOrder = (order) => {
    if (!canArchiveOrder(order, ARCHIVE_MODULES.SELLER, user?.id)) return;
    setArchivingOrder(order);
  }
 
  // Funcion por si el usuario confirma el archivado
  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;

    setArchiveLoading(true);
    try {
      const result = await runSellerOrderAction("archive", { order_id: archivingOrder.id });
      if (result?.order) setSelectedOrder((current) => current?.id === result.order.id ? result.order : current);
      await fetchOrders({ nextPage: page, includeDashboard: true, silent: true });
      setArchivingOrder(null);
    } catch (error) {
      showToast(error?.message || "Error al archivar la orden", "error");
    } finally {
      setArchiveLoading(false);
    }
  };

  // â”€â”€ Metrics Values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const safePage = Math.min(page, totalPages);
  const activeOrdersCount = sellerSummary.active;
  const returnedOrdersCount = orders.filter(o => isReturnedOrder(o)).length;
  const editedOrdersCount = orders.filter(o => o?.metadata?.event_kind === "admin_edited_order").length;
  const activeOrders = useMemo(() => orders.filter(o => !o.is_archived), [orders]);
  const archivedOrders = useMemo(() => orders.filter(o => o.is_archived), [orders]);
  const returnedOrders = useMemo(() => orders.filter(o => isReturnedOrder(o)), [orders]);

  const visibleSellerNotifications = useMemo(
    () => notif.notifications.filter(isSellerVisibleNotification),
    [notif.notifications]
  );

  const visibleSellerToasts = useMemo(
    () => notif.toasts.filter(isSellerVisibleNotification),
    [notif.toasts]
  );

  const visibleSellerUnreadCount = useMemo(
    () => visibleSellerNotifications.filter((notification) => !notification.is_read && !notification.is_archived).length,
    [visibleSellerNotifications]
  );

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Ordenes", icon: <Icons.Orders />, badge: sellerSummary.unarchived },
    { id: "profile", label: "Mi Perfil", icon: <Icons.User /> },
    { id: "notifications", label: "Notificaciones", icon: <Icons.Bell />, badge: visibleSellerUnreadCount },
  ];
  const pageTitles = {
    dashboard: "Dashboard",
    orders: "Gestion de Ordenes",
    notifications: "Notificaciones",
    profile: "Mi Perfil",
  };

  // Valores para las cartas metricas
  const metrics = [
    { icon: <Icons.Orders />, label: "Ordenes hoy", value: sellerSummary.todayOrders, sub: "Creadas por ti", accentIdx: 0, subColor: "#1E40AF" },
    { icon: <Icons.Package />, label: "Pendientes", value: sellerSummary.pending, sub: "Ordenes Pendientes", accentIdx: 1 },
    { icon: <Icons.Edit />, label: "En diseño", value: sellerSummary.inDesign, sub: "En proceso de diseño", accentIdx: 2 },
    { icon: <Icons.Package />, label: "En caja", value: sellerSummary.inQuote, sub: "Esperando aprobación", accentIdx: 5 },
    { icon: <Icons.Package />, label: "En producción", value: sellerSummary.inProduction, sub: "Siendo impresas", accentIdx: 3 },
    { icon: <Icons.Package />, label: "Terminación", value: sellerSummary.inTermination, sub: "En proceso final", accentIdx: 2 },
    { icon: <Icons.Truck />, label: "Completadas", value: sellerSummary.completed, sub: "Entregadas al cliente", accentIdx: 4 },
    { icon: <Icons.X />, label: "Devueltas", value: sellerSummary.returned, sub: "Pendientes de corrección", accentIdx: 3 },
  ];

  return (
    <div className="ps-root">

      {/* â”€â”€ SIDEBAR â”€â”€ */}
      <Sidebar 
        isOpen={sidebarOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        role="Vendedor"
        userName={user?.email?.split('@')[0] || "Vendedor"}
        menuItems={nav.map(item => ({ ...item, icon: item.icon }))}
        onLogout={handleLogout}
        onCreateNew={() => setShowCreate(true)}
        showCreateButton={false}
      />

      {/* â”€â”€ MAIN â”€â”€ */}
      <div className="ps-main-wrap">
        <header className="ps-topbar">
          <div className="ps-topbar-left">
            <button className="ps-icon-btn" onClick={() => setSidebarOpen(p => !p)}>
              {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
            </button>
            <div>
              <div className="ps-page-title">{pageTitles[activeTab] || "Dashboard"}</div>
              <div className="ps-page-date">{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          </div>
          <div className="ps-topbar-right">
            <button className="ps-icon-btn" onClick={() => fetchOrders({ nextPage: page, includeDashboard: true })}><Icons.Refresh /></button>
            {/* Boton para agregar  registrar Nuevo Cliente */}
    <button className="ps-topbar-client-btn" onClick={() => setShowNewClientModal(true)}>
      <div className="ps-topbar-client-inner"><Icons.Users /> Nuevo Cliente</div>
    </button>
            {/* Boton para regitrar Nueva Orden */}
             <button className="ps-topbar-new-btn" onClick={() => setShowCreate(true)}>
              <div className="ps-topbar-new-inner"><Icons.Plus /> Nueva Orden</div>
              <div className="ps-topbar-new-stripe" />
            </button>
            <NotificationCenter
              notifications={visibleSellerNotifications}
              unreadCount={visibleSellerUnreadCount}
              toasts={visibleSellerToasts}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDismissToast={notif.dismissToast}
              onViewAll={() => setActiveTab("notifications")}
            />
          </div>
        </header>

        <main className="ps-main">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <>
              <div className="ps-greeting">
                <div className="ps-greeting-copy">
                  <h2>Bienvenido, <span>{user?.displayName || "Vendedor"}</span></h2>
                  <p>Aqui tienes el resumen de tu actividad de hoy.</p>
                  <div className="ps-greeting-badges">
                    <div className="ps-greeting-count" aria-label={`${activeOrdersCount} ordenes activas`}>
                      <Icons.Orders />
                      <strong>{activeOrdersCount.toLocaleString("es-DO")}</strong> Ordenes activas
                    </div>
                    <div className="ps-greeting-count ps-greeting-count--returned" aria-label={`${returnedOrdersCount} órdenes devueltas`}>
                      <Icons.ArrowLeft />
                      <strong>{returnedOrdersCount.toLocaleString("es-DO")}</strong> Devueltas
                    </div>
                    <div className="ps-greeting-count ps-greeting-count--edited" aria-label={`${editedOrdersCount} órdenes editadas por administrador`}>
                      <Icons.Edit />
                      <strong>{editedOrdersCount.toLocaleString("es-DO")}</strong> Editadas por Administrador
                    </div>
                  </div>
                </div>
                <div className="ps-greeting-actions" aria-label="Acciones principales de ventas">
                  <button type="button" className="ps-greeting-btn primary" onClick={() => setShowCreate(true)}>
                    <Icons.Plus />
                    Crear Ordenes
                  </button>
    <button type="button" className="ps-greeting-btn secondary" onClick={() => setShowNewClientModal(true)}>
      <Icons.Users />
      Nuevo Cliente
    </button>
                </div>
              </div>
              <div className="ps-metrics">
                {metrics.map((m, i) => <MetricCard key={i} {...m} />)}
              </div>
              <div className="ps-panel">
                <div className="ps-panel-stripe" />
                <div className="ps-panel-header">
                  <div>
                    <div className="ps-panel-title">Ordenes recientes</div>
                    <div className="ps-panel-sub">Las ultimas 5 ordenes ingresadas al sistema</div>
                  </div>
                  <button className="ps-link-btn" onClick={() => setActiveTab("orders")}>
                    Ver todas <Icons.ArrowRight />
                  </button>
                </div>
                <div className="ps-table-wrap">
                  <table className="ps-table">
                    <thead><tr>{["Cliente", "Facturacion", "Estado", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={4} className="ps-table-empty">Cargando Ordenes...</td>
                        </tr>
                      ) : recentOrders.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="ps-table-empty">No hay Ordenes disponibles</td>
                        </tr>
                      ) : (
                        recentOrders.map(o => (
                          <tr
                            key={o.id}
                            className="row-hover ps-order-row"
                            tabIndex={0}
                            onClick={(event) => handleSellerOrderRowClick(event, o)}
                            onKeyDown={(event) => handleSellerOrderRowKeyDown(event, o)}
                            aria-label={`Ver detalles de la orden ${o.id?.slice(0, 8) || ""} de ${o.client_name || "cliente sin nombre"}`}
                          >
                            <td className="td-pad td-name">
                              <div className="ps-client-cell">
                                <span className="acm-avatar acm-avatar-small">{getAvatarInitials(o.client_name)}</span>
                                <span className="ps-client-cell-main">
                                  <strong title={o.client_name || "Sin cliente"}>{o.client_name || "Sin cliente"}</strong>
                                  <span className="ps-client-cell-badges">
                                    <OrderReviewBadge review={pendingOrderReviews[o.id]} />
                                    {isReturnedOrder(o) && <ReturnedBadge compact />}
                                  </span>
                                </span>
                              </div>
                            </td>
                            <td className="td-pad td-invoice" title={o.invoice_number || "---"}>{o.invoice_number ? <span className="td-invoice-badge">{o.invoice_number}</span> : "---"}</td>
                            <td className="td-pad"><StatusBadge status={o.status} /></td>
                            <td className="td-pad td-actions" data-row-action>
                              <div className="table-actions" data-row-action>
                                <button className="table-action-btn view" onClick={e => { e.stopPropagation(); handleViewOrder(o); }} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                                {canSellerEditOrder(o) && (
                                  <button className="table-action-btn edit" onClick={e => { e.stopPropagation(); setEditingOrder(o); }} title="Editar orden">
                                    <Icons.Edit />
                                  </button>
                                )}
{canArchiveOrder(o, ARCHIVE_MODULES.SELLER, user?.id) ? (
                  <button 
                    className="table-action-btn archive"
                    onClick={e => { e.stopPropagation(); handleArchiveOrder(o); }}
                    title="Archivar orden"
                  >
                    <Icons.Archived />
                  </button>
                ) : o.is_archived ? (
                  <button 
                    className="table-action-btn archive"
                    title="Orden archivada"
                    disabled
                  >
                    <Icons.Check />
                  </button>
                ) : null}
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

          {activeTab === "profile" && (
            <SellerProfileModule authUser={authUser} fallbackProfile={authProfile} />
          )}

          {/* ORDERS TAB */}
          {activeTab === "orders" && (
            <>
              <SalesFilterToolbar
                ariaLabel="Filtros de órdenes de venta"
                search={{
                  label: "Buscar órdenes de venta",
                  value: search,
                  onChange: setSearch,
                  placeholder: "Buscar por cliente, descripción o ID...",
                }}
                controls={[
                  {
                    id: "status", label: "Estado", icon: <Icons.FileText />, value: filterStatus, onChange: setFilterStatus,
                    isActive: filterStatus !== "all", placeholder: "Todos los estados",
                    options: [{ value: "all", label: "Todos los estados" }, ...STATUS_OPTIONS.map((status) => ({ value: status, label: getOrderStatusConfig(status).label }))],
                  },
                  {
                    id: "payment", label: "Pago", icon: <Icons.Money />, value: filterPayment, onChange: setFilterPayment,
                    isActive: filterPayment !== "all", placeholder: "Pago: Todos",
                    options: [{ value: "all", label: "Pago: Todos" }, ...Object.entries(PAYMENT_COLORS).map(([value, option]) => ({ value, label: option.label }))],
                  },
                  {
                    id: "client", label: "Cliente", icon: <Icons.Users />, value: filterClient, onChange: setFilterClient,
                    isActive: filterClient !== "all", placeholder: "Todos los clientes",
                    options: [{ value: "all", label: "Todos los clientes" }, ...clients.map((client) => ({ value: client.id, label: client.name }))],
                  },
                  {
                    id: "date", label: "Fecha", icon: <Icons.Calendar />, value: filterDate, onChange: setFilterDate,
                    isActive: filterDate !== "all", placeholder: "Fecha: Todas",
                    options: [
                      { value: "all", label: "Fecha: Todas" }, { value: "10min", label: "Hace 10 minutos" }, { value: "30min", label: "Hace 30 minutos" },
                      { value: "1hour", label: "Hace 1 hora" }, { value: "today", label: "Hoy" }, { value: "yesterday", label: "Ayer" },
                      { value: "3days", label: "Hace 3 días" }, { value: "7days", label: "Hace 7 días" }, { value: "thismonth", label: "Este mes" }, { value: "thisyear", label: "Este año" },
                    ],
                  },
                ]}
                resultCount={ordersTotal}
                resultLabel={`resultado${ordersTotal !== 1 ? "s" : ""}`}
                activeFilters={[search, filterStatus !== "all", filterPayment !== "all", filterClient !== "all", filterDate !== "all", filterArchive !== "all"].filter(Boolean).length}
                onReset={() => { setSearch(""); setFilterStatus("all"); setFilterPayment("all"); setFilterClient("all"); setFilterDate("all"); setFilterArchive("all"); }}
              />

              <div className="pp-workbench-panel">
                <div className="pp-workbench-heading">
                  <div>
                    <span className="pp-workbench-kicker">Bandeja de trabajo</span>
                    <h3>{filterArchive === "all" ? "Todas las ordernes" : filterArchive === "archived" ? "Ordernes archivadas" : filterArchive === "returned" ? "Ordernes devueltas" : "Ordernes activas"}</h3>
                  </div>
                  <div className="pp-workbench-tools">
                    <div className="pp-workbench-tabs" role="tablist">
                      <button className={filterArchive === "all" ? "active" : ""} onClick={() => { setFilterArchive("all"); setPage(1); }}>
                        <Icons.Clipboard /> Todas <span className="pp-workbench-badge">{orders.length}</span>
                      </button>
                      <button className={filterArchive === "active" ? "active" : ""} onClick={() => { setFilterArchive("active"); setPage(1); }}>
                        <Icons.Package /> Activas <span className="pp-workbench-badge">{activeOrders.length}</span>
                      </button>
                      <button className={filterArchive === "archived" ? "active" : ""} onClick={() => { setFilterArchive("archived"); setPage(1); }}>
                        <Icons.Archive /> Archivadas <span className="pp-workbench-badge">{archivedOrders.length}</span>
                      </button>
                      <button className={filterArchive === "returned" ? "active" : ""} onClick={() => { setFilterArchive("returned"); setPage(1); }}>
                        <Icons.ArrowLeft /> Devueltas <span className="pp-workbench-badge">{returnedOrders.length}</span>
                      </button>
                    </div>
                    <div className="pp-workbench-view-toggle">
                      <button onClick={() => setViewMode("table")} className={viewMode === "table" ? "active" : ""} title="Vista de tabla">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                      </button>
                      <button onClick={() => setViewMode("cards")} className={viewMode === "cards" ? "active" : ""} title="Vista de tarjetas">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

              <div className="pp-workbench-body">
              <div className={`ps-panel${viewMode === "cards" ? " ps-panel--transparent" : ""}`}>
                <div className="ps-panel-stripe" />
                {viewMode === "table" ? (
                  <div className="ps-table-wrap">
                    <table className="ps-table">
                      <thead><tr>{["Cliente", "Facturacion", "Estado", "Pago", "Tipo", "Fecha", "Acciones"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan={7} className="ps-table-empty">Cargando Ordenes...</td>
                          </tr>
                        ) : orders.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="ps-table-empty">
                              <div className="acm-empty-state">
                                <Icons.Package />
                                <strong>No hay órdenes disponibles</strong>
                                <span>{search || filterStatus !== "all" || filterPayment !== "all" || filterClient !== "all" || filterDate !== "all" || filterArchive !== "all"
                                  ? "Prueba con otros filtros o limpia la búsqueda."
                                  : "Las órdenes que crees aparecerán aquí."}</span>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          orders.map(o => (
                            <tr
                              key={o.id}
                              className="row-hover ps-order-row"
                              tabIndex={0}
                              onClick={(event) => handleSellerOrderRowClick(event, o)}
                              onKeyDown={(event) => handleSellerOrderRowKeyDown(event, o)}
                              aria-label={`Ver detalles de la orden ${o.id?.slice(0, 8) || ""} de ${o.client_name || "cliente sin nombre"}`}
                            >
                              <td className="td-pad td-name">
                                <div className="ps-client-cell">
                                  <span className="acm-avatar acm-avatar-small">{getAvatarInitials(o.client_name)}</span>
                                  <span className="ps-client-cell-main">
                                    <strong title={o.client_name || "Sin cliente"}>{o.client_name || "Sin cliente"}</strong>
                                    <span className="ps-client-cell-badges">
                                      <OrderReviewBadge review={pendingOrderReviews[o.id]} />
                                      {isReturnedOrder(o) && <ReturnedBadge compact />}
                                    </span>
                                  </span>
                                </div>
                              </td>
                            <td className="td-pad td-invoice" title={o.invoice_number || "---"}>{o.invoice_number ? <span className="td-invoice-badge">{o.invoice_number}</span> : "---"}</td>
                              <td className="td-pad"><StatusBadge status={o.status} /></td>
                              <td className="td-pad"><StatusBadge status={o.payment_status} type="payment" /></td>
                              <td className="td-pad">
                                {o.order_type === "orden 911"
                                  ? <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #EF444420" }}>911</span>
                                  : <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>Normal</span>
                                }
                              </td>
                              <td className="td-pad td-date">{new Date(o.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                              <td className="td-pad td-actions" data-row-action>
                                <div className="table-actions" data-row-action>
                                  <button className="table-action-btn view" onClick={() => handleViewOrder(o)} title="Ver detalles">
                                    <Icons.Eye />
                                  </button>
                                  {canSellerEditOrder(o) && (
                                    <button className="table-action-btn edit" onClick={() => setEditingOrder(o)} title="Editar orden">
                                      <Icons.Edit />
                                    </button>
                                  )}
                                  {!isOrderStatus(o.status, ORDER_STATUS.CANCELLED) && !o.is_archived && !isPaymentPaid(o.payment_status) && !isPaymentPartial(o.payment_status) && !isPaymentCredit(o.payment_status) && (
                                    <button 
                                      className="table-action-btn cancel" 
                                      onClick={() => handleCancelOrder(o)} 
                                      title="Cancelar orden"
                                    >
                                      <Icons.Trash />
                                    </button>
                                  )}
                                  {canArchiveOrder(o, ARCHIVE_MODULES.SELLER, user?.id) ? (
                                    <button 
                                      className="table-action-btn archive"
                                      onClick={() => handleArchiveOrder(o)}
                                      title="Archivar orden"
                                    >
                                      <Icons.Archived />
                                    </button>
                                  ) : o.is_archived ? (
                                    <button 
                                      className="table-action-btn archive"
                                      title="Orden archivada"
                                      disabled
                                    >
                                      <Icons.Check />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="ps-cards-grid">
                    {loading ? (
                      <div className="ps-cards-empty">Cargando Ordenes...</div>
                    ) : orders.length === 0 ? (
                      <div className="ps-cards-empty">
                        <div className="acm-empty-state">
                          <Icons.Package />
                          <strong>No hay órdenes disponibles</strong>
                          <span>{search || filterStatus !== "all" || filterPayment !== "all" || filterClient !== "all" || filterDate !== "all" || filterArchive !== "all"
                            ? "Prueba con otros filtros o limpia la búsqueda."
                            : "Las órdenes que crees aparecerán aquí."}</span>
                        </div>
                      </div>
                    ) : (
                      orders.map(o => {
                        const isUrgent = String(o.order_type || "").toLowerCase().includes("911");
                        return (
                        <div
                          key={o.id}
                          className="ps-order-card"
                          onClick={() => handleViewOrder(o)}
                          data-order-type={isUrgent ? "911" : "normal"}
                        >
                          <div className="ps-order-card-client">
                            <span className="acm-avatar acm-avatar-small">{getAvatarInitials(o.client_name)}</span>
                            <span className="ps-order-card-client-main">
                              <strong title={o.client_name || "Sin cliente"}>{o.client_name || "Sin cliente"}</strong>
                              <span className="ps-order-card-client-badges">
                                <span className="ps-order-card-id">{o.invoice_number || "---"}</span>
                                {isReturnedOrder(o) && <ReturnedBadge compact />}
                                <OrderReviewBadge review={pendingOrderReviews[o.id]} />
                              </span>
                            </span>
                          </div>

                          <div className="ps-order-card-fields">
                            <div className="ps-order-card-field">
                              <span className="ps-order-card-field-label">Tipo</span>
                              {isUrgent
                                ? <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #EF444420" }}>911</span>
                                : <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>Normal</span>
                              }
                            </div>
                            <div className="ps-order-card-field">
                              <span className="ps-order-card-field-label">Estado</span>
                              <StatusBadge status={o.status} />
                            </div>
                          </div>

                          <div className="ps-order-card-footer">
                            <span className="ps-order-card-date">
                              {new Date(o.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </span>
                            <StatusBadge status={o.payment_status} type="payment" />
                          </div>

                          <div className="ps-order-card-actions">
                            <button className="card-action-btn view" onClick={(event) => { event.stopPropagation(); handleViewOrder(o); }} title="Ver detalles">
                              <Icons.Eye />
                            </button>
                            {canSellerEditOrder(o) && (
                              <button className="card-action-btn edit" onClick={(event) => { event.stopPropagation(); setEditingOrder(o); }} title="Editar">
                                <Icons.Edit />
                              </button>
                            )}
                            {!isOrderStatus(o.status, ORDER_STATUS.CANCELLED) && !o.is_archived && !isPaymentPaid(o.payment_status) && !isPaymentPartial(o.payment_status) && !isPaymentCredit(o.payment_status) && (
                              <button className="card-action-btn cancel" onClick={(event) => { event.stopPropagation(); handleCancelOrder(o); }} title="Cancelar">
                                <Icons.Trash />
                              </button>
                            )}
                            {canArchiveOrder(o, ARCHIVE_MODULES.SELLER, user?.id) ? (
                              <button className="card-action-btn archive" onClick={(event) => { event.stopPropagation(); handleArchiveOrder(o); }} title="Archivar">
                                <Icons.Archived />
                              </button>
                            ) : o.is_archived ? (
                              <button className="card-action-btn archive" disabled title="Orden archivada">
                                <Icons.Check />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>
                )}
                <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
              </div>
              </div>
            </>
          )}

          {activeTab === "notifications" && (
            <DesignerNotificationsModule
              notifications={visibleSellerNotifications}
              archivedNotifications={notif.archivedNotifications}
              unreadCount={visibleSellerUnreadCount}
              loading={notif.loading}
              archivedLoading={notif.archivedLoading}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDeleteAll={notif.deleteNotificationsByScope}
            />
          )}
        </main>
      </div>

      <SharedCreateOrderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={async () => {
          await fetchOrders({ nextPage: 1, includeDashboard: true });
          await notif.refresh({ showNewToasts: true });
        }}
        userId={user?.id}
        materialOptions={materialOptions}
        clients={clients}
        clientsLoading={clientsLoading}
        onClientSearch={handleClientSearch}
        onAddNewClient={() => setShowNewClientModal(true)}
        clientToSelect={clientToSelectInOrderForm}
        onClientToSelectConsumed={() => setClientToSelectInOrderForm(null)}
      />
      <SharedEditOrderModal
        open={!!editingOrder}
        onClose={() => setEditingOrder(null)}
        order={editingOrder}
        onUpdated={() => fetchOrders({ nextPage: page, includeDashboard: true })}
        materialOptions={materialOptions}
        clients={clients}
        clientsLoading={clientsLoading}
        onClientSearch={handleClientSearch}
        editMode="seller"
      />
      <SharedOrderDetailModal
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        user={user}
        pendingReview={selectedOrderReview}
        onAcknowledgeReview={selectedOrderReview ? () => orderReviews.acknowledgeOrder(selectedOrder.id) : undefined}
        reviewAcknowledging={orderReviews.acknowledgingOrderId === selectedOrder?.id}
        reviewError={orderReviews.acknowledgeError}
        onSendToDesigner={handleSendToDesigner}
        onSendToQuotation={handleSendToQuotation}
        returnHandoff={selectedOrder ? orderReturns.incomingByOrder[selectedOrder.id] : null}
        returnHistory={selectedOrder ? orderReturns.historyByOrder[selectedOrder.id] || [] : []}
        onReturnToCashier={setReturningToCashier}
      />
      <ReturnToCashierModal
        open={!!returningToCashier}
        handoff={returningToCashier}
        order={selectedOrder}
        onClose={() => setReturningToCashier(null)}
        onConfirm={handleReturnToCashier}
        loading={returningToCashierLoading}
      />
      <AssignModal
        open={!!sendingToDesigner}
        onClose={() => setSendingToDesigner(null)}
        order={sendingToDesigner}
        role="designer"
        onConfirm={handleConfirmSendToDesigner}
        loading={sendingLoading}
      />
      <AssignModal
        open={!!sendingToQuotation}
        onClose={() => setSendingToQuotation(null)}
        order={sendingToQuotation}
        role="quote"
        defaultUserId={isReturnedOrder(sendingToQuotation) ? (sendingToQuotation?.quote_id || "") : ""}
        onConfirm={handleConfirmSendToQuotation}
        loading={sendingLoading}
      />
      <CancelOrderModal open={!!cancelingOrder} onClose={() => setCancelingOrder(null)} order={cancelingOrder} onConfirm={handleConfirmCancel} loading={cancelLoading} />
      <ArchiveOrderModal open={!!archivingOrder} onClose={() => setArchivingOrder(null)} order={archivingOrder} onConfirm={handleConfirmArchiveOrder} loading={archiveLoading} />
      
      <CreateClientModal
        open={showNewClientModal}
        onClose={() => setShowNewClientModal(false)}
        onCreated={handleNewClientCreated}
        supabase={supabase}
        userId={user?.id}
      />

      {toastMsg && (
        <div className="ps-toast">
          <div className="ps-toast-icon">
            {toastMsg.type === "success" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <span className="ps-toast-message">{toastMsg.message}</span>
        </div>
      )}
    </div>
  );
}
