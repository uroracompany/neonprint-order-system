import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import CreateOrderModal, { Field, Modal } from "../components/orders/CreateOrderModal";
import SharedEditOrderModal from "../components/orders/EditOrderModal";
import SharedOrderDetailModal from "../components/orders/OrderDetailModal";
import AdminAdvancedSettings from "../components/orders/AdminAdvancedSettings";
import AdminClientsModule from "../components/clients/AdminClientsModule";
import AdminEmployeeModule from "../components/employees/AdminEmployeeModule";
import AdminOrderActions from "../components/orders/AdminOrderActions";
import ProductionAssignmentModal from "../components/orders/ProductionAssignmentModal";
import PaymentFormModal from "../components/ui/PaymentFormModal";
import OrderAssignmentAction from "../components/orders/OrderAssignmentAction";
import CreateClientModal from "../components/ui/CreateClientModal";
import { validateReceiptFile } from "../utils/receiptValidation";
import { executeAdminOrderCommand } from "../utils/adminOrderCommands";
import {
  buildPaymentReceiptPath,
  buildStorageSafeFileName,
  createSignedOrderAssetUrlFromStoredUrl,
  uploadOrderAsset,
} from "../utils/uploadOrderAsset";
import { Icons } from "../utils/icons";
import { StatusBadge, PaymentBadge, RoleBadge } from "../components/ui/Badge";
import { getMinimumDeliveryDate } from "../utils/deliveryDate";
import { AssignModal } from "../components/ui/AssignModal";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import SettleCreditModal from "../components/ui/SettleCreditModal";
import {
  CreditCustomReminderDueModal,
  CreditReminderCreateModal,
} from "../components/ui/CreditReminderModals";
import { Pagination } from "../components/ui/Pagination";
import { ClientSelect } from "../components/ui/ClientCombobox";
import { SalesFilterToolbar } from "../components/ui/SalesFilterToolbar";
import FileUploadZone from "../components/ui/FileUploadZone";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  STATUS_LABELS,
  getPaymentStatusLabel,
  MATERIAL_OPTIONS,
  QUOTE_ASSIGNMENT_FIELDS,
  STATUS_OPTIONS,
  getOrderStatusLabel,
  isPaymentPaid,
  isPaymentPartial,
  isOrderStatus,
  isOrderStatusIn,
  normalizeOrderStatus,
  normalizeText,
  formatDate,
  parseFileUrls,
  serializeFileUrls,
  getFileNameFromUrl,
  ARCHIVE_MODULES,
} from "../utils/constants";
import {
  canArchiveOrder,
  archiveOrder,
} from "../utils/archive";
import { getReferenceImages } from "../utils/orderAssets";
import { SecureImage, SecureImageLink, SecureImageGallery } from "../components/ui/SecureImage";
import {
  formatPhone,
  getClientDisplayName,
  getSelectedClientOrderFields,
  NO_CLIENT_FILTER_VALUE,
  normalizeClientPhone,
  searchClients,
  validateClientForm,
} from "../utils/clients";
import { adminApiFetch, isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE } from "../utils/adminApi";
import { filterActiveNotifications, getActiveUnreadCount, showCreditActionFeedback } from "../utils/notifications";
import { buildProductionCatalogs } from "../utils/production";
import { getAdminTabFromSearch, getAdminTabSearch } from "../utils/adminTabRoute";
import { getMaterialGlobalBounds } from "../utils/kpiHelpers";
import { getAdminPasswordPolicyError, getEmployeeFormValidationMessage, validateEmployeeForm } from "../utils/employeeFormValidation";
import {
  buildAdminWorkspaceRecovery,
  clearAdminWorkspaceRecovery,
  readAdminWorkspaceRecovery,
  writeAdminWorkspaceRecovery,
} from "../utils/adminWorkspaceRecovery";
import { useAuth } from "../hooks/useAuth";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";
import { FlowTracker, FlowTrackerExternal } from "../components/FlowTracker";
import useNotifications from "../hooks/useNotifications";
import { applyOrdersSnapshot } from "../utils/orderRealtime";
import NotificationCenter from "../components/NotificationCenter";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import FileCard from "../components/FileCard";
import "../css-components/page-seller.css";
import "../css-components/page-admin.css";

const KPIModule = lazy(() => import("../components/kpi/KPIModule"));
const MaterialDetailModal = lazy(() => import("../components/kpi/MaterialDetailModal"));
const MaterialAnalyticsOverviewModal = lazy(() => import("../components/kpi/MaterialAnalyticsOverviewModal"));
const OrderStatisticsModal = lazy(() => import("../components/orders/OrderStatisticsModal"));

const DEFAULT_ORDER_FORM = {
  id: "",
  client_id: null,
  client_name: "",
  client_contact: "",
  invoice_number: "",
  description: "",
  material: "",
  order_type: "normal",
  design_type: "INTERNAL_DESING",
  termination_type: "",
  delivery_date: "",
  status: ORDER_STATUS.PENDING,
  payment_status: "Pending_Payment",
  seller_id: "",
  existingFiles: [],
  newFiles: [],
  removedFiles: [],
  existingPreview: null,
  newPreview: null,
  removePreview: false,
  indefinido: false,
};
const DEFAULT_USER_FORM = { name: "", email: "", password: "", confirmPassword: "", role: "seller", employment_status: true };
const DEFAULT_CLIENT_FORM = { name: "", phone: "", email: "", address: "", notes: "" };
const getOpenCreditReceivables = (items = []) => items.filter((item) => (
  item?.client_id && item.status === "open"
));

const isOpenCreditReceivable = (item) => item?.status === "open";
const formatCreditDate = (value) => (value ? formatDate(value) : "---");
const formatOverviewDeliveryDate = (value) => {
  const datePart = String(value || "").split("T")[0];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValid = parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);

  return isValid ? `${day}/${month}/${year}` : null;
};
const getCreditIssuedAt = (item) => item?.issued_at || item?.created_at || item?.order?.created_at || null;
const getCreditAlertPeriodKey = (date = new Date()) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};
const CREDIT_REMINDER_FALLBACK_CHECK_MS = 30000;
const CREDIT_REMINDER_SERVER_TIME_RESYNC_MS = 300000;
const CREDIT_REMINDER_MAX_TIMEOUT_MS = 2147483000;
const CREDIT_REMINDER_TIME_ZONE = "America/Santo_Domingo";
const CREDIT_REMINDER_VISIBILITY = {
  CREATOR: "creator",
  ADMIN_QUOTE: "admin_quote",
  QUOTE: "quote",
};
const CREDIT_REMINDER_VISIBILITY_OPTIONS = [
  {
    value: CREDIT_REMINDER_VISIBILITY.CREATOR,
    label: "Solo Administrador",
    description: "Solo tu usuario administrador podra ver y recibir este recordatorio.",
  },
  {
    value: CREDIT_REMINDER_VISIBILITY.ADMIN_QUOTE,
    label: "Administrador y Caja",
    description: "Tu usuario administrador y la Caja asignada a las ordenes seleccionadas lo recibiran.",
  },
  {
    value: CREDIT_REMINDER_VISIBILITY.QUOTE,
    label: "Solo Caja",
    description: "Solo la Caja asignada a las ordenes seleccionadas vera este recordatorio.",
  },
];
const CREDIT_REMINDER_VISIBILITY_VALUES = new Set(Object.values(CREDIT_REMINDER_VISIBILITY));
const creditReminderVisibilityIncludesQuote = (scope) => (
  scope === CREDIT_REMINDER_VISIBILITY.ADMIN_QUOTE
  || scope === CREDIT_REMINDER_VISIBILITY.QUOTE
);
const getMonotonicNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0
);
const getCreditReminderServerNow = (clock) => {
  if (!clock) return null;
  return clock.serverNowMs + (getMonotonicNow() - clock.clientMonotonicMs);
};
const getTimeZoneDateParts = (date, timeZone = CREDIT_REMINDER_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
};
const formatDatetimeLocalParts = ({ year, month, day, hour = 0, minute = 0 }) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
);
const getTimeZoneOffsetMs = (date, timeZone = CREDIT_REMINDER_TIME_ZONE) => {
  const parts = getTimeZoneDateParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  return asUtc - date.getTime();
};
const parseDatetimeLocalValue = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
};
const zonedDatetimeLocalToUtcMs = (value, timeZone = CREDIT_REMINDER_TIME_ZONE) => {
  const parts = parseDatetimeLocalValue(value);
  if (!parts) return NaN;

  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const firstInstant = utcGuess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(firstInstant), timeZone);
  return utcGuess - secondOffset;
};
const getDefaultCreditReminderAt = (baseTimeMs) => {
  const baseDate = Number.isFinite(baseTimeMs) ? new Date(baseTimeMs) : new Date();
  const countryParts = getTimeZoneDateParts(baseDate, CREDIT_REMINDER_TIME_ZONE);
  const nextDay = new Date(Date.UTC(countryParts.year, countryParts.month - 1, countryParts.day + 1, 9, 0, 0));
  return formatDatetimeLocalParts({
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    hour: 9,
    minute: 0,
  });
};
const getMinimumCreditReminderAt = (baseTimeMs) => {
  if (!Number.isFinite(baseTimeMs)) return "";
  const countryParts = getTimeZoneDateParts(new Date(baseTimeMs), CREDIT_REMINDER_TIME_ZONE);
  return formatDatetimeLocalParts({
    year: countryParts.year,
    month: countryParts.month,
    day: countryParts.day,
    hour: countryParts.hour,
    minute: countryParts.minute,
  });
};
const getCreditReceivableStatusLabel = (status) => {
  const labels = {
    open: "Pendiente",
    resolved: "Resuelta",
    void: "Anulada",
  };
  return labels[status] || status || "Pendiente";
};
const getCreditReceivableStatusStyle = (status) => {
  if (status === "resolved") return { background: "#DCFCE7", color: "#166534", border: "1px solid #22C55E40" };
  if (status === "void") return { background: "#F1F5F9", color: "#475569", border: "1px solid #CBD5E140" };
  return { background: "#FEF3C7", color: "#92400E", border: "1px solid #F59E0B40" };
};

const resolveQuoteAssignmentId = (order) => QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).find(Boolean) || null;
// Genera nombres únicos y legibles para los archivos que sube el administrador.
// Función uploadOrderAsset importada desde ../utils/uploadOrderAsset.js
// Para usar: uploadOrderAsset({ bucket, path, file })

// Funciones para obtener información de los perfiles de usuario con lógica de respaldo
// Funcion para obtener el nombre del usuario
const getUserDisplayName = (profile) => {
  if (!profile) return "Usuario eliminado";
  const label = profile.name || profile.email || "Usuario eliminado";
  return profile.deleted_at || profile.employment_status === false ? `${label} — dado de baja` : label;
};
// Normaliza el estado laboral a un booleano real para que la UI y la base hablen el mismo idioma.
const isEmploymentActive = (profile) => {
  if (profile?.deleted_at) return false;
  const value = profile?.employment_status ?? profile?.employee_status ?? profile?.status;

  if (typeof value === "boolean") return value;

  const normalizedValue = normalizeText(value);
  return ["empleado", "contratado", "activo", "true"].includes(normalizedValue);
};

// Convierte el estado booleano a una etiqueta legible para mostrarla en la interfaz.
const getEmploymentStatus = (profile) => (isEmploymentActive(profile) ? "empleado" : "despedido");

const getInitials = (name) => {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return (parts[0][0] + parts[0][0]).toUpperCase();
  return "??";
};
const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Caja",
    admin: "Administrador",
    semi_admin: "Semi-Administrador",
    printer: "Producción",
    digital_producer: "Producción Digital",
    dtf_producer: "Producción DTF",
    ploteo_producer: "Producción Ploteo",
    delivery: "Entrega"
  };
  return map[role] || role;
};

function ModalShell({ open, title, onClose, children, size = "default", className = "" }) {
  if (!open) return null;
  return (
    <div className="pa-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`pa-modal ${size} ${className}`.trim()}>
        <div className="pa-modal-head">
          <div className="pa-modal-copy"><span className="pa-modal-kicker">Administrador</span><h3>{title}</h3></div>
          <button className="pa-icon-btn pa-modal-close" onClick={onClose} aria-label="Cerrar modal"><Icons.Close /></button>
        </div>
        <div className="pa-modal-body">{children}</div>
      </div>
    </div>
  );
}

function OrderFormModal({ open, mode, orderForm, setOrderForm, onClose, onSubmit, saving }) {
  const [simpleMaterials, setSimpleMaterials] = useState([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("materials").select("name").order("name");
      setSimpleMaterials(data || []);
    };
    if (open) load();
  }, [open]);

  return (
    <ModalShell open={open} onClose={onClose} title={mode === "create" ? "Crear orden" : "Editar orden"} size="large">
      <div className="pa-form-grid">
        <label className="pa-field"><span>Cliente</span><input value={orderForm.client_name} readOnly disabled placeholder="Selecciona un cliente registrado" /></label>
        <label className="pa-field"><span>Teléfono</span><input value={orderForm.client_contact} readOnly disabled placeholder="Contacto del cliente registrado" /></label>
        <label className="pa-field full"><span>Descripción</span><textarea rows={3} value={orderForm.description} onChange={(e) => setOrderForm(prev => ({ ...prev, description: e.target.value }))} /></label>
        <label className="pa-field"><span>Material</span><select value={orderForm.material} onChange={(e) => setOrderForm(prev => ({ ...prev, material: e.target.value }))}><option value="">Seleccionar material</option>{simpleMaterials.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
        <label className="pa-field"><span>Tipo de orden</span><select value={orderForm.order_type} onChange={(e) => setOrderForm(prev => ({ ...prev, order_type: e.target.value }))}><option value="normal">Normal</option><option value="orden 911">Orden 911</option></select></label>
        <label className="pa-field full"><span>Preview / Orden de trabajo</span><input value={orderForm.preview_image} onChange={(e) => setOrderForm(prev => ({ ...prev, preview_image: e.target.value }))} placeholder="https://..." /></label>
        <label className="pa-field full"><span>Archivos de diseño</span><textarea rows={4} value={orderForm.order_file_url} onChange={(e) => setOrderForm(prev => ({ ...prev, order_file_url: e.target.value }))} placeholder="Una URL por línea o separadas por coma" /></label>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving}>{saving ? "Guardando..." : mode === "create" ? "Crear orden" : "Guardar cambios"}</button>
      </div>
    </ModalShell>
  );
}



// Shared order info rendering (used by both modals)
function OrderDetailInfo({ order, usersById, assignmentAction = null }) {
  const [paymentInvoiceUrl, setPaymentInvoiceUrl] = useState("");

  useEffect(() => {
    let active = true;

    const loadPaymentInvoiceUrl = async () => {
      if (!order?.invoice_payment) {
        if (active) setPaymentInvoiceUrl("");
        return;
      }

      const signedUrl = await createSignedOrderAssetUrlFromStoredUrl({
        bucket: "payment-invoice",
        url: order.invoice_payment,
      });

      if (active) {
        setPaymentInvoiceUrl(signedUrl || "");
      }
    };

    loadPaymentInvoiceUrl();

    return () => {
      active = false;
    };
  }, [order?.invoice_payment]);

  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const sellerId = order?.seller_id || null;
  const userName = sellerId ? getUserDisplayName(usersById[sellerId]) : "Sin asignar — Administración";
  const designerName = order?.designer_id ? getUserDisplayName(usersById[order.designer_id]) : "";
  const quoteAssignedId = resolveQuoteAssignmentId(order);
  const quoteUserName = quoteAssignedId ? getUserDisplayName(usersById[quoteAssignedId]) : "";
  const rawFiles = parseFileUrls(order.order_file_url);
  const existingFiles = rawFiles.map(f => typeof f === "string" ? { url: f, name: getFileNameFromUrl(f) } : { url: f.url || f, name: f.name || getFileNameFromUrl(f.url || f) });
  const preview = order.preview_image;
  const referenceImageUrls = getReferenceImages(order);
  const paymentInvoice = paymentInvoiceUrl;

  return (
    <>
      {order.order_design_type === "EXTERNAL_DESING" ? (
        <FlowTrackerExternal status={order.status} />
      ) : (
        <FlowTracker status={order.status} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 22 }}>
        <div>
          <div style={{
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18,
            position: "relative",
            overflow: "hidden"
          }}>
            <div style={{
              position: "absolute",
              top: 0, right: 0,
              width: 100, height: 100,
              background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, transparent 100%)",
              borderRadius: "0 0 0 100px",
              pointerEvents: "none"
            }} />

            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 50, height: 50,
                borderRadius: "var(--radius-md)",
                background: "linear-gradient(135deg, #06B6D4, #0f1e40)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 22, fontWeight: 700,
                flexShrink: 0
              }}>
                {order.client_name?.charAt(0)?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: 5 }}>
                  {order.client_name}
                </p>
                {order.client_contact && (
                  <p style={{ fontSize: 12, color: "var(--text-sub)", margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icons.Phone />{order.client_contact}
                  </p>
                )}
              </div>
            </div>

            <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6, margin: 0 }}>
                {order.description}
              </p>
            </div>
          </div>

          <div style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 14, margin: "0 0 14px 0"
            }}>Especificaciones</p>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Material:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.material}</span>
              </div>
              {order.termination_type && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Terminación:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.termination_type}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Tipo de orden:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.order_design_type === "EXTERNAL_DESING" ? "Diseño Externo" : "Diseño Interno"}</span>
              </div>
            </div>
          </div>

          {(preview || existingFiles.length > 0 || referenceImageUrls.length > 0) && (
            <>
              {preview && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Eye /> Orden de Trabajo
                  </p>
                  <SecureImageLink url={preview} fileName={getFileNameFromUrl(preview)}>
                    <SecureImage
                      url={preview}
                      alt="preview"
                      style={{
                        width: "100%",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        transition: "transform 0.2s, box-shadow 0.2s",
                      }}
                      onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                      onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                    />
                  </SecureImageLink>
                </div>
              )}
              {existingFiles.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Brush /> Diseño del cliente
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {existingFiles.map((file, index) => (
                      <FileCard
                        key={index}
                        name={file.name}
                        url={file.url}
                      />
                    ))}
                  </div>
                </div>
              )}
              {referenceImageUrls.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Image /> Imágenes de referencia
                  </p>
                  <SecureImageGallery
                    urls={referenceImageUrls}
                    fileNames={referenceImageUrls.map(getFileNameFromUrl)}
                    altPrefix="Referencia"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <div style={{
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 14, margin: "0 0 14px 0"
            }}>Información de la Orden</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Vendedor:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{userName}</span>
              </div>
              {order.designer_id && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Diseñador asignado:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{designerName}</span>
                </div>
              )}
              {quoteAssignedId && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Responsable de caja:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{quoteUserName}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Creada:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{created}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Estado:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>{getOrderStatusLabel(order.status)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Pago:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{getPaymentStatusLabel(order.payment_status)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Archivada en admin:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: order.is_archived_admin ? "#B45309" : "var(--text)" }}>
                  {order.is_archived_admin ? "Si" : "No"}
                </span>
              </div>
              {order.invoice_number && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Facturacion:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{order.invoice_number}</span>
                </div>
              )}
              {order.price && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Precio:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--success)" }}>RD$ {parseFloat(order.price).toLocaleString("es-DO", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {order.delivery_date && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Entrega:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{formatDate(order.delivery_date)}</span>
                </div>
              )}
            </div>
            {assignmentAction && <div style={{ marginTop: 16 }}>{assignmentAction}</div>}
          </div>

          {isPaymentPaid(order.payment_status) && paymentInvoice && (
            <div style={{
              background: "var(--surface)",
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 20,
              marginBottom: 18
            }}>
              <p style={{
                fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.07em",
                marginBottom: 14, margin: "0 0 14px 0"
              }}>Factura de pago</p>

              <a href={paymentInvoice} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none" }}>
                <img
                  src={paymentInvoice}
                  alt="Factura de pago"
                  style={{
                    width: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "var(--surface-alt)",
                    cursor: "pointer",
                  }}
                />
              </a>
            </div>
          )}

          {/* Card: Link de Seguimiento */}
          <div style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 12
            }}>Link de Seguimiento</p>

            <AdminTrackingLinkField orderId={order.id} />
          </div>
        </div>
      </div>
    </>
  );
}

// Modal de detalles de orden para admin (con botones de accion)
function AdminOrderDetailModal({ open, order, usersById, onClose, onAssign }) {
  if (!open || !order) return null;

  const isExternalDesign = order.order_design_type === "EXTERNAL_DESING";
  const canAssign = !isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED, ORDER_STATUS.IN_DESIGN]);
  const assignRole = isExternalDesign ? "quote" : "designer";
  const assignmentAction = canAssign ? (
    <OrderAssignmentAction
      order={order}
      label="Asignar Orden"
      onClick={() => {
        onClose();
        onAssign(order, assignRole);
      }}
      bare
    />
  ) : null;

  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      <OrderDetailInfo order={order} usersById={usersById} assignmentAction={assignmentAction} />
    </ModalShell>
  );
}

// Modal de detalles de orden para el apartado de crédito (solo información, sin acciones)
function CreditOrderDetailModal({ open, order, usersById, onClose }) {
  if (!open || !order) return null;

  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      <OrderDetailInfo order={order} usersById={usersById} />
    </ModalShell>
  );
}

// Modal de asignación de orden a usuario
// Versión enriquecida del formulario de órdenes para admin, con la misma capacidad de carga
// de archivos y preview que hoy utiliza seller.
function AdminOrderFormModal({ open, mode, orderForm, setOrderForm, onClose, onSubmit, saving, clients = [], onClientSearch, clientsLoading = false }) {
  const filesInputRef = useRef(null);
  const previewInputRef = useRef(null);
  const [adminMaterials, setAdminMaterials] = useState([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("materials").select("name").order("name");
      setAdminMaterials(data || []);
    };
    if (open) load();
  }, [open]);

  const previewSource = useMemo(() => {
    if (orderForm.newPreview) {
      return URL.createObjectURL(orderForm.newPreview);
    }

    return orderForm.existingPreview || "";
  }, [orderForm.existingPreview, orderForm.newPreview]);

  useEffect(() => {
    return () => {
      if (previewSource?.startsWith("blob:")) {
        URL.revokeObjectURL(previewSource);
      }
    };
  }, [previewSource]);

  const setField = (field, value) => {
    setOrderForm((prev) => ({ ...prev, [field]: value }));
  };

  const applySelectedClient = (client) => {
    if (!client) {
      setOrderForm((prev) => ({ ...prev, ...getSelectedClientOrderFields(null, "client_contact") }));
      return;
    }

    const fields = getSelectedClientOrderFields(client, "client_contact");
    if (fields.client_contact) fields.client_contact = formatPhone(fields.client_contact);

    setOrderForm((prev) => ({
      ...prev,
      ...fields,
    }));
  };

  const handleAddFiles = (filesOrEvent) => {
    const files = Array.from(filesOrEvent?.target?.files || filesOrEvent || []);
    if (!files.length) return;

    setOrderForm((prev) => ({
      ...prev,
      newFiles: [...prev.newFiles, ...files],
    }));

    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleRemoveExistingFile = (fileUrl) => {
    setOrderForm((prev) => ({
      ...prev,
      existingFiles: prev.existingFiles.filter((currentFile) => currentFile !== fileUrl),
      removedFiles: prev.removedFiles.includes(fileUrl) ? prev.removedFiles : [...prev.removedFiles, fileUrl],
    }));
  };

  const handleRemoveNewFile = (index) => {
    setOrderForm((prev) => ({
      ...prev,
      newFiles: prev.newFiles.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const handlePreviewChange = (filesOrEvent) => {
    const nextPreview = Array.from(filesOrEvent?.target?.files || filesOrEvent || [])[0];
    if (!nextPreview) return;

    setOrderForm((prev) => ({
      ...prev,
      newPreview: nextPreview,
      removePreview: false,
    }));

    if (filesOrEvent?.target) filesOrEvent.target.value = "";
  };

  const handleRemovePreview = () => {
    setOrderForm((prev) => ({
      ...prev,
      newPreview: null,
      existingPreview: null,
      removePreview: Boolean(prev.existingPreview) || prev.removePreview,
    }));
  };

  return (
    <ModalShell open={open} onClose={onClose} title={mode === "create" ? "Crear orden" : "Editar orden"} size="large">
      <div className="pa-order-form-layout">
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Datos base</span>
            <h5>Información del cliente</h5>
          </div>

          <div className="pa-form-grid">
            <div className="pa-field full">
              <span>Cliente registrado</span>
              <ClientSelect
                clients={clients}
                value={orderForm.client_id}
                onSelect={applySelectedClient}
                onSearch={onClientSearch}
                loading={clientsLoading}
                placeholder="Seleccionar cliente registrado"
                emptyText="No hay clientes registrados. Registra el cliente antes de crear la orden."
              />
            </div>
            <label className="pa-field">
              <span>Cliente</span>
              <input value={orderForm.client_name} readOnly disabled placeholder="Selecciona un cliente registrado" />
            </label>
            <label className="pa-field">
              <span>Teléfono</span>
              <input value={orderForm.client_contact} readOnly disabled placeholder="Contacto del cliente registrado" />
            </label>
            <label className="pa-field">
              <span>Numero de facturacion</span>
              <input value={orderForm.invoice_number} onChange={(event) => setField("invoice_number", event.target.value)} placeholder="Ej: FAC-001-2026" />
            </label>
            <label className="pa-field full">
              <span>Descripción</span>
              <textarea rows={3} value={orderForm.description} onChange={(event) => setField("description", event.target.value)} placeholder="Describe la orden con suficiente contexto para diseño y producción." />
            </label>
            <label className="pa-field">
              <span>Material</span>
              <select value={orderForm.material} onChange={(event) => setField("material", event.target.value)}>
                <option value="">Seleccionar material</option>
                {adminMaterials.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="pa-field">
              <span>Tipo de terminación</span>
              <input value={orderForm.termination_type} onChange={(event) => setField("termination_type", event.target.value)} placeholder="Ej. Brillante, Mate, Con marco..." />
            </label>
            <label className="pa-field">
              <span>Fecha de entrega</span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <input
                  type="date"
                  value={orderForm.delivery_date}
                  min={getMinimumDeliveryDate()}
                  onChange={(event) => setField("delivery_date", event.target.value)}
                  disabled={orderForm.indefinido}
                  style={{ opacity: orderForm.indefinido ? 0.5 : 1 }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={orderForm.indefinido}
                    onChange={(event) => setField("indefinido", event.target.checked)}
                    style={{ width: "16px", height: "16px", margin: 0, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "13px", color: "#64748b" }}>Por definir</span>
                </label>
              </div>
            </label>
            <label className="pa-field">
              <span>Tipo de orden</span>
              <select value={orderForm.order_type} onChange={(event) => setField("order_type", event.target.value)}>
                <option value="normal">Normal</option>
                <option value="orden 911">Orden 911</option>
              </select>
            </label>
            <label className="pa-field">
              <span>Tipo de diseño</span>
              <select value={orderForm.design_type} onChange={(event) => setField("design_type", event.target.value)}>
                <option value="INTERNAL_DESING">Diseño Interno</option>
                <option value="EXTERNAL_DESING">Diseño Externo</option>
              </select>
            </label>
          </div>
        </section>

        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Archivos</span>
            <h5>Diseños y orden de trabajo</h5>
          </div>

          <div className="pa-form-grid">
            <div className="pa-field full">
              <span>Archivos de diseño</span>
              <div className="pa-upload-stack">
                {[...orderForm.existingFiles, ...orderForm.newFiles].length > 0 ? (
                  <div className="pa-upload-files">
                    {orderForm.existingFiles.map((fileUrl) => (
                      <FileCard
                        key={fileUrl}
                        name={getFileNameFromUrl(fileUrl)}
                        url={fileUrl}
                        onRemove={() => handleRemoveExistingFile(fileUrl)}
                      />
                    ))}

                    {orderForm.newFiles.map((file, index) => (
                      <FileCard
                        key={`${file.name}-${index}`}
                        name={file.name}
                        onRemove={() => handleRemoveNewFile(index)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="pa-empty-small">Todavía no se han agregado archivos de diseño.</div>
                )}

                <FileUploadZone
                  mode="attachment"
                  multiple
                  inputRef={filesInputRef}
                  buttonLabel="Agregar archivos"
                  hint="PDF, AI, PNG, JPG y otros documentos de diseño."
                  onFilesAccepted={handleAddFiles}
                />
              </div>
            </div>

            <div className="pa-field full">
              <span>Preview / Orden de trabajo</span>
              {previewSource ? (
                <div className="pa-preview-card">
                  {previewSource.startsWith("blob:") ? (
                    <img src={previewSource} alt="Preview de la orden" className="pa-preview-image" />
                  ) : (
                    <SecureImageLink url={previewSource} fileName={getFileNameFromUrl(previewSource)}>
                      <SecureImage
                        url={previewSource}
                        alt="Preview de la orden"
                        className="pa-preview-image"
                      />
                    </SecureImageLink>
                  )}
                  <div className="pa-preview-card-footer">
                    <div>
                      <strong>{orderForm.newPreview ? orderForm.newPreview.name : "Preview actual"}</strong>
                      <small>{orderForm.newPreview ? "Se reemplazará al guardar" : "Archivo guardado"}</small>
                    </div>
                    <div className="pa-upload-chip-actions">
                      <button type="button" className="pa-btn ghost pa-btn-sm" onClick={() => previewInputRef.current?.click()}>Cambiar</button>
                      <button type="button" className="pa-btn danger pa-btn-sm" onClick={handleRemovePreview}>Quitar</button>
                    </div>
                  </div>
                  <FileUploadZone
                    mode="image"
                    replaceMode
                    inputRef={previewInputRef}
                    className="file-upload-zone--hidden-picker"
                    buttonLabel="Cambiar preview"
                    onFilesAccepted={handlePreviewChange}
                  />
                </div>
              ) : (
                <FileUploadZone
                  mode="image"
                  replaceMode
                  inputRef={previewInputRef}
                  buttonLabel="Subir preview"
                  hint="Imagen opcional para mostrar la orden de trabajo dentro del detalle."
                  onFilesAccepted={handlePreviewChange}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving}>
          {saving ? "Guardando..." : mode === "create" ? "Crear orden" : "Guardar cambios"}
        </button>
      </div>
    </ModalShell>
  );
}

// Formulario para crea usuarios en el apartado de admin
export function UserFormModal({ open, mode = "create", userForm, setUserForm, onClose, onSubmit, saving, submissionError = "", onClearSubmissionError }) {
  const isEdit = mode === "edit";
  const validation = validateEmployeeForm(userForm, mode);
  const createValidationMessage = !isEdit ? getEmployeeFormValidationMessage(userForm, mode) : null;
  const credentialsTouched = Boolean(userForm.password || userForm.confirmPassword);
  const credentialError = credentialsTouched && (validation.passwordError || (!validation.passwordsMatch && "Las contraseñas no coinciden."));
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const updateUserForm = (updater) => {
    setUserForm(updater);
    onClearSubmissionError?.();
  };

  if (!open) return null;

  return (
    <div className="pa-overlay">
      <div className="pa-modal pa-client-modal ps-file-details-modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="pa-modal-head">
          <div>
            <h3>{isEdit ? "Editar empleado" : "Crear empleado"}</h3>
            <p className="pa-client-modal-subtitle">{isEdit ? "Actualiza la información y permisos del empleado." : "Completa los datos para registrar un nuevo empleado en el sistema."}</p>
          </div>
          <button className="pa-close-btn" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>
        <div className="pa-modal-body">
          <div className="pa-client-form-intro">
            <Icons.AlertCircle />
            <div>
              <span>{isEdit ? "Editar empleado" : "Nuevo empleado"}</span>
              <strong>{isEdit ? "Modifica los datos necesarios y guarda los cambios." : "Nombre, email y rol son obligatorios."}</strong>
            </div>
          </div>
          <div className="ps-file-details-content">
            <div className="ps-field">
              <label className="ps-label">Nombre <span className="ps-label-req">*</span></label>
              <input
                className="ps-form-input"
                value={userForm.name}
                onChange={e => updateUserForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ej. María Fernanda"
                autoComplete="name"
                autoFocus
              />
            </div>
            <div className="ps-field">
              <label className="ps-label">Email <span className="ps-label-req">*</span></label>
              <input
                className="ps-form-input"
                type="email"
                value={userForm.email}
                onChange={e => updateUserForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="usuario@empresa.com"
                autoComplete="email"
              />
            </div>
            <div className="ps-field">
              <label className="ps-label">{isEdit ? "Nueva contraseña" : "Contraseña"} <span className="ps-label-req">*</span></label>
              <div className="ps-password-wrapper">
                <input
                  className="ps-form-input"
                  type={showPassword ? "text" : "password"}
                  value={userForm.password}
                  onChange={e => updateUserForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder={isEdit ? "Dejar vacío para no cambiar" : "Mínimo 12 caracteres"}
                  autoComplete="new-password"
                />
                <button type="button" className="ps-password-toggle" onClick={() => setShowPassword(prev => !prev)} tabIndex={-1} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>
            </div>
            <div className="ps-field">
              <label className="ps-label">Confirmar contraseña <span className="ps-label-req">*</span></label>
              <div className="ps-password-wrapper">
                <input
                  className="ps-form-input"
                  type={showConfirmPassword ? "text" : "password"}
                  value={userForm.confirmPassword}
                  onChange={e => updateUserForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder={isEdit ? "Confirma solo si cambias contraseña" : "Repite la contraseña"}
                  autoComplete="new-password"
                />
                <button type="button" className="ps-password-toggle" onClick={() => setShowConfirmPassword(prev => !prev)} tabIndex={-1} aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showConfirmPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>
            </div>
            {credentialError && (
              <p className="ps-field-error-message" role="alert">{credentialError}</p>
            )}
            <div className="ps-field">
              <label className="ps-label">Rol <span className="ps-label-req">*</span></label>
              <select
                className="ps-form-input"
                value={userForm.role}
                onChange={e => updateUserForm(prev => ({ ...prev, role: e.target.value }))}
              >
                <option value="semi_admin">Semi-Administrador</option>
                <option value="seller">Vendedor</option>
                <option value="designer">Diseñador</option>
                <option value="quote">Caja</option>
                <option value="printer">Producción legacy</option>
                <option value="digital_producer">Producción Digital</option>
                <option value="dtf_producer">Producción DTF</option>
                <option value="ploteo_producer">Producción Ploteo</option>
                <option value="delivery">Entrega</option>
              </select>
            </div>
            <div className="ps-field">
              <label className="ps-label">Estado laboral</label>
              <input
                className="ps-form-input"
                value={isEdit ? getEmploymentStatus(userForm) : "Empleado por defecto"}
                readOnly
                disabled
              />
            </div>
          </div>
        </div>
        <div className="pq-production-dialog-footer">
          {submissionError && !saving && (
            <p id="employee-create-submit-error" className="ps-field-error-message" role="alert">
              {submissionError}
            </p>
          )}
          {createValidationMessage && !saving && (
            <p id="employee-create-validation-message" className="ps-field-error-message" role="status">
              {createValidationMessage}
            </p>
          )}
          <div className="pq-dialog-actions">
            <button type="button" className="pq-btn pq-btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button
              type="button"
              className="pq-btn pq-btn-primary"
              onClick={onSubmit}
              disabled={saving || !validation.isValid}
              aria-describedby={submissionError ? "employee-create-submit-error" : createValidationMessage ? "employee-create-validation-message" : undefined}
            >
              {saving ? "Guardando..." : <><Icons.Plus />{isEdit ? "Guardar cambios" : "Crear empleado"}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Detalles de la orden
function OrderDetailModal({ open, order, usersById, onClose, onEdit, onCancel }) {
  if (!open || !order) return null;
  const files = parseFileUrls(order.order_file_url);
  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      <div className="pa-detail-grid">
        <div className="pa-panel">
          <div className="pa-panel-title">Resumen</div>
          <div className="pa-detail-list">
            <div><span>Cliente</span><strong>{order.client_name || "No definido"}</strong></div>
            <div><span>Contacto</span><strong>{order.client_contact || "No definido"}</strong></div>
            <div><span>Responsable</span><strong>{order.seller_id ? getUserDisplayName(usersById[order.seller_id]) : "Sin asignar — Administración"}</strong></div>
            <div><span>Tipo</span><strong>{order.order_type || "No definido"}</strong></div>
            <div><span>Material</span><strong>{order.material || "No definido"}</strong></div>
            <div><span>Fecha</span><strong>{formatDate(order.created_at)}</strong></div>
          </div>
          <div className="pa-detail-description">{order.description || "Sin descripción"}</div>
        </div>
        <div className="pa-panel">
          <div className="pa-panel-title">Diseños y caja</div>
          <div className="pa-detail-list">
          <div><span>Estado</span><strong><StatusBadge status={order.status} className="ps-badge" showDot bordered order={order} /></strong></div>
            <div><span>Pago</span><strong><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></strong></div>
            <div><span>Facturacion</span><strong>{order.invoice_number || "No definido"}</strong></div>
            <div><span>Precio</span><strong>{order.price ? `RD$${Number(order.price).toLocaleString("es-DO")}` : "Precio pendiente"}</strong></div>
            <div><span>Preview</span><strong>{order.preview_image ? <SecureImageLink url={order.preview_image} fileName={getFileNameFromUrl(order.preview_image)}>Ver preview</SecureImageLink> : "Sin preview"}</strong></div>
          </div>
          {files.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {files.map((file, index) => (
                <FileCard
                  key={`${file}-${index}`}
                  name={getFileNameFromUrl(file)}
                  url={file}
                />
              ))}
            </div>
          ) : (
            <div className="pa-empty-small">No hay diseños cargados.</div>
          )}
        </div>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cerrar</button>
        <button className="pa-btn ghost" onClick={() => onEdit(order)}>Editar</button>
        {!isOrderStatus(order.status, ORDER_STATUS.CANCELLED) && <button className="pa-btn danger" onClick={() => onCancel(order)}>Cancelar orden</button>}
      </div>
    </ModalShell>
  );
}

function EmploymentStatusConfirmModal({ open, pendingChange, onClose, onConfirm, saving }) {
  if (!open || !pendingChange) return null;

  const willActivate = pendingChange.nextStatus === true;

  return (
    <div className="archive-modal-overlay" onClick={onClose}>
      <div className="archive-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`archive-modal-stripe${willActivate ? "" : " danger"}`} />
        <div className="archive-modal-header">
          <div className="archive-modal-title">
            <h3>{willActivate ? "Activar empleado" : "Desactivar empleado"}</h3>
          </div>
          <button className="archive-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>
        <div className="archive-modal-body">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <span
              style={{
                display: "inline-grid",
                width: 40,
                height: 40,
                placeItems: "center",
                borderRadius: 10,
                background: willActivate ? "#f0fdf4" : "#fef2f2",
                color: willActivate ? "#16a34a" : "#dc2626",
                flexShrink: 0,
              }}
            >
              {willActivate ? <Icons.UserCheck /> : <Icons.UserMinus />}
            </span>
            <strong style={{ fontSize: 15, color: "#111827" }}>{pendingChange.userName}</strong>
          </div>
          <p>
            {willActivate
              ? "Si confirmas esta acción, el empleado volverá a estar activo y podrá iniciar sesión."
              : "Si continúas, el empleado quedará inactivo y no podrá iniciar sesión hasta ser activado nuevamente."}
          </p>
          {!willActivate && (
            <p className="archive-modal-hint">
              Esta acción no eliminará la cuenta. El empleado podrá ser reactivado más adelante.
            </p>
          )}
        </div>
        <div className="archive-modal-footer">
          <button className="archive-btn archive-btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className={`archive-btn ${willActivate ? "archive-btn-success" : "archive-btn-danger"}`}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="archive-btn-spinner" />
                Guardando...
              </>
            ) : (
              <>
                {willActivate ? <Icons.UserCheck /> : <Icons.UserMinus />}
                {willActivate ? "Activar empleado" : "Desactivar empleado"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Detalles del usuario
function UserDetailModal({ open, user, onClose, onEdit, onCreateOrder, onRequestEmploymentToggle, onShowFeedback, currentUserId }) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Estados de validación
  const [errors, setErrors] = useState({ newPassword: "", confirmPassword: "" });

  useEffect(() => {
    if (!open || !user?.id) return;

    const fetchUserEmail = async () => {
      setUserEmail(user.email || "");
      try {
        const { result: data } = await adminApiFetch("/api/get-user-email", { userId: user.id });
        if (data.email) {
          setUserEmail(data.email);
        }
      } catch (err) {
        console.error("Error fetching email:", err);
      }
    };
    fetchUserEmail();
  }, [open, user?.id, user?.email]);

  const handleChangePassword = async () => {
    if (!user?.id) return;

    // Validar campos
    const newErrors = { newPassword: "", confirmPassword: "" };
    let hasErrors = false;

    if (!newPassword.trim()) {
      newErrors.newPassword = "La contraseña es obligatoria";
      hasErrors = true;
    } else {
      const passwordPolicyError = getAdminPasswordPolicyError(newPassword);
      if (passwordPolicyError) {
        newErrors.newPassword = passwordPolicyError;
        hasErrors = true;
      }
    }

    if (!confirmPassword.trim()) {
      newErrors.confirmPassword = "Confirma la contraseña";
      hasErrors = true;
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Las contraseñas no coinciden";
      hasErrors = true;
    }

    if (hasErrors) {
      setErrors(newErrors);
      return;
    }

    // Limpiar errores si todo está bien
    setErrors({ newPassword: "", confirmPassword: "" });

    setChangingPassword(true);

    try {
      const { response, result } = await adminApiFetch("/api/change-user-password", { userId: user.id, newPassword });

      if (!response.ok) {
        onShowFeedback?.("error", `Error al cambiar la contraseña: ${result.error}`);
        setChangingPassword(false);
        return;
      }

      setShowSuccessModal(true);
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
      setErrors({ newPassword: "", confirmPassword: "" });

      setTimeout(() => {
        setShowSuccessModal(false);
      }, 2000);

    } catch {
      onShowFeedback?.("error", "Error al conectar con el servidor");
    }

    setChangingPassword(false);
  };

  if (!open || !user) return null;

  const employmentStatus = getEmploymentStatus(user);
  const isActive = isEmploymentActive(user);

  return (
    <>
      <ModalShell open={open} onClose={onClose} title={`${getUserDisplayName(user)}`} size="compact">
        <div className="pa-user-detail-container">
          <div className="pa-user-detail-avatar-section">
            <div className="pa-user-avatar">
              <span>{getUserDisplayName(user).charAt(0).toUpperCase()}</span>
            </div>
            <div className="pa-user-detail-badge">
              <RoleBadge role={user.role} />
            </div>
          </div>

          <div className="pa-user-detail-grid">
            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Información Personal</span>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Nombre</span>
                <strong className="pa-detail-item-value">{getUserDisplayName(user)}</strong>
              </div>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Correo</span>
                <strong className="pa-detail-item-value pa-email-value">{userEmail || "Cargando..."}</strong>
              </div>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Rol</span>
                <strong className="pa-detail-item-value">{getRoleLabel(user.role) || "Sin rol"}</strong>
              </div>
            </section>

            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Seguridad</span>
              {!showPasswordForm ? (
                <button
                  className="pa-btn primary pa-btn-sm"
                  onClick={() => setShowPasswordForm(true)}
                  style={{ width: "100%" }}
                >
                  Cambiar contraseña
                </button>
              ) : (
                <div className="pa-password-form">
                  <label className="pa-field">
                    <span>Nueva contraseña</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setErrors(prev => ({ ...prev, newPassword: "" })); }}
                      placeholder="Mínimo 12 caracteres"
                      className={errors.newPassword ? "pa-field-error" : ""}
                    />
                    {errors.newPassword && <small className="pa-field-help error">{errors.newPassword}</small>}
                  </label>
                  <label className="pa-field">
                    <span>Confirmar contraseña</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: "" })); }}
                      placeholder="Repite la contraseña"
                      className={errors.confirmPassword ? "pa-field-error" : ""}
                    />
                    {errors.confirmPassword && <small className="pa-field-help error">{errors.confirmPassword}</small>}
                  </label>
                  <div className="pa-password-actions">
                    <button
                      className="pa-btn secondary pa-btn-sm"
                      onClick={() => {
                        setShowPasswordForm(false);
                        setNewPassword("");
                        setConfirmPassword("");
                      }}
                      disabled={changingPassword}
                    >
                      Cancelar
                    </button>
                    <button
                      className="pa-btn primary pa-btn-sm"
                      onClick={handleChangePassword}
                      disabled={changingPassword}
                    >
                      {changingPassword ? "Actualizando..." : "Actualizar"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Estado</span>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Estado Laboral</span>
                <div className="pa-status-badge-container">
                  <span className={`pa-status-pill ${isActive ? "active" : "inactive"}`}>
                    {employmentStatus === "empleado" ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="pa-user-detail-actions">
            <button className="pa-btn secondary pa-user-action-btn" onClick={() => onEdit(user)}>
              <Icons.Edit /> Editar
            </button>
            <button className="pa-btn primary pa-user-action-btn" onClick={() => onCreateOrder?.(user)}>
              <Icons.Plus /> Nueva Orden
            </button>
            {user?.id !== currentUserId && (
              <details className="pa-user-more-menu">
                <summary aria-label="Más acciones"><Icons.Menu /></summary>
                <div>
                  <button onClick={() => { onRequestEmploymentToggle(user); }}>
                    {isActive ? "Desactivar empleado" : "Activar empleado"}
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      </ModalShell>

      {showSuccessModal && (
        <div className="pa-success-modal-overlay">
          <div className="pa-success-modal">
            <div className="pa-success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3>Contraseña cambiada correctamente</h3>
            <p>La contraseña del empleado ha sido actualizada exitosamente.</p>
          </div>
        </div>
      )}
    </>
  );
}

const getAdminTabTitle = (tab) => {
  switch (tab) {
    case "overview": return "Panel General";
    case "kpi": return "KPI";
    case "orders": return "Gestión de Órdenes";
    case "credits": return "Gestión de Seguimiento";
    case "notifications": return "Notificaciones";
    case "clients": return "Gestión de Clientes";
    case "materials": return "Gestión de Materiales";
    case "users": return "Gestión de Empleados";
    default: return "Administración";
  }
};

const ADMIN_SIDEBAR_STORAGE_KEY = "neonprint_admin_sidebar_open";

const getInitialAdminSidebarOpen = () => {
  if (typeof window === "undefined") return true;

  try {
    const savedValue = window.localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY);
    return savedValue === null ? true : savedValue === "true";
  } catch {
    return true;
  }
};

const isInteractiveOrderRowTarget = (target) => Boolean(
  target?.closest?.("button, a, input, select, textarea, [data-row-action]")
);

const getLatestCollectionTimestamp = (items = []) => items.reduce((latest, item) => {
  const timestamp = Date.parse(item?.updated_at || item?.created_at || "") || 0;
  return Math.max(latest, timestamp);
}, 0);

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(getInitialAdminSidebarOpen);
  const [activeTab, setActiveTab] = useState(() => (
    typeof window === "undefined" ? "overview" : getAdminTabFromSearch(window.location.search)
  ));
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderOverview, setOrderOverview] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadOrdersError, setLoadOrdersError] = useState(null);
  const [loadUsersError, setLoadUsersError] = useState(null);
  const [savingUser, setSavingUser] = useState(false);
  const [assigningOrder, setAssigningOrder] = useState(null);
  const [assigningRole, setAssigningRole] = useState(null);
  const [assigningLoading, setAssigningLoading] = useState(false);
  const [paymentModalOrder, setPaymentModalOrder] = useState(null);
  const [paymentModalLoading, setPaymentModalLoading] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  const [_savingOrder, setSavingOrder] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;
  const [dateFilter, setDateFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [interventionFilter, setInterventionFilter] = useState("all");
  const [operationalFilter, setOperationalFilter] = useState("all");
  const notif = useNotifications(user?.id);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [userPage, setUserPage] = useState(1);
  const USERS_PER_PAGE = 7;
  // userViewMode eliminado: solo vista tabla
  const [employeeDetailView, setEmployeeDetailView] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const [employeeDeleteLoading, setEmployeeDeleteLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [settingsView, setSettingsView] = useState("list");
  const [settingsOrder, setSettingsOrder] = useState(null);
  useEffect(() => {
    if (settingsView === "detail" && !settingsOrder) {
      setSettingsView("list");
    }
  }, [settingsOrder, settingsView]);
  const [advancedActionLoading, setAdvancedActionLoading] = useState(false);
  const [advancedProduction, setAdvancedProduction] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMode, setOrderModalMode] = useState("create");
  const [orderForm, setOrderForm] = useState(DEFAULT_ORDER_FORM);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalMode, setUserModalMode] = useState("create");
  const [userForm, setUserForm] = useState(DEFAULT_USER_FORM);
  const [userModalError, setUserModalError] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetailModalOpen, setUserDetailModalOpen] = useState(false);
  // Guarda la intención de cambio hasta que el admin confirme la acción en el modal.
  const [employmentStatusConfirmOpen, setEmploymentStatusConfirmOpen] = useState(false);
  const [pendingEmploymentStatusChange, setPendingEmploymentStatusChange] = useState(null);
  const [savingEmploymentStatus, setSavingEmploymentStatus] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [productionTerminations, setProductionTerminations] = useState([]);
  const [productionAreas, setProductionAreas] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [materialFormName, setMaterialFormName] = useState("");
  const [materialFormAreaCode, setMaterialFormAreaCode] = useState("");
  const [materialFormError, setMaterialFormError] = useState("");
  const [materialToDelete, setMaterialToDelete] = useState(null);
  const [materialDeleteLoading, setMaterialDeleteLoading] = useState(false);
  const [selectedMaterialAnalytics, setSelectedMaterialAnalytics] = useState(null);
const [showMaterialAnalyticsOverview, setShowMaterialAnalyticsOverview] = useState(false);
  const [showOrderStatisticsModal, setShowOrderStatisticsModal] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialViewMode, setMaterialViewMode] = useState("materials");
const [materialAreaFilter, setMaterialAreaFilter] = useState("all");
  const [terminationsPage, setTerminationsPage] = useState(1);
  const [showTerminationModal, setShowTerminationModal] = useState(false);
  const [editingTermination, setEditingTermination] = useState(null);
  const [terminationFormName, setTerminationFormName] = useState("");
  const [terminationFormAreaCode, setTerminationFormAreaCode] = useState("");
  const [terminationFormError, setTerminationFormError] = useState("");
  const [clients, setClients] = useState([]);
  const [clientsTotal, setClientsTotal] = useState(0);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [accountsReceivable, setAccountsReceivable] = useState([]);
  const [accountsReceivableLoading, setAccountsReceivableLoading] = useState(true);
  const [recordPaymentClient, setRecordPaymentClient] = useState(null);
  const [recordPaymentForm, setRecordPaymentForm] = useState({ amount: "", payment_method: "", notes: "" });
  const [recordPaymentLoading, setRecordPaymentLoading] = useState(false);
  const [creditSearch, setCreditSearch] = useState("");
  const [creditStatusFilter, setCreditStatusFilter] = useState("open");
  const [creditPage, setCreditPage] = useState(1);
  const [creditView, setCreditView] = useState("list");
  const [creditDetailClientId, setCreditDetailClientId] = useState(null);
  const [selectedCreditOrderIds, setSelectedCreditOrderIds] = useState({});
  const [creditSettleAllTarget, setCreditSettleAllTarget] = useState(null);
  const [creditSettleAllNotes, setCreditSettleAllNotes] = useState("");
  const [creditSettleAllLoading, setCreditSettleAllLoading] = useState(false);
  const [creditSettlementTarget, setCreditSettlementTarget] = useState(null);
  const [creditSettlementNotes, setCreditSettlementNotes] = useState("");
  const [creditSettlementLoading, setCreditSettlementLoading] = useState(false);
  const [creditAlertAcknowledged, setCreditAlertAcknowledged] = useState(true);
  const [creditAlertLoading, setCreditAlertLoading] = useState(false);
  const [creditAlertSaving, setCreditAlertSaving] = useState(false);
  const [creditCustomReminders, setCreditCustomReminders] = useState([]);
  const [creditCustomReminderLinks, setCreditCustomReminderLinks] = useState([]);
  const [creditReminderTarget, setCreditReminderTarget] = useState(null);
  const [creditReminderForm, setCreditReminderForm] = useState({
    remind_at: "",
    note: "",
    orderIds: [],
    visibilityScope: CREDIT_REMINDER_VISIBILITY.CREATOR,
  });
  const [creditReminderSaving, setCreditReminderSaving] = useState(false);
  const [creditReminderDismissedIds, setCreditReminderDismissedIds] = useState([]);
  const [creditReminderCompletingId, setCreditReminderCompletingId] = useState(null);
  const [creditReminderNow, setCreditReminderNow] = useState(null);
  const creditReminderServerClockRef = useRef(null);
  const materialAnalyticsTriggerRef = useRef(null);
  const materialAnalyticsOverviewTriggerRef = useRef(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showOrderClientModal, setShowOrderClientModal] = useState(false);
  const [clientToSelectInOrderForm, setClientToSelectInOrderForm] = useState(null);
  const [clientFieldLocked, setClientFieldLocked] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState(DEFAULT_CLIENT_FORM);
  const [clientFormError, setClientFormError] = useState("");
  const [clientFormErrors, setClientFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [clientDeleteLoading, setClientDeleteLoading] = useState(false);
  const restoredWorkspaceUserRef = useRef(null);
  const loadOrdersRef = useRef(null);
  const orderOverviewLoadedRef = useRef(false);
  const orderOverviewLoadingRef = useRef(false);
  const orderOverviewRequestIdRef = useRef(0);

  const selectAdminTab = useCallback((nextTab, { replace = false } = {}) => {
    const nextSearch = getAdminTabSearch(location.search, nextTab);
    setActiveTab(getAdminTabFromSearch(nextSearch));
    if (nextSearch !== location.search) {
      navigate({ pathname: location.pathname, search: nextSearch }, { replace });
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    setActiveTab((currentTab) => {
      const routeTab = getAdminTabFromSearch(location.search);
      return currentTab === routeTab ? currentTab : routeTab;
    });
  }, [location.search]);

  const recoveryModal = orderModalOpen && orderModalMode === "create"
    ? "create-order"
    : showClientModal && !editingClient
      ? "create-client"
      : showMaterialModal && !editingMaterial
        ? "create-material"
        : null;

  useEffect(() => {
    if (!authUser?.id) return;

    const recovery = buildAdminWorkspaceRecovery({
      userId: authUser.id,
      activeTab,
      modal: recoveryModal,
      clientForm,
      materialFormName,
    });

    if (recovery) {
      writeAdminWorkspaceRecovery(recovery);
    } else {
      clearAdminWorkspaceRecovery(authUser.id);
    }
  }, [activeTab, authUser?.id, clientForm, materialFormName, recoveryModal]);

  const usersById = useMemo(() => Object.fromEntries(profiles.map(item => [item.id, item])), [profiles]);
  const adminVisibleNotifications = useMemo(() => filterActiveNotifications(notif.notifications), [notif.notifications]);
  const adminVisibleToasts = useMemo(() => filterActiveNotifications(notif.toasts), [notif.toasts]);
  const adminUnreadCount = useMemo(() => getActiveUnreadCount(adminVisibleNotifications), [adminVisibleNotifications]);
  const isMaterialCreateReady = Boolean(materialFormName.trim() && materialFormAreaCode);
  const creditAlertPeriodKey = useMemo(() => getCreditAlertPeriodKey(), []);
  const minimumCreditReminderAt = useMemo(() => getMinimumCreditReminderAt(creditReminderNow), [creditReminderNow]);
  const feedbackIdRef = useRef(0);
  const showFeedback = (type, message) => setFeedback({ type, message, id: ++feedbackIdRef.current });
  const showCreditFeedback = useCallback((variant, title, message) => {
    showCreditActionFeedback(notif, {
      variant,
      title,
      message,
      eventKind: "admin_credit_feedback",
    });
  }, [notif]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(sidebarOpen));
    } catch {
      // LocalStorage can be unavailable in private browsing or tests.
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const mobileSidebarQuery = window.matchMedia("(max-width: 768px)");
    const collapseSidebarOnMobile = (event) => {
      if (event.matches) setSidebarOpen(false);
    };

    collapseSidebarOnMobile(mobileSidebarQuery);
    mobileSidebarQuery.addEventListener("change", collapseSidebarOnMobile);
    return () => mobileSidebarQuery.removeEventListener("change", collapseSidebarOnMobile);
  }, []);

  useEffect(() => {
    setUser(authUser || null);
    setProfile(authProfile || null);
  }, [authProfile, authUser]);

  const syncCreditReminderServerTime = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_server_time");
    if (error) {
      console.warn("No se pudo sincronizar la hora del servidor para recordatorios:", error.message || error);
      return null;
    }

    const serverTimeValue = Array.isArray(data) ? data[0] : data;
    const serverNowMs = new Date(serverTimeValue).getTime();
    if (!Number.isFinite(serverNowMs)) {
      console.warn("La hora del servidor para recordatorios no es valida:", serverTimeValue);
      return null;
    }

    const nextClock = {
      serverNowMs,
      clientMonotonicMs: getMonotonicNow(),
    };

    creditReminderServerClockRef.current = nextClock;
    setCreditReminderNow(getCreditReminderServerNow(nextClock));
    return nextClock;
  }, []);

  useEffect(() => {
    if (!user?.id) {
      creditReminderServerClockRef.current = null;
      setCreditReminderNow(null);
      return undefined;
    }

    syncCreditReminderServerTime();

    const interval = setInterval(() => {
      const serverNow = getCreditReminderServerNow(creditReminderServerClockRef.current);
      if (serverNow !== null) {
        setCreditReminderNow(serverNow);
      }
    }, CREDIT_REMINDER_FALLBACK_CHECK_MS);

    const resyncInterval = setInterval(() => {
      syncCreditReminderServerTime();
    }, CREDIT_REMINDER_SERVER_TIME_RESYNC_MS);

    return () => {
      clearInterval(interval);
      clearInterval(resyncInterval);
    };
  }, [syncCreditReminderServerTime, user?.id]);

  const loadOrders = useCallback(async (silent = false, retryCount = 0) => {
    if (!silent) {
      setLoadingOrders(true);
      setLoadOrdersError(null);
    }

    const requestOverview = !orderOverviewLoadedRef.current && !orderOverviewLoadingRef.current;
    const overviewRequestId = requestOverview ? orderOverviewRequestIdRef.current + 1 : null;
    if (requestOverview) {
      orderOverviewRequestIdRef.current = overviewRequestId;
      orderOverviewLoadingRef.current = true;
    }

    try {
      const { response, result } = await adminApiFetch("/api/admin", {
        action: "list-orders",
        page,
        pageSize: PER_PAGE,
        search,
        status: statusFilter,
        dateFilter,
        ownerId: ownerFilter === "all" ? "" : ownerFilter,
        clientId: clientFilter === "all" || clientFilter === NO_CLIENT_FILTER_VALUE ? "" : clientFilter,
        withoutClient: clientFilter === NO_CLIENT_FILTER_VALUE,
        archive: archiveFilter,
        intervention: interventionFilter,
        operational: operationalFilter,
        includeOverview: requestOverview,
      });

      if (!response.ok) {
        const isRateLimit = response.status === 429;
        const isServerError = response.status >= 500;

        if (isRateLimit && retryCount < 2) {
          await new Promise(r => setTimeout(r, 2000 * (retryCount + 1)));
          return loadOrders(silent, retryCount + 1);
        }

        if (isServerError && retryCount < 1) {
          await new Promise(r => setTimeout(r, 1500));
          return loadOrders(silent, retryCount + 1);
        }

        throw new Error(
          isRateLimit
            ? "Demasiadas solicitudes. Espera un momento e intenta de nuevo."
            : result?.error || "No se pudieron cargar las ordenes."
        );
      }

      applyOrdersSnapshot({
        orders: result?.orders,
        setOrders,
        setSelectedOrder,
        openOrderSetters: [setSettingsOrder, setPaymentModalOrder],
        openOrderContainers: [{ setter: setAdvancedProduction }],
        preserveMissingOpenOrders: silent,
      });
      setOrdersTotal(Number.isFinite(Number(result?.total)) ? Number(result.total) : 0);
      if (result?.overview && typeof result.overview === "object") {
        setOrderOverview(result.overview);
        orderOverviewLoadedRef.current = true;
      }
      if (!silent) setLoadingOrders(false);
      return;
    } catch (error) {
      console.error("Error loading orders:", error);
      if (!silent) {
        setLoadOrdersError(error?.message || "No se pudieron cargar las ordenes.");
        setOrders([]);
        setLoadingOrders(false);
      }
      return;
    } finally {
      if (requestOverview && orderOverviewRequestIdRef.current === overviewRequestId) {
        orderOverviewLoadingRef.current = false;
      }
    }
  }, [archiveFilter, clientFilter, dateFilter, interventionFilter, operationalFilter, ownerFilter, page, search, statusFilter]);

  useEffect(() => {
    loadOrdersRef.current = loadOrders;
  }, [loadOrders]);

  const loadProfiles = useCallback(async () => {
    setLoadingUsers(true);
    setLoadUsersError(null);

    try {
      const pageSize = 500;
      let page = 1;
      let total = null;
      const allUsers = [];

      while (total === null || allUsers.length < total) {
        const { response, result } = await adminApiFetch("/api/admin", { action: "list-users", page, pageSize });

        if (!response.ok) {
          throw new Error(result?.error || "No se pudieron cargar usuarios.");
        }

        const users = Array.isArray(result?.users) ? result.users : [];
        allUsers.push(...users);
        total = Number.isFinite(Number(result?.total)) ? Number(result.total) : allUsers.length;

        if (users.length === 0 || page > 100) break;
        page += 1;
      }

      setProfiles(allUsers);
      setLoadingUsers(false);
      return;
    } catch (error) {
      console.error("Error loading profiles:", error);
      setLoadUsersError(error?.message || "No se pudieron cargar usuarios.");
      setProfiles([]);
      setLoadingUsers(false);
      return;
    }

  }, []);

  const fetchMaterials = useCallback(async () => {
    setMaterialsLoading(true);
    try {
      const [materialsResult, terminationsResult, areasResult] = await Promise.all([
        supabase.from("materials").select("id,name,production_area_code,created_at,updated_at").order("name", { ascending: true }),
        supabase.from("production_terminations").select("id,name,production_area_code,created_at,updated_at").order("name", { ascending: true }),
        supabase.from("production_areas").select("code,label").eq("is_active", true).order("label", { ascending: true }),
      ]);
      if (materialsResult.error || terminationsResult.error || areasResult.error) {
        throw materialsResult.error || terminationsResult.error || areasResult.error;
      }
      setMaterials(materialsResult.data || []);
      setProductionTerminations(terminationsResult.data || []);
      setProductionAreas(areasResult.data || []);
    } catch (err) {
      console.error("Error fetching materials:", err);
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const [data, countResult] = await Promise.all([
        searchClients(supabase, "", 100),
        supabase.from("clients").select("id", { count: "exact", head: true }),
      ]);
      if (countResult.error) throw countResult.error;
      setClients(Array.isArray(data) ? data : []);
      setClientsTotal(countResult.count || 0);
    } catch (err) {
      console.warn("No se pudieron cargar clientes:", err?.message || err);
      setClients([]);
      setClientsTotal(0);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const refreshAdminOrdersSilently = useCallback(() => loadOrders(true), [loadOrders]);
  useOrdersRealtimeSync({
    userId: authUser?.id,
    scope: "admin",
    refreshOrders: refreshAdminOrdersSilently,
  });

  const fetchAccountsReceivable = useCallback(async () => {
    setAccountsReceivableLoading(true);
    try {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("id,order_id,client_id,original_amount,balance,status,issued_at,due_date,created_by,created_at,updated_at,invoice_number,resolved_at,resolved_by,resolution_note,voided_at,voided_by,void_reason,client:clients(id,name,phone,email,address,notes,created_at,updated_at)")
        .order("issued_at", { ascending: false });

      if (error) {
        if (!String(error.message || "").includes("accounts_receivable")) {
          console.warn("No se pudieron cargar cuentas por cobrar:", error.message);
        }
        setAccountsReceivable([]);
        return;
      }

      setAccountsReceivable(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("No se pudieron cargar cuentas por cobrar:", err?.message || err);
      setAccountsReceivable([]);
    } finally {
      setAccountsReceivableLoading(false);
    }
  }, []);

  const fetchCreditCustomReminders = useCallback(async () => {
    if (!user?.id) {
      setCreditCustomReminders([]);
      setCreditCustomReminderLinks([]);
      return;
    }

    try {
      const [{ data: reminders, error: remindersError }, { data: links, error: linksError }] = await Promise.all([
        supabase
          .from("credit_custom_reminders")
          .select("*")
          .in("status", ["scheduled", "due"])
          .order("remind_at", { ascending: true }),
        supabase
          .from("credit_custom_reminder_orders")
          .select("*")
          .order("created_at", { ascending: true }),
      ]);

      if (remindersError) throw remindersError;
      if (linksError) throw linksError;

      setCreditCustomReminders(Array.isArray(reminders) ? reminders : []);
      setCreditCustomReminderLinks(Array.isArray(links) ? links : []);
    } catch (error) {
      if (!String(error?.message || "").includes("credit_custom_reminders")) {
        console.warn("No se pudieron cargar recordatorios de crédito:", error?.message || error);
      }
      setCreditCustomReminders([]);
      setCreditCustomReminderLinks([]);
    }
  }, [user?.id]);

  const dispatchDueCreditReminderNotifications = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { error } = await supabase.rpc("dispatch_due_credit_reminder_notifications");
      if (error) throw error;
    } catch (error) {
      if (!String(error?.message || "").includes("dispatch_due_credit_reminder_notifications")) {
        console.warn("No se pudieron emitir notificaciones de recordatorios de credito:", error?.message || error);
      }
    }
  }, [user?.id]);

  const handleHeaderRefresh = useCallback(async () => {
    switch (activeTab) {
      case "orders":
        await loadOrders();
        break;
      case "credits":
        await fetchAccountsReceivable();
        await fetchCreditCustomReminders();
        break;
      case "clients":
        await fetchClients();
        break;
      case "materials":
        await fetchMaterials();
        break;
      case "users":
        await loadProfiles();
        break;
      case "kpi":
        break;
      default:
        await loadOrders();
        await fetchAccountsReceivable();
        await fetchCreditCustomReminders();
        await fetchClients();
        break;
    }
  }, [activeTab, loadOrders, fetchAccountsReceivable, fetchCreditCustomReminders, fetchClients, fetchMaterials, loadProfiles]);

  useEffect(() => {
    if (!authUser?.id) return undefined;

    loadOrdersRef.current?.();
    dispatchDueCreditReminderNotifications();

    const relatedDataChannel = supabase
      .channel(`admin-related-data-${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts_receivable' }, () => {
        loadOrdersRef.current?.(true);
        fetchAccountsReceivable();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchClients();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_custom_reminders' }, () => {
        fetchCreditCustomReminders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_custom_reminder_orders' }, () => {
        fetchCreditCustomReminders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(relatedDataChannel);
    };
  }, [authUser?.id, dispatchDueCreditReminderNotifications, fetchAccountsReceivable, fetchClients, fetchCreditCustomReminders]);

  // The server is the source of truth for operational filtering.  Debouncing
  // search avoids a full request for every keystroke while changing a filter
  // still resets to page one through the existing controls.
  useEffect(() => {
    if (!authUser?.id) return undefined;
    const timeout = window.setTimeout(() => { void loadOrders(); }, search ? 280 : 0);
    return () => window.clearTimeout(timeout);
  }, [authUser?.id, loadOrders, search]);

  useEffect(() => {
    if (!authUser?.id || restoredWorkspaceUserRef.current === authUser.id) return;

    restoredWorkspaceUserRef.current = authUser.id;
    const recovery = readAdminWorkspaceRecovery(authUser.id);
    if (!recovery) return;

    if (!new URLSearchParams(location.search).has("tab") && recovery.activeTab !== "overview") {
      selectAdminTab(recovery.activeTab, { replace: true });
    }

    if (recovery.modal === "create-order") {
      setOrderModalMode("create");
      setEditingOrder(null);
      setClientFieldLocked(false);
      setOrderModalOpen(true);
      return;
    }

    if (recovery.modal === "create-client") {
      setEditingClient(null);
      setClientForm(recovery.clientForm);
      setClientFormError("");
      setClientFormErrors({});
      setShowClientModal(true);
      return;
    }

    setEditingMaterial(null);
    setMaterialFormName(recovery.materialFormName);
    setMaterialFormError("");
    setShowMaterialModal(true);
  }, [authUser?.id, location.search, selectAdminTab]);

  useEffect(() => {
    if (!user?.id) {
      setCreditAlertAcknowledged(true);
      return;
    }

    let active = true;
    const loadCreditAlertAck = async () => {
      setCreditAlertLoading(true);
      try {
        const { data, error } = await supabase
          .from("credit_pending_alert_acknowledgements")
          .select("id")
          .eq("user_id", user.id)
          .eq("period_key", creditAlertPeriodKey)
          .limit(1);

        if (error) throw error;
        if (active) setCreditAlertAcknowledged((data || []).length > 0);
      } catch (error) {
        console.warn("No se pudo consultar el acuse de créditos pendientes:", error?.message || error);
        if (active) setCreditAlertAcknowledged(true);
      } finally {
        if (active) setCreditAlertLoading(false);
      }
    };

    loadCreditAlertAck();
    return () => {
      active = false;
    };
  }, [creditAlertPeriodKey, user?.id]);

  const acknowledgeCreditPendingAlert = async ({ review = false } = {}) => {
    if (!user?.id) return;

    setCreditAlertSaving(true);
    try {
      const { error } = await supabase
        .from("credit_pending_alert_acknowledgements")
        .insert({
          user_id: user.id,
          period_key: creditAlertPeriodKey,
          acknowledged_at: new Date().toISOString(),
        });

      if (error && error.code !== "23505") throw error;
      setCreditAlertAcknowledged(true);
      if (review) {
        selectAdminTab("credits");
        setCreditView("list");
        setCreditStatusFilter("open");
      }
    } catch (error) {
      console.warn("No se pudo guardar el acuse de créditos pendientes:", error?.message || error);
      showFeedback("error", "No se pudo guardar el aviso de créditos pendientes.");
    } finally {
      setCreditAlertSaving(false);
    }
  };

  const handleClientSearch = useCallback(async (query) => {
    const results = await searchClients(supabase, query);
    setClients((prev) => {
      const byId = new Map(prev.map((client) => [client.id, client]));
      results.forEach((client) => byId.set(client.id, client));
      return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    return results;
  }, []);

  const handleOrderClientCreated = useCallback(async (client) => {
    await fetchClients();
    setClientToSelectInOrderForm(client || null);
  }, [fetchClients]);

  useEffect(() => {
    if (activeTab === "materials") {
      fetchMaterials();
    }
    if (activeTab === "overview" || activeTab === "clients" || activeTab === "orders" || activeTab === "credits") {
      fetchClients();
      fetchAccountsReceivable();
    }
    if (activeTab === "credits") {
      fetchCreditCustomReminders();
    }
    if (activeTab === "users" || activeTab === "orders") {
      loadProfiles();
    }
  }, [activeTab, fetchAccountsReceivable, fetchClients, fetchCreditCustomReminders, fetchMaterials, loadProfiles]);

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  // Funcionalidad para  resetea el formulario de ordenes
  const _resetOrderForm = (order = null) => {
    if (!order) {
      setOrderForm({ ...DEFAULT_ORDER_FORM, id: "" });
      return;
    }
    setOrderForm({
      id: order.id || "",
      client_id: order.client_id || null,
      client_name: order.client_name || "",
      client_contact: order.client_contact || "",
      invoice_number: order.invoice_number || "",
      description: order.description || "",
      material: order.material || "",
      order_type: order.order_type || "normal",
      design_type: order.order_design_type || "INTERNAL_DESING",
      termination_type: order.termination_type || "",
      delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
      indefinido: !order.delivery_date,
      status: normalizeOrderStatus(order.status || ORDER_STATUS.PENDING),
      payment_status: order.payment_status || "Pending_Payment",
      seller_id: order.seller_id || order.created_by || "",
      existingFiles: parseFileUrls(order.order_file_url),
      newFiles: [],
      removedFiles: [],
      existingPreview: order.preview_image || null,
      newPreview: null,
      removePreview: false,
    });
  };

  const openCreateOrder = (client = null, options = {}) => {
    const selectedClient = client?.id ? client : null;
    setOrderModalMode("create");
    setEditingOrder(null);
    setClientToSelectInOrderForm(selectedClient);
    setClientFieldLocked(!!options.lockClient);
    setOrderForm({
      ...DEFAULT_ORDER_FORM,
      id: "",
      ...(selectedClient ? getSelectedClientOrderFields(selectedClient, "client_contact") : {}),
    });
    fetchClients();
    fetchMaterials();
    setOrderModalOpen(true);
  };

  const handleCreateOrderFromUser = (user) => {
    const pseudoClient = { id: user.id, name: getUserDisplayName(user), phone: user.email || "" };
    openCreateOrder(pseudoClient, { lockClient: true });
  };

  const openCreateOrderFromClient = (client) => {
    openCreateOrder(client, { lockClient: true });
  };

  const openEditOrder = (order) => {
    setSelectedOrder(null); // Cerrar detail modal primero
    setOrderModalMode("edit");
    setEditingOrder(order);
    fetchClients();
    fetchMaterials();
    setOrderModalOpen(true);
  };

  const _handleSaveOrder = async () => {
    if (!orderForm.client_id) return showFeedback("error", "Debes seleccionar un cliente registrado.");
    if (!orderForm.client_name.trim()) return showFeedback("error", "Selecciona un cliente registrado para completar el nombre.");
    if (!orderForm.client_contact.trim()) return showFeedback("error", "Selecciona un cliente registrado con telefono.");
    if (!orderForm.description.trim()) return showFeedback("error", "La descripcion es obligatoria.");

    const payload = {
      client_id: orderForm.client_id,
      client_name: orderForm.client_name.trim(),
      client_contact: orderForm.client_contact.trim() || null,
      invoice_number: orderForm.invoice_number.trim() || null,
      description: orderForm.description.trim(),
      material: orderForm.material.trim() || null,
      termination_type: orderForm.termination_type.trim() || null,
      order_type: orderForm.order_type,
      order_design_type: orderForm.design_type,
      delivery_date: !orderForm.delivery_date ? null : (orderForm.indefinido ? null : orderForm.delivery_date),
      status: ORDER_STATUS.PENDING,
      payment_status: orderForm.payment_status,
      seller_id: user?.id || null,
      created_by: user?.id || null,
    };

    setSavingOrder(true);

    let finalPreviewUrl = orderForm.existingPreview;
    let finalFileUrls = [...orderForm.existingFiles];

    // Subir nuevos archivos de diseño
    for (const file of orderForm.newFiles) {
      const fileName = buildStorageSafeFileName(file, "design-");
      const publicUrl = await uploadOrderAsset({
        bucket: "order-docs",
        path: `orders/${orderForm.id || selectedOrder?.id || "new"}/files/${fileName}`,
        file,
      });
      if (publicUrl) finalFileUrls.push(publicUrl);
    }

    // Subir nuevo preview
    if (orderForm.newPreview) {
      const fileName = buildStorageSafeFileName(orderForm.newPreview, "preview-");
      finalPreviewUrl = await uploadOrderAsset({
        bucket: "order-previews",
        path: `orders/${orderForm.id || selectedOrder?.id || "new"}/preview/${fileName}`,
        file: orderForm.newPreview,
      });
    }

    // Si se eliminó el preview existente
    if (orderForm.removePreview || (!orderForm.newPreview && orderForm.existingPreview && orderForm.removePreview)) {
      finalPreviewUrl = null;
    }

    // Eliminar archivos removidos
    const remainingFiles = finalFileUrls.filter(url => !orderForm.removedFiles.includes(url));

    payload.preview_image = finalPreviewUrl;
    payload.order_file_url = remainingFiles.length > 0 ? serializeFileUrls(remainingFiles) : null;

    // This legacy handler is no longer wired by the dashboard (creation and
    // editing use CreateOrderModal/SharedEditOrderModal). Keep it fail-closed
    // until it can be deleted, rather than retaining a direct table writer.
    const error = new Error("El formulario heredado no admite guardar ordenes directamente.");

    setSavingOrder(false);

    if (error) return showFeedback("error", isTimeoutError(error) ? FRIENDLY_TIMEOUT_MESSAGE : `No se pudo guardar la orden: ${error.message}`);

    setOrderModalOpen(false);
    setSelectedOrder(null);
    _resetOrderForm();
    await loadOrders();
    showFeedback("success", orderModalMode === "create" ? "Orden creada correctamente." : "Orden actualizada correctamente.");
  };

  const openCancelModal = (order) => {
    if (isPaymentPartial(order.payment_status)) {
      showFeedback("error", "No se puede cancelar una orden con pago parcial.");
      return;
    }

    if (isOrderStatus(order.status, ORDER_STATUS.CANCELLED)) {
      showFeedback("error", "No se puede cancelar una orden ya cancelada.");
      return;
    }
    setCancelOrderData(order);
    setCancelReason("");
    setCancelModalOpen(true);
  };

  const openAdvancedSettings = (order) => {
    setSelectedOrder(null);
    setSettingsOrder(order);
    setSettingsView("detail");
    selectAdminTab("orders");
  };

  const handleConfirmCancelOrder = async () => {
    if (!cancelOrderData) return;
    if (cancelReason.trim().length < 10) {
      showFeedback("error", "Explica el motivo de cancelación con al menos 10 caracteres.");
      return;
    }
    if (isPaymentPartial(cancelOrderData.payment_status)) {
      showFeedback("error", "No se puede cancelar una orden con pago parcial.");
      setCancelModalOpen(false);
      setCancelOrderData(null);
      return;
    }

    setCancelLoading(true);

    let commandError;
    try {
      await executeAdminOrderCommand(supabase, {
        orderId: cancelOrderData.id,
        action: "cancel_order",
        payload: {},
        reasonCategory: "workflow_correction",
        reasonDetail: cancelReason.trim(),
        expectedUpdatedAt: cancelOrderData.updated_at,
      });
    } catch (error) {
      commandError = error;
    }

    setCancelLoading(false);

    if (commandError) {
      return showFeedback("error", commandError.message || "No se pudo cancelar la orden.");
    }

    setCancelModalOpen(false);
    setCancelOrderData(null);
    if (selectedOrder?.id === cancelOrderData.id) setSelectedOrder(null);
    await loadOrders();
    showFeedback("success", "La orden fue cancelada correctamente.");
  };

  const openAssignModal = (order, role) => {
    setAssigningOrder(order);
    setAssigningRole(role);
  };

  const openArchiveModal = (order) => {
    if (!canArchiveOrder(order, ARCHIVE_MODULES.ADMIN, user?.id)) {
      showFeedback("error", "Solo se pueden archivar órdenes canceladas, completadas o entregadas.");
      return;
    }
    setArchivingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;
    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.ADMIN);
    setArchiveLoading(false);
    if (error) {
      return showFeedback("error", "No se pudo archivar la orden.");
    }
    if (selectedOrder?.id === archivingOrder.id) {
      setSelectedOrder((prev) => prev ? { ...prev, is_archived_admin: true } : prev);
    }
    setArchivingOrder(null);
    await loadOrders();
    showFeedback("success", "La orden fue archivada correctamente.");
  };

  const handleAssignOrder = async (userId) => {
    if (!assigningOrder || !assigningRole) return;
    setAssigningLoading(true);

    const isDesigner = assigningRole === "designer";
    let commandError;
    try {
      await executeAdminOrderCommand(supabase, {
        orderId: assigningOrder.id,
        action: isDesigner ? "route_design" : "route_quote",
        payload: userId ? { target_user_id: userId } : {},
        reasonCategory: "assignment_correction",
        reasonDetail: "Asignación realizada por Administración desde el detalle de la orden.",
        expectedUpdatedAt: assigningOrder.updated_at,
      });
    } catch (error) {
      commandError = error;
    }

    setAssigningLoading(false);

    if (commandError) {
      showFeedback("error", commandError.message || "No se pudo asignar la orden.");
      return;
    }

    setAssigningOrder(null);
    setAssigningRole(null);
    await loadOrders();
    showFeedback("success", `Orden asignada a ${isDesigner ? "diseñador" : "caja"} correctamente.`);
  };

  const openPaymentModal = (order) => {
    setPaymentModalOrder(order);
  };

  const handlePaymentConfirm = async ({ paymentStatus, receiptFile, invoiceNumber }) => {
    let currentOrder = paymentModalOrder;
    if (!currentOrder) return;

    const requestedInvoiceNumber = String(invoiceNumber || "").trim();
    if (currentOrder.invoice_assignment_mode === "cashier"
      && requestedInvoiceNumber
      && requestedInvoiceNumber !== String(currentOrder.invoice_number || "").trim()) {
      setPaymentModalLoading(true);
      const { data: assignedOrder, error: assignError } = await supabase.rpc("quote_assign_invoice_code", {
        p_order_id: currentOrder.id,
        p_invoice_number: requestedInvoiceNumber,
        p_expected_updated_at: currentOrder.updated_at,
      });
      setPaymentModalLoading(false);
      if (assignError || !assignedOrder) {
        throw new Error(assignError?.message || "No se pudo guardar el código de facturación.");
      }
      currentOrder = { ...currentOrder, ...assignedOrder };
      setPaymentModalOrder(currentOrder);
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      setPaymentModalLoading(true);
        const { error } = await supabase.rpc("mark_order_as_credit", {
          p_order_id: currentOrder.id,
          p_due_date: null,
          p_expected_updated_at: currentOrder.updated_at,
        });
      setPaymentModalLoading(false);

      if (error) {
        throw new Error(error.message || "No se pudo aprobar el crédito.");
      }

      setPaymentModalOrder(null);
      await Promise.all([loadOrders(), fetchAccountsReceivable()]);
      return;
    }

    setPaymentModalLoading(true);

    let paymentInvoiceUrl = null;

    if (receiptFile) {
      const validation = await validateReceiptFile(receiptFile);
      if (!validation.isValid) {
        setPaymentModalLoading(false);
        throw new Error(validation.error || "La imagen no es válida.");
      }

      try {
        const filePath = buildPaymentReceiptPath(currentOrder.id, receiptFile.name);
        const publicUrl = await uploadOrderAsset({
          bucket: "payment-invoice",
          path: filePath,
          file: receiptFile,
        });
        if (publicUrl) {
          paymentInvoiceUrl = publicUrl;
        } else {
          setPaymentModalLoading(false);
          throw new Error("Error al subir la imagen de pago.");
        }
      } catch (uploadError) {
        setPaymentModalLoading(false);
        throw new Error(uploadError?.message || "Error al subir la imagen de pago.");
      }
    }

    let commandError;
    try {
      await executeAdminOrderCommand(supabase, {
        orderId: currentOrder.id,
        action: "register_payment",
        payload: {
          payment_status: paymentStatus,
          invoice_payment: paymentInvoiceUrl,
          invoice_number: requestedInvoiceNumber || undefined,
        },
        reasonCategory: "workflow_correction",
        reasonDetail: "Pago registrado por Administración desde el listado de órdenes.",
        expectedUpdatedAt: currentOrder.updated_at,
      });
    } catch (error) {
      commandError = error;
    }

    setPaymentModalLoading(false);

    if (commandError) {
      throw new Error(commandError.message || "Error al actualizar la orden.");
    }

    setPaymentModalOrder(null);
    await loadOrders();
    showFeedback("success", paymentStatus === PAYMENT_STATUS.PARTIAL ? "Pago parcial registrado correctamente." : "Orden cotizada correctamente.");
  };

  const fetchAdvancedOrderForProduction = useCallback(async (order) => {
    if (!order?.id) return order;
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_production_files(*)")
      .eq("id", order.id)
      .single();
    if (error || !data) {
      console.warn("No se pudieron cargar los archivos de produccion para Administracion:", error?.message || error);
      return order;
    }
    return {
      ...order,
      ...data,
      order_production_files: Array.isArray(data.order_production_files)
        ? data.order_production_files
        : order.order_production_files,
    };
  }, []);

  const handleAdvancedAction = async ({ action, targetUserId, reasonCategory, reasonDetail, expectedUpdatedAt, areaAssignments, payload = {} }) => {
    if (!settingsOrder) return;
    if (action === "route_production" || action === "reassign_production") {
      const freshOrder = orders.find((item) => item.id === settingsOrder.id) || settingsOrder;
      setAdvancedActionLoading(true);
      const hydratedOrder = await fetchAdvancedOrderForProduction(freshOrder);
      setAdvancedActionLoading(false);
      setAdvancedProduction({
        order: hydratedOrder,
        reasonCategory,
        reasonDetail,
        expectedUpdatedAt: hydratedOrder?.updated_at || expectedUpdatedAt,
        action,
        areaAssignments,
        payload,
      });
      return;
    }
    setAdvancedActionLoading(true);
    let data;
    let commandError;
    try {
      data = await executeAdminOrderCommand(supabase, {
        orderId: settingsOrder.id,
        action,
        reasonCategory,
        reasonDetail,
        expectedUpdatedAt,
        payload: { ...payload, target_user_id: targetUserId, area_assignments: areaAssignments || {} },
      });
    } catch (error) {
      commandError = error;
    }
    setAdvancedActionLoading(false);
    if (commandError) {
      const message = commandError.message || "No se pudo aplicar el ajuste.";
      showFeedback("error", message);
      throw new Error(message);
    }
    const updatedOrder = data?.order;
    if (updatedOrder?.id) {
      setSettingsOrder((current) => current?.id === updatedOrder.id ? { ...current, ...updatedOrder } : current);
    }
    await loadOrders();
    const completedAction = data?.action || action;
    const successMsg = completedAction === "route_quote" ? "Orden enviada a Caja"
      : completedAction === "return_to_quote" ? "Orden regresada a Caja"
      : completedAction === "mark_delivered" ? "Orden marcada como Entregada"
      : completedAction === "return_to_completed" ? "Orden regresada a Completado"
      : completedAction === "route_design" ? "Orden enviada a Diseño"
      : completedAction === "set_designer_assignee" ? "Diseñador actualizado"
      : completedAction === "return_to_design" ? "Orden regresada a Diseño"
      : completedAction === "assign_seller" ? "Vendedor reasignado"
      : completedAction === "block_order" ? "Orden bloqueada"
      : completedAction === "resume_order" ? "Orden reanudada"
      : completedAction === "set_priority" ? "Prioridad actualizada"
      : completedAction === "reclassify_design" ? "Tipo de diseño actualizado"
      : completedAction === "update_requirements" ? "Requisitos versionados"
      : completedAction === "cancel_order" ? "Orden cancelada"
      : completedAction === "reopen_cancelled" ? "Orden reabierta"
      : "Ajuste guardado";
    showFeedback("success", `${successMsg} correctamente.`);
    return data;
  };

  const handleAdvancedProductionConfirm = async (assignments) => {
    if (!advancedProduction?.order) return;
    const productionAction = advancedProduction.action || "route_production";
    const mergedAssignments = { ...(advancedProduction.areaAssignments || {}), ...assignments };
    setAdvancedActionLoading(true);
    let data;
    let commandError;
    try {
      data = await executeAdminOrderCommand(supabase, {
        orderId: advancedProduction.order.id,
        action: productionAction,
        reasonCategory: advancedProduction.reasonCategory,
        reasonDetail: advancedProduction.reasonDetail,
        expectedUpdatedAt: advancedProduction.expectedUpdatedAt,
        payload: { ...(advancedProduction.payload || {}), area_assignments: mergedAssignments },
      });
    } catch (error) {
      commandError = error;
    }
    setAdvancedActionLoading(false);
    if (commandError) return showFeedback("error", commandError.message || "No se pudo completar la operación.");
    setAdvancedProduction(null);
    if (data?.order?.id) {
      setSettingsOrder((current) => current?.id === data.order.id ? { ...current, ...data.order } : current);
    }
    await loadOrders();
    const msg = productionAction === "reassign_production" ? "Producción reasignada correctamente." : "Orden enviada a Producción correctamente.";
    showFeedback("success", msg);
  };

  const openCreateUserModal = () => {
    setUserModalMode("create");
    setSelectedUser(null);
    setUserForm(DEFAULT_USER_FORM);
    setUserModalError("");
    setUserModalOpen(true);
  };

  const openEditUserModal = (profileItem) => {
    setUserModalMode("edit");
    setUserModalError("");
    setSelectedUser(profileItem);
    setUserDetailModalOpen(false);
    setUserForm({
      name: getUserDisplayName(profileItem),
      email: profileItem?.email || "",
      password: "",
      confirmPassword: "",
      role: profileItem?.role || "seller",
      employment_status: isEmploymentActive(profileItem),
    });
    setUserModalOpen(true);
  };

  const closeUserModal = () => {
    setUserModalOpen(false);
    setUserModalMode("create");
    setUserForm(DEFAULT_USER_FORM);
    setUserModalError("");
  };

  // Funcionalidad para registrar usuarios
  const handleCreateUser = async () => {
    const trimmedName = userForm.name.trim();
    const trimmedEmail = userForm.email.trim().toLowerCase();
    const password = userForm.password;
    const validation = validateEmployeeForm(userForm, "create");

    if (!validation.hasRequiredIdentity) {
      return showFeedback("error", "Nombre, email y rol son obligatorios.");
    }

    if (validation.passwordError) {
      return showFeedback("error", validation.passwordError);
    }

    if (!validation.passwordsMatch) {
      return showFeedback("error", "Las contraseñas no coinciden.");
    }

    setSavingUser(true);
    let response;
    let result;
    try {
      ({ response, result } = await adminApiFetch("/api/admin", {
          action: "create-user",
          name: trimmedName,
          email: trimmedEmail,
          password,
          role: userForm.role,
        }));
    } catch (err) {
      setSavingUser(false);
      setUserModalError(isTimeoutError(err) ? FRIENDLY_TIMEOUT_MESSAGE : "No se pudo conectar con el servicio de creación de usuarios.");
      return;
    }

    setSavingUser(false);

    if (!response.ok) {
      setUserModalError(result?.error || "No se pudo crear el usuario.");
      return;
    }

    closeUserModal();
    await loadProfiles();
    notif.showActionNotification({
      type: "info",
      title: "Usuario creado",
      message: `Usuario ${trimmedName} creado correctamente.`,
      metadata: {
        variant: "success",
        event_kind: "admin_user_created",
        user_id: result?.user?.id || null,
      },
    });

  };

  const handleUpdateUser = async () => {
    if (!selectedUser?.id) {
      return showFeedback("error", "Selecciona un empleado para editar.");
    }

    const trimmedName = userForm.name.trim();
    const trimmedEmail = userForm.email.trim().toLowerCase();
    const password = userForm.password;
    const validation = validateEmployeeForm(userForm, "edit");

    if (!validation.hasRequiredIdentity) {
      return showFeedback("error", "Nombre, email y rol son obligatorios.");
    }

    if (validation.passwordError) {
      return showFeedback("error", validation.passwordError);
    }

    if (!validation.passwordsMatch) {
      return showFeedback("error", "Las contraseñas no coinciden.");
    }

    setSavingUser(true);
    let response;
    let result;
    try {
      ({ response, result } = await adminApiFetch("/api/admin", {
          action: "update-user",
          userId: selectedUser.id,
          name: trimmedName,
          email: trimmedEmail,
          password: password || undefined,
          role: userForm.role,
        }));
    } catch (err) {
      setSavingUser(false);
      return showFeedback("error", isTimeoutError(err) ? FRIENDLY_TIMEOUT_MESSAGE : "No se pudo conectar con el servicio de edición de empleados.");
    }

    setSavingUser(false);

    if (!response.ok) {
      return showFeedback("error", result?.error || "No se pudo actualizar el empleado.");
    }

    const updatedUser = result?.user ? { ...selectedUser, ...result.user } : {
      ...selectedUser,
      name: trimmedName,
      email: trimmedEmail,
      role: userForm.role,
    };

    closeUserModal();
    setSelectedUser(updatedUser);
    await loadProfiles();
    notif.showActionNotification({
      type: "info",
      title: "Usuario actualizado",
      message: `Usuario ${getUserDisplayName(updatedUser)} actualizado correctamente.`,
      metadata: {
        variant: "success",
        event_kind: "admin_user_updated",
        user_id: updatedUser.id,
      },
    });
  };

  const handleSaveUser = () => (
    userModalMode === "edit" ? handleUpdateUser() : handleCreateUser()
  );

  // Prepara el cambio de estado, pero no actualiza la base hasta que el admin confirme.
  const openEmploymentStatusConfirm = (profile) => {
    const isDeactivating = !isEmploymentActive(profile);
    const isSelf = profile.id === user?.id;

    if (isSelf && isDeactivating) {
      showFeedback("error", "No puedes desactivar tu propia cuenta de administrador.");
      return;
    }

    setPendingEmploymentStatusChange({
      userId: profile.id,
      userName: getUserDisplayName(profile),
      nextStatus: !isEmploymentActive(profile),
    });
    setEmploymentStatusConfirmOpen(true);
  };

  // Cierra el modal y limpia el estado temporal para evitar cambios accidentales.
  const closeEmploymentStatusConfirm = () => {
    setEmploymentStatusConfirmOpen(false);
    setPendingEmploymentStatusChange(null);
  };

  // Aplica el cambio real en la base usando el campo booleano employment_status.
  const handleEmploymentStatusChange = async (profileId, nextStatus, userName) => {
    setSavingEmploymentStatus(true);
    let response;
    let result;

    try {
      ({ response, result } = await adminApiFetch("/api/admin", {
          action: "set-user-status",
          userId: profileId,
          employment_status: nextStatus,
        }));
    } catch (err) {
      setSavingEmploymentStatus(false);
      return showFeedback("error", isTimeoutError(err) ? FRIENDLY_TIMEOUT_MESSAGE : "No se pudo conectar con el servicio de usuarios.");
    }

    setSavingEmploymentStatus(false);

    if (!response.ok) {
      return showFeedback("error", result?.error || "No se pudo actualizar el estado del usuario.");
    }

    await loadProfiles();
    notif.showActionNotification({
      type: "info",
      title: nextStatus ? "Usuario activado" : "Usuario desactivado",
      message: `Usuario ${userName} ${nextStatus ? "activado" : "desactivado"} correctamente.`,
      metadata: {
        variant: "success",
        event_kind: nextStatus ? "admin_user_activated" : "admin_user_deactivated",
        user_id: profileId,
      },
    });
  };

  // Si el admin confirma, recién aquí se persiste el cambio.
  const confirmEmploymentStatusChange = async () => {
    if (!pendingEmploymentStatusChange) return;

    const isDeactivating = pendingEmploymentStatusChange.nextStatus === false;
    const isSelf = pendingEmploymentStatusChange.userId === user?.id;

    if (isSelf && isDeactivating) {
      showFeedback("error", "No puedes desactivar tu propia cuenta de administrador.");
      closeEmploymentStatusConfirm();
      return;
    }

    await handleEmploymentStatusChange(
      pendingEmploymentStatusChange.userId,
      pendingEmploymentStatusChange.nextStatus,
      pendingEmploymentStatusChange.userName
    );

    closeEmploymentStatusConfirm();
  };

  const openEmployeeDetail = (profile) => {
    setSelectedEmployeeId(profile?.id || null);
    setUserDetailModalOpen(false);
    setEmployeeDetailView(true);
  };

  const closeEmployeeDetail = () => {
    setSelectedEmployeeId(null);
    setEmployeeDetailView(false);
  };

  const requestEmployeeRetirement = async (profile) => {
    if (!profile?.id) return;
    try {
      const { response, result } = await adminApiFetch("/api/admin", { action: "retirement-preflight", userId: profile.id });
      if (!response.ok) throw new Error(result?.error || "No se pudo revisar el trabajo activo.");
      if (!result.canRetire) {
        showFeedback("error", `Reasigna primero ${result.responsibilities?.length || 0} responsabilidad(es) activa(s) de este empleado.`);
        return;
      }
      setEmployeeToDelete(profile);
    } catch (err) {
      showFeedback("error", err?.message || "No se pudo revisar la baja del empleado.");
    }
  };

  const handleConfirmDeleteEmployee = async () => {
    if (!employeeToDelete) return;

    if (employeeToDelete.id === user?.id) {
      showFeedback("error", "No puedes eliminar tu propia cuenta de administrador mientras tengas la sesión iniciada.");
      setEmployeeToDelete(null);
      return;
    }

    setEmployeeDeleteLoading(true);
    try {
      const { response, result } = await adminApiFetch("/api/admin", {
        action: "retire-user",
        userId: employeeToDelete.id,
      });
      if (!response.ok || result.error) throw new Error(result.error || "No se pudo dar de baja al empleado.");
      setEmployeeToDelete(null);
      closeEmployeeDetail();
      loadProfiles();
      showFeedback("success", result?.message || "Empleado dado de baja correctamente.");
    } catch (err) {
      showFeedback("error", err?.message || "No se pudo dar de baja al empleado.");
    } finally {
      setEmployeeDeleteLoading(false);
    }
  };

  const handleRestoreEmployee = async (profile) => {
    if (!profile?.id) return;
    try {
      const { response, result } = await adminApiFetch("/api/admin", { action: "restore-user", userId: profile.id });
      if (!response.ok) throw new Error(result?.error || "No se pudo restaurar al empleado.");
      await loadProfiles();
      showFeedback("success", result?.message || "Empleado restaurado correctamente.");
    } catch (err) {
      showFeedback("error", err?.message || "No se pudo restaurar al empleado.");
    }
  };

  const handleAddMaterial = () => {
    setEditingMaterial(null);
    setMaterialFormName("");
    setMaterialFormAreaCode("");
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleEditMaterial = (mat) => {
    setEditingMaterial(mat);
    setMaterialFormName(mat.name);
    setMaterialFormAreaCode(mat.production_area_code || "");
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleSaveMaterial = async () => {
    const name = materialFormName.trim();
    const production_area_code = materialFormAreaCode;
    if (!name || name.length < 2) {
      setMaterialFormError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    if (!production_area_code) {
      setMaterialFormError("Selecciona el área de producción.");
      return;
    }
    try {
      if (editingMaterial) {
        const { error } = await supabase
          .from("materials")
          .update({ name, production_area_code, updated_at: new Date().toISOString() })
          .eq("id", editingMaterial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("materials")
          .insert({ name, production_area_code });
        if (error) {
          if (error.code === "23505") {
            setMaterialFormError("Ya existe un material con ese nombre.");
            return;
          }
          throw error;
        }
      }
      setShowMaterialModal(false);
      fetchMaterials();
    } catch (err) {
      setMaterialFormError(err.message || "Error al guardar el material.");
    }
  };

  const handleDeleteMaterial = (mat) => {
    setMaterialToDelete(mat);
  };

  const handleConfirmDeleteMaterial = async () => {
    if (!materialToDelete) return;
    setMaterialDeleteLoading(true);
    try {
      const { error } = await supabase.from("materials").delete().eq("id", materialToDelete.id);
      if (error) throw error;
      setMaterialToDelete(null);
      fetchMaterials();
      showFeedback("success", "Material eliminado correctamente.");
    } catch {
      showFeedback("error", "No se pudo eliminar el material.");
    } finally {
      setMaterialDeleteLoading(false);
    }
  };

  const handleAddClient = () => {
    setEditingClient(null);
    setClientForm(DEFAULT_CLIENT_FORM);
    setClientFormError("");
    setClientFormErrors({});
    setShowClientModal(true);
  };

  const handleClientClick = (client) => {
    setClientFilter(client.id);
    selectAdminTab("orders");
  };

  const handleEditClient = (client) => {
    setEditingClient(client);
    setClientForm({
      name: client.name || "",
      phone: client.phone || "",
      email: client.email || "",
      address: client.address || "",
      notes: client.notes || "",
    });
    setClientFormError("");
    setClientFormErrors({});
    setShowClientModal(true);
  };

  const handleSaveClient = async () => {
    const { payload, errors } = validateClientForm(clientForm);

    const nextErrors = errors;

    if (!payload.name) {
      nextErrors.name = "Escribe el nombre del cliente.";
    } else if (payload.name.length < 2) {
      nextErrors.name = "El nombre debe tener al menos 2 caracteres.";
    }

    if (!payload.phone) {
      nextErrors.phone = "Escribe el número de teléfono del cliente.";
    } else if (payload.phone.length < 3) {
      nextErrors.phone = "El teléfono debe tener al menos 3 caracteres.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setClientFormErrors(nextErrors);
      setClientFormError("Completa los campos obligatorios para guardar el cliente.");
      return;
    }

    setClientFormErrors({});
    setClientFormError("");
    setSaving(true);

    try {
      const isEditingClient = Boolean(editingClient);
      let savedClientId = editingClient?.id || null;
      const phoneDigits = normalizeClientPhone(payload.phone);
      if (phoneDigits.length >= 3) {
        const existingClients = await searchClients(supabase, payload.phone, 10);
        const duplicateClient = existingClients.find((client) => (
          normalizeClientPhone(client.phone) === phoneDigits
          && client.id !== editingClient?.id
        ));

        if (duplicateClient) {
          setClientFormErrors({ phone: "Ya existe un cliente registrado con este telefono." });
          setClientFormError(`El telefono pertenece a "${duplicateClient.name}". Usa ese cliente o registra otro numero.`);
          return;
        }
      }

      if (isEditingClient) {
        const { data, error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", editingClient.id)
          .select("id")
          .single();
        if (error) throw error;
        savedClientId = data?.id || savedClientId;
      } else {
        const { data, error } = await supabase
          .from("clients")
          .insert({ ...payload, created_by: user?.id || null })
          .select("id")
          .single();
        if (error) throw error;
        savedClientId = data?.id || null;
      }

      setShowClientModal(false);
      setEditingClient(null);
      setClientForm(DEFAULT_CLIENT_FORM);
      setClientFormErrors({});
      await Promise.all([fetchClients(), fetchAccountsReceivable(), loadOrders(true)]);
      notif.showActionNotification({
        type: "info",
        title: isEditingClient ? "Cliente actualizado" : "Cliente registrado",
        message: `Cliente "${clientForm.name.trim()}" ${isEditingClient ? "actualizado" : "creado"} correctamente.`,
        metadata: {
          variant: "success",
          event_kind: isEditingClient ? "admin_client_updated" : "admin_client_created",
          client_id: savedClientId,
        },
      });
    } catch (err) {
      setClientFormError(err.message || "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  const _handleDeleteClient = async (id) => {
    const target = clients.find((client) => client.id === id);
    if (target) setClientToDelete(target);
    return false;
  };

  const openTerminationModal = (termination = null) => {
    setEditingTermination(termination);
    setTerminationFormName(termination?.name || "");
    setTerminationFormAreaCode(termination?.production_area_code || "");
    setTerminationFormError("");
    setShowTerminationModal(true);
  };

  const handleSaveTermination = async () => {
    const name = terminationFormName.trim();
    if (name.length < 2 || !terminationFormAreaCode) {
      setTerminationFormError("Indica un nombre y un área de producción.");
      return;
    }
    try {
      const payload = { name, production_area_code: terminationFormAreaCode, updated_at: new Date().toISOString() };
      const query = editingTermination
        ? supabase.from("production_terminations").update(payload).eq("id", editingTermination.id)
        : supabase.from("production_terminations").insert(payload);
      const { error } = await query;
      if (error) throw error;
      setShowTerminationModal(false);
      fetchMaterials();
    } catch (err) {
      setTerminationFormError(err.code === "23505" ? "Ya existe esta terminación en el área." : (err.message || "No se pudo guardar la terminación."));
    }
  };

  const handleDeleteTermination = async (termination) => {
    if (!window.confirm(`¿Eliminar la terminación "${termination.name}"?`)) return;
    const { error } = await supabase.from("production_terminations").delete().eq("id", termination.id);
    if (error) {
      showFeedback("error", "No se pudo eliminar la terminación.");
      return;
    }
    fetchMaterials();
  };

  const handleConfirmDeleteClient = async () => {
    if (!clientToDelete) return;
    setClientDeleteLoading(true);
    try {
      const deletedClient = clientToDelete;
      const { response, result } = await adminApiFetch("/api/admin", { action: "retire-client", clientId: deletedClient.id });
      if (!response.ok) throw new Error(result?.error || "No se pudo dar de baja al cliente.");
      setClientToDelete(null);
      await fetchClients();
      await loadOrders();
      notif.showActionNotification({
        type: "info",
        title: "Cliente dado de baja",
        message: `El cliente ${deletedClient.name} fue eliminado correctamente.`,
        metadata: {
          variant: "success",
          event_kind: "admin_client_retired",
          client_id: deletedClient.id,
        },
      });
    } catch (err) {
      showFeedback("error", err?.message || "No se pudo dar de baja al cliente.");
    } finally {
      setClientDeleteLoading(false);
    }
  };

  const handleRestoreClient = async (client) => {
    if (!client?.id) return;
    try {
      const { response, result } = await adminApiFetch("/api/admin", { action: "restore-client", clientId: client.id });
      if (!response.ok) throw new Error(result?.error || "No se pudo restaurar al cliente.");
      await Promise.all([fetchClients(), loadOrders(true)]);
      showFeedback("success", result?.message || "Cliente restaurado correctamente.");
    } catch (err) {
      showFeedback("error", err?.message || "No se pudo restaurar al cliente.");
    }
  };

  const handleManageClientCredit = (clientId) => {
    selectAdminTab("credits");
    setCreditStatusFilter("all");
    setCreditDetailClientId(clientId);
    setCreditView("detail");
  };

  const handleOpenCreditNotification = useCallback((notification) => {
    const clientId = notification?.metadata?.client_id || null;
    selectAdminTab("credits");
    setCreditStatusFilter("open");
    setCreditDetailClientId(clientId);
    setCreditView(clientId ? "detail" : "list");
  }, [selectAdminTab]);

  const handleConfirmCreditSettleAll = async () => {
    const target = creditSettleAllTarget;
    if (!target) return;
    await handleSettleCreditOrders({
      orderIds: target.orderIds,
      notes: creditSettleAllNotes,
      setLoadingState: setCreditSettleAllLoading,
      onSuccess: () => {
        setCreditSettleAllTarget(null);
        setCreditSettleAllNotes("");
        if (target.client?.id) {
          setSelectedCreditOrderIds((prev) => ({ ...prev, [target.client.id]: [] }));
        }
      },
    });
  };

  const openCreditSettlementModal = ({ client, orderIds, invoices, mode }) => {
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];
    if (uniqueOrderIds.length === 0) {
      showFeedback("error", "No hay pendientes para cerrar.");
      return;
    }

    setCreditSettlementTarget({
      client,
      orderIds: uniqueOrderIds,
      invoices: [...new Set((invoices || []).filter(Boolean))],
      mode,
    });
    setCreditSettlementNotes("");
  };

  const handleSettleCreditOrders = async ({ orderIds, notes, onSuccess, setLoadingState }) => {
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];
    if (uniqueOrderIds.length === 0) {
      showFeedback("error", "No hay pendientes para cerrar.");
      return false;
    }

    setLoadingState(true);
    const { error } = await supabase.rpc("settle_credit_orders", {
      p_order_ids: uniqueOrderIds,
      p_receipt_url: null,
      p_notes: notes || null,
    });
    setLoadingState(false);

    if (error) {
      showFeedback("error", error.message || "No se pudo registrar el cierre del seguimiento.");
      return false;
    }

    await Promise.all([loadOrders(true), fetchAccountsReceivable()]);
    if (onSuccess) onSuccess();
    showFeedback("success", uniqueOrderIds.length === 1 ? "Factura marcada como saldada correctamente." : "Pendientes cerrados correctamente.");
    return true;
  };

  const handleRecordClientPayment = async () => {
    if (!recordPaymentClient?.id) return;
    const orderIds = receivablesByClient[recordPaymentClient.id]?.orderIds || [];
    if (orderIds.length === 0) {
      showFeedback("error", "El cliente no tiene pendientes para cerrar.");
      return;
    }

    await handleSettleCreditOrders({
      orderIds,
      notes: recordPaymentForm.notes,
      setLoadingState: setRecordPaymentLoading,
      onSuccess: () => {
        setRecordPaymentClient(null);
        setRecordPaymentForm({ amount: "", payment_method: "", notes: "" });
      },
    });
  };

  const handleConfirmCreditSettlement = async () => {
    const target = creditSettlementTarget;
    if (!target) return;

    await handleSettleCreditOrders({
      orderIds: target.orderIds,
      notes: creditSettlementNotes,
      setLoadingState: setCreditSettlementLoading,
      onSuccess: () => {
        if (target.client?.id) {
          setSelectedCreditOrderIds(prev => ({ ...prev, [target.client.id]: [] }));
        }
        setCreditSettlementTarget(null);
        setCreditSettlementNotes("");
      },
    });
  };

  const openCreditReminderModal = (client, invoices = []) => {
    if (!client?.id) {
      showFeedback("error", "Selecciona un cliente valido para crear el recordatorio.");
      return;
    }

    const openInvoices = invoices.filter(item => isOpenCreditReceivable(item) && item.order_id);
    const serverNow = getCreditReminderServerNow(creditReminderServerClockRef.current) ?? creditReminderNow;
    setCreditReminderTarget({ client, invoices: openInvoices });
    setCreditReminderForm({
      remind_at: getDefaultCreditReminderAt(serverNow),
      note: "",
      orderIds: [...new Set(openInvoices.map(item => item.order_id).filter(Boolean))],
      visibilityScope: CREDIT_REMINDER_VISIBILITY.CREATOR,
    });
  };

  const closeCreditReminderModal = () => {
    setCreditReminderTarget(null);
    setCreditReminderForm({
      remind_at: "",
      note: "",
      orderIds: [],
      visibilityScope: CREDIT_REMINDER_VISIBILITY.CREATOR,
    });
  };

  const toggleCreditReminderOrder = (orderId) => {
    if (!orderId) return;
    setCreditReminderForm(prev => {
      const current = new Set(prev.orderIds || []);
      if (current.has(orderId)) current.delete(orderId);
      else current.add(orderId);
      return { ...prev, orderIds: [...current] };
    });
  };

  const handleSaveCreditReminder = async () => {
    if (!user?.id) {
      showFeedback("error", "No se pudo identificar el usuario actual.");
      return;
    }
    if (!creditReminderTarget?.client?.id) {
      showFeedback("error", "Selecciona un cliente para el recordatorio.");
      return;
    }

    const validSelectedOrderIds = [...new Set(creditReminderForm.orderIds || [])].filter((orderId) => {
      const invoice = (creditReminderTarget.invoices || []).find(item => item.order_id === orderId);
      return invoice?.order_id && isOpenCreditReceivable(invoice);
    });
    if (validSelectedOrderIds.length === 0) {
      showFeedback("error", "Los recordatorios personalizados solo pueden crearse para ordenes a credito.");
      return;
    }

    const visibilityScope = CREDIT_REMINDER_VISIBILITY_VALUES.has(creditReminderForm.visibilityScope)
      ? creditReminderForm.visibilityScope
      : CREDIT_REMINDER_VISIBILITY.CREATOR;
    if (creditReminderVisibilityIncludesQuote(visibilityScope)) {
      const selectedQuoteIds = validSelectedOrderIds
        .map((orderId) => {
          const invoice = (creditReminderTarget.invoices || []).find(item => item.order_id === orderId);
          return resolveQuoteAssignmentId(invoice?.order);
        })
        .filter(Boolean);

      if (new Set(selectedQuoteIds).size === 0) {
        showFeedback("error", "Selecciona al menos una orden asignada a Caja para compartir el recordatorio.");
        return;
      }
    }

    const reminderNote = (creditReminderForm.note || "").trim();
    if (!reminderNote) {
      showFeedback("error", "Describe la razon del recordatorio antes de continuar.");
      return;
    }

    const reminderAtValue = (creditReminderForm.remind_at || "").trim();
    if (!reminderAtValue) {
      showFeedback("error", "Selecciona una fecha antes de continuar.");
      return;
    }

    const remindAtMs = zonedDatetimeLocalToUtcMs(reminderAtValue, CREDIT_REMINDER_TIME_ZONE);
    if (!Number.isFinite(remindAtMs)) {
      showFeedback("error", "La fecha del recordatorio no es valida.");
      return;
    }

    const serverClock = await syncCreditReminderServerTime();
    if (!serverClock) {
      showFeedback("error", "No se pudo validar la hora del servidor. Intenta nuevamente.");
      return;
    }

    const serverNowMs = getCreditReminderServerNow(serverClock);
    if (serverNowMs !== null && remindAtMs <= serverNowMs) {
      showFeedback("error", "Selecciona una fecha y hora futura para el recordatorio.");
      return;
    }

    setCreditReminderSaving(true);
    try {
      const { error } = await supabase.rpc("create_credit_custom_reminder", {
        p_client_id: creditReminderTarget.client.id,
        p_remind_at: new Date(remindAtMs).toISOString(),
        p_note: reminderNote,
        p_order_ids: validSelectedOrderIds,
        p_visibility_scope: visibilityScope,
      });

      if (error) throw error;

      closeCreditReminderModal();
      await syncCreditReminderServerTime();
      await fetchCreditCustomReminders();
      showFeedback("success", "Recordatorio registrado correctamente.");
    } catch (error) {
      console.error("Error creating credit reminder:", error);
      showFeedback("error", error?.message || "No se pudo crear el recordatorio.");
    } finally {
      setCreditReminderSaving(false);
    }
  };

  const dismissDueCreditReminders = async (reminders = dueCreditCustomReminders) => {
    const ids = reminders.map(item => item.id).filter(Boolean);
    if (ids.length === 0) return;

    setCreditReminderDismissedIds(prev => [...new Set([...prev, ...ids])]);
    await supabase.rpc("touch_credit_custom_reminders", { p_reminder_ids: ids });
  };

  const handleAcknowledgeCreditReminder = async (reminderId) => {
    if (!reminderId) return;
    setCreditReminderCompletingId(reminderId);
    try {
      const { error } = await supabase.rpc("acknowledge_credit_custom_reminder", {
        p_reminder_id: reminderId,
      });

      if (error) throw error;
      setCreditReminderDismissedIds(prev => [...new Set([...prev, reminderId])]);
      await fetchCreditCustomReminders();
      showCreditFeedback("success", "Recordatorio atendido", "Recordatorio marcado como atendido.");
    } catch (error) {
      showFeedback("error", error?.message || "No se pudo marcar el recordatorio.");
    } finally {
      setCreditReminderCompletingId(null);
    }
  };

  const handleReviewCreditReminder = async (reminder) => {
    if (!reminder) return;
    await dismissDueCreditReminders([reminder]);
    selectAdminTab("credits");
    setCreditStatusFilter("open");
    if (reminder.client_id) {
      setCreditDetailClientId(reminder.client_id);
      setCreditView("detail");
    } else {
      setCreditView("list");
    }
  };

  // Filters and ordering execute in the protected endpoint, before paging.
  const filteredOrders = orders;
  const totalPages = Math.ceil(ordersTotal / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders;

  const receivablesByClient = (() => {
    return getOpenCreditReceivables(accountsReceivable).reduce((acc, item) => {
      const current = acc[item.client_id] || { count: 0, orderIds: [], invoices: [], oldestIssuedAt: null };
      const issuedAt = item.issued_at || item.created_at || null;
      acc[item.client_id] = {
        count: current.count + 1,
        orderIds: [...current.orderIds, item.order_id].filter(Boolean),
        invoices: [...current.invoices, item.invoice_number].filter(Boolean),
        oldestIssuedAt: !current.oldestIssuedAt || (issuedAt && issuedAt < current.oldestIssuedAt) ? issuedAt : current.oldestIssuedAt,
      };
      return acc;
    }, {});
  })();

  const ordersById = useMemo(() => Object.fromEntries(orders.map(order => [order.id, order])), [orders]);
  const clientsById = useMemo(() => Object.fromEntries(clients.map(client => [client.id, client])), [clients]);
  const accountsReceivableById = useMemo(() => Object.fromEntries(accountsReceivable.map(item => [item.id, item])), [accountsReceivable]);
  const accountsReceivableByOrderId = useMemo(() => Object.fromEntries(accountsReceivable.filter(item => item.order_id).map(item => [item.order_id, item])), [accountsReceivable]);

  const creditRows = useMemo(() => {
    return accountsReceivable
      .filter(item => item?.client_id)
      .map(item => {
        const order = ordersById[item.order_id] || null;
        const client = item.client || clientsById[item.client_id] || null;
        return {
          ...item,
          order,
          client,
          clientName: client?.name || order?.client_name || "Cliente sin nombre",
          clientPhone: client?.phone || order?.client_contact || "---",
          invoiceNumber: item.invoice_number || order?.invoice_number || "---",
          creditIssuedAt: getCreditIssuedAt({ ...item, order }),
        };
      });
  }, [accountsReceivable, clientsById, ordersById]);

  const buildCreditClientGroups = useCallback((rows) => {
    const grouped = rows.reduce((acc, item) => {
      const clientKey = item.client_id;
      const current = acc[clientKey] || {
        client: item.client || { id: item.client_id, name: item.clientName, phone: item.clientPhone },
        invoices: [],
        pendingCount: 0,
        oldestIssuedAt: null,
        newestIssuedAt: null,
      };
      const issuedAt = item.creditIssuedAt || null;
      const issuedTime = issuedAt ? new Date(issuedAt).getTime() : null;
      const oldestTime = current.oldestIssuedAt ? new Date(current.oldestIssuedAt).getTime() : null;
      const newestTime = current.newestIssuedAt ? new Date(current.newestIssuedAt).getTime() : null;

      acc[clientKey] = {
        ...current,
        invoices: [...current.invoices, item],
        pendingCount: current.pendingCount + (isOpenCreditReceivable(item) ? 1 : 0),
        oldestIssuedAt: issuedTime && (!oldestTime || issuedTime < oldestTime) ? issuedAt : current.oldestIssuedAt,
        newestIssuedAt: issuedTime && (!newestTime || issuedTime > newestTime) ? issuedAt : current.newestIssuedAt,
      };
      return acc;
    }, {});

    return Object.values(grouped)
      .map(group => ({
        ...group,
        invoices: [...group.invoices].sort((a, b) => new Date(b.issued_at || b.created_at || 0) - new Date(a.issued_at || a.created_at || 0)),
      }))
      .sort((a, b) => String(a.client?.name || "").localeCompare(String(b.client?.name || "")));
  }, []);

  const allCreditClientGroups = useMemo(() => (
    buildCreditClientGroups(creditRows)
  ), [buildCreditClientGroups, creditRows]);

  const creditClientGroups = useMemo(() => {
    const q = normalizeText(creditSearch);
    const filtered = creditRows.filter(item => {
      const matchesStatus = creditStatusFilter === "all"
        || (creditStatusFilter === "open" && isOpenCreditReceivable(item))
        || item.status === creditStatusFilter;
      const matchesSearch = !q || [
        item.clientName,
        item.clientPhone,
        item.invoiceNumber,
        item.order_id,
        item.order?.id,
      ].some(value => normalizeText(value).includes(q));
      return matchesStatus && matchesSearch;
    });

    return buildCreditClientGroups(filtered);
  }, [buildCreditClientGroups, creditRows, creditSearch, creditStatusFilter]);

  const CREDIT_PAGE_SIZE = 7;
  const creditTotalPages = Math.max(1, Math.ceil(creditClientGroups.length / CREDIT_PAGE_SIZE));
  const safeCreditPage = Math.min(creditPage, creditTotalPages);
  const paginatedCreditClientGroups = creditClientGroups.slice((safeCreditPage - 1) * CREDIT_PAGE_SIZE, safeCreditPage * CREDIT_PAGE_SIZE);
  const hasCreditFilters = Boolean(creditSearch) || creditStatusFilter !== "all";

  useEffect(() => { setCreditPage(1); }, [creditSearch, creditStatusFilter]);

  const creditDetailClient = useMemo(() => (
    allCreditClientGroups.find(group => group.client?.id === creditDetailClientId) || null
  ), [allCreditClientGroups, creditDetailClientId]);

  const creditPendingInvoicesCount = useMemo(() => (
    creditRows.filter(item => isOpenCreditReceivable(item)).length
  ), [creditRows]);

  const creditPendingClientCount = useMemo(() => (
    new Set(creditRows.filter(item => isOpenCreditReceivable(item)).map(item => item.client_id)).size
  ), [creditRows]);

  const creditPendingClientPreview = useMemo(() => (
    allCreditClientGroups
      .filter(group => group.pendingCount > 0)
      .sort((a, b) => b.pendingCount - a.pendingCount || String(a.client?.name || "").localeCompare(String(b.client?.name || "")))
      .slice(0, 4)
  ), [allCreditClientGroups]);

  const shouldShowCreditPendingAlert = creditPendingInvoicesCount > 0 && !creditAlertAcknowledged && !creditAlertLoading;

  const creditCustomReminderRows = useMemo(() => (
    creditCustomReminders.map((reminder) => {
      const links = creditCustomReminderLinks.filter((link) => link.reminder_id === reminder.id);
      const client = clientsById[reminder.client_id] || { id: reminder.client_id, name: "Cliente sin nombre", phone: "" };
      const invoices = links.map((link) => {
        const receivable = accountsReceivableById[link.accounts_receivable_id] || accountsReceivableByOrderId[link.order_id] || null;
        const order = ordersById[link.order_id] || (receivable?.order_id ? ordersById[receivable.order_id] : null);
        return {
          ...link,
          receivable,
          order,
          invoiceNumber: receivable?.invoice_number || order?.invoice_number || "---",
        };
      });

      return {
        ...reminder,
        client,
        invoices,
      };
    })
  ), [accountsReceivableById, accountsReceivableByOrderId, clientsById, creditCustomReminderLinks, creditCustomReminders, ordersById]);

  const dueCreditCustomReminders = (() => {
    const dismissed = new Set(creditReminderDismissedIds);
    return creditCustomReminderRows
      .filter((reminder) => (
        ["scheduled", "due"].includes(reminder.status)
        && reminder.remind_at
        && creditReminderNow !== null
        && new Date(reminder.remind_at).getTime() <= creditReminderNow
        && !dismissed.has(reminder.id)
      ))
      .sort((a, b) => new Date(a.remind_at || 0) - new Date(b.remind_at || 0));
  })();

  useEffect(() => {
    if (creditReminderNow === null) return undefined;

    const dismissed = new Set(creditReminderDismissedIds);
    const serverNow = getCreditReminderServerNow(creditReminderServerClockRef.current) ?? creditReminderNow;
    const nextReminderTime = creditCustomReminderRows
      .filter((reminder) => (
        ["scheduled", "due"].includes(reminder.status)
        && reminder.remind_at
        && !dismissed.has(reminder.id)
      ))
      .map((reminder) => new Date(reminder.remind_at).getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b)
      .find((time) => time > serverNow);

    if (!nextReminderTime) return undefined;

    const delay = Math.min(
      Math.max(nextReminderTime - serverNow + 250, 0),
      CREDIT_REMINDER_MAX_TIMEOUT_MS
    );

    const timeout = setTimeout(async () => {
      await syncCreditReminderServerTime();
      await dispatchDueCreditReminderNotifications();
      fetchCreditCustomReminders();
    }, delay);

    return () => clearTimeout(timeout);
  }, [creditCustomReminderRows, creditReminderDismissedIds, creditReminderNow, dispatchDueCreditReminderNotifications, fetchCreditCustomReminders, syncCreditReminderServerTime]);

  const openCreditOrderIds = useMemo(() => new Set(
    creditRows
      .filter(item => isOpenCreditReceivable(item) && item.order_id)
      .map(item => item.order_id)
  ), [creditRows]);

  useEffect(() => {
    setSelectedCreditOrderIds(prev => {
      let changed = false;
      const next = {};

      Object.entries(prev).forEach(([clientId, orderIds]) => {
        const keptOrderIds = orderIds.filter(orderId => openCreditOrderIds.has(orderId));
        if (keptOrderIds.length !== orderIds.length) changed = true;
        if (keptOrderIds.length > 0) next[clientId] = keptOrderIds;
      });

      return changed ? next : prev;
    });
  }, [openCreditOrderIds]);

  useEffect(() => {
    if (creditView !== "detail" || !creditDetailClientId) return;
    if (creditDetailClient) return;

    setCreditView("list");
    setCreditDetailClientId(null);
  }, [creditDetailClient, creditDetailClientId, creditView]);

  const toggleAdminSidebar = useCallback(() => {
    setSidebarOpen(previous => !previous);
  }, []);

  const handleOrderRowClick = useCallback((event, order) => {
    if (isInteractiveOrderRowTarget(event.target)) return;
    setSelectedOrder(order);
  }, []);

  const handleOrderRowKeyDown = useCallback((event, order) => {
    if (!["Enter", " "].includes(event.key)) return;
    if (isInteractiveOrderRowTarget(event.target)) return;
    event.preventDefault();
    setSelectedOrder(order);
  }, []);

  const toggleCreditOrderSelection = (clientId, orderId) => {
    if (!clientId || !orderId) return;
    setSelectedCreditOrderIds(prev => {
      const current = new Set(prev[clientId] || []);
      if (current.has(orderId)) current.delete(orderId);
      else current.add(orderId);
      return { ...prev, [clientId]: [...current] };
    });
  };

  const toggleAllCreditOrdersForClient = (clientId, invoices) => {
    if (!clientId) return;
    const openOrderIds = invoices.filter(item => isOpenCreditReceivable(item) && item.order_id).map(item => item.order_id);
    setSelectedCreditOrderIds(prev => {
      const selected = prev[clientId] || [];
      const allSelected = openOrderIds.length > 0 && openOrderIds.every(orderId => selected.includes(orderId));
      return { ...prev, [clientId]: allSelected ? [] : openOrderIds };
    });
  };

  const filteredProfiles = useMemo(() => {
    const q = normalizeText(userSearch);
    return profiles.filter(item => {
      const matchesSearch = !q || [getUserDisplayName(item), item.email, item.role, getEmploymentStatus(item)].some(value => normalizeText(value).includes(q));
      const matchesRole = roleFilter === "all" || item.role === roleFilter;
      const matchesEmployment = employmentFilter === "all"
        || (employmentFilter === "active" && isEmploymentActive(item))
        || (employmentFilter === "inactive" && !isEmploymentActive(item));
      return matchesSearch && matchesRole && matchesEmployment;
    });
  }, [profiles, userSearch, roleFilter, employmentFilter]);

  const userTotalPages = Math.max(1, Math.ceil(filteredProfiles.length / USERS_PER_PAGE));
  const safeUserPage = Math.min(userPage, userTotalPages);
  const paginatedUsers = filteredProfiles.slice((safeUserPage - 1) * USERS_PER_PAGE, safeUserPage * USERS_PER_PAGE);
  const hasUserFilters = Boolean(userSearch) || roleFilter !== "all" || employmentFilter !== "all";

  useEffect(() => { setUserPage(1); }, [userSearch, roleFilter, employmentFilter]);

  const clientDirectoryRefreshKey = useMemo(() => [
    clients.length,
    getLatestCollectionTimestamp(clients),
    orders.length,
    getLatestCollectionTimestamp(orders),
    accountsReceivable.length,
    getLatestCollectionTimestamp(accountsReceivable),
  ].join(":"), [accountsReceivable, clients, orders]);

const filteredMaterials = useMemo(() => {
  const q = normalizeText(materialSearch);
  let result = q ? materials.filter(mat => normalizeText(mat.name).includes(q)) : materials;
  if (materialAreaFilter !== "all") {
    result = result.filter(mat => mat.production_area_code === materialAreaFilter);
  }
  return result;
}, [materials, materialSearch, materialAreaFilter]);

  const productionCatalog = useMemo(
    () => buildProductionCatalogs(materials, productionTerminations),
    [materials, productionTerminations],
  );

  const MATERIALS_PER_PAGE = 7;
  const totalMaterialPages = Math.ceil(filteredMaterials.length / MATERIALS_PER_PAGE) || 1;
  const safeMaterialPage = Math.min(materialsPage, totalMaterialPages);
  const paginatedMaterials = filteredMaterials.slice((safeMaterialPage - 1) * MATERIALS_PER_PAGE, safeMaterialPage * MATERIALS_PER_PAGE);

  useEffect(() => { setMaterialsPage(1); }, [filteredMaterials.length]);

  const TERMINATIONS_PER_PAGE = 7;
  const totalTerminationPages = Math.ceil(productionTerminations.length / TERMINATIONS_PER_PAGE) || 1;
  const safeTerminationPage = Math.min(terminationsPage, totalTerminationPages);
  const paginatedTerminations = productionTerminations.slice((safeTerminationPage - 1) * TERMINATIONS_PER_PAGE, safeTerminationPage * TERMINATIONS_PER_PAGE);

  useEffect(() => { setTerminationsPage(1); }, [productionTerminations.length]);

  const getOverviewCount = (key) => {
    const value = Number(orderOverview?.[key]);
    return Number.isFinite(value) ? value : null;
  };
  const formatOverviewCount = (value) => value === null ? "—" : value.toLocaleString("es-PE");
  const overviewFlowMetrics = [
    { label: "Pendientes", detail: "Órdenes por iniciar", value: getOverviewCount("pending"), icon: <Icons.Clock />, color: "#F59E0B" },
    { label: "Caja", detail: "Órdenes en cotización", value: getOverviewCount("quote"), icon: <Icons.Package />, color: "#1E40AF" },
    { label: "Diseño", detail: "Órdenes en diseño", value: getOverviewCount("design"), icon: <Icons.File />, color: "#8B5CF6" },
    { label: "Producción", detail: "Órdenes en producción", value: getOverviewCount("production"), icon: <Icons.Package />, color: "#F97316" },
    { label: "Entrega", detail: "Órdenes en entrega", value: getOverviewCount("delivered"), icon: <Icons.Truck />, color: "#10B981" },
  ];

  const overviewRecentOrders = orders.slice(0, 3);
  const overviewQuickActions = [
    { label: "Órdenes", tab: "orders", icon: <Icons.Orders /> },
    { label: "Seguimiento", tab: "credits", icon: <Icons.AlertCircle /> },
    { label: "Clientes", tab: "clients", icon: <Icons.User /> },
    { label: "Materiales", tab: "materials", icon: <Icons.Package /> },
    { label: "Empleados", tab: "users", icon: <Icons.Users /> },
  ];
  const getSidebarBadge = (loading, value) => (loading ? "..." : value);

  const menuItems = [
    { id: "overview", label: "Resumen", icon: <Icons.Dashboard /> },
    { id: "kpi", label: "KPI", icon: <Icons.BarChart /> },
    { id: "orders", label: "Órdenes", icon: <Icons.Orders />, badge: getSidebarBadge(loadingOrders, getOverviewCount("total") ?? ordersTotal) },
    { id: "credits", label: "Seguimiento", icon: <Icons.AlertCircle />, badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount) },
    { id: "clients", label: "Clientes", icon: <Icons.User />, badge: getSidebarBadge(clientsLoading, clientsTotal) },
    { id: "materials", label: "Materiales", icon: <Icons.Package /> },
    { id: "users", label: "Empleados", icon: <Icons.Users />, badge: getSidebarBadge(loadingUsers, profiles.length) },
    { id: "notifications", label: "Notificaciones", icon: <Icons.Bell />, badge: getSidebarBadge(notif.loading, adminUnreadCount) },
  ];

  const handleAdminTabChange = (nextTab) => {
    selectAdminTab(nextTab);
    setSettingsOrder(null);
    setSettingsView("list");
    if (window.matchMedia("(max-width: 768px)").matches) {
      setSidebarOpen(false);
    }
  };

  const advancedSettingsOpen = settingsView === "detail" && Boolean(settingsOrder);

  // payment label is handled inside PaymentFormModal component

  return (
    // Apartado principal totalmente flexible
    <div className="pa-root">
      <Sidebar isOpen={sidebarOpen} activeTab={activeTab} onTabChange={handleAdminTabChange} role="Admin" userName={getUserDisplayName(profile)} menuItems={menuItems} onLogout={handleLogout} scrollNavigation />
      <div className="pa-main-wrap">
<header className="pa-header">
          <div className="pa-header-left">
            <button
              className="pa-icon-btn pa-sidebar-toggle"
              onClick={toggleAdminSidebar}
              aria-label={sidebarOpen ? "Contraer menu lateral" : "Expandir menu lateral"}
              title={sidebarOpen ? "Contraer menu lateral" : "Expandir menu lateral"}
            >
              {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
            </button>
            <div>
              <h1>{getAdminTabTitle(activeTab)}</h1>
              <span className="pa-header-date">
                {new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </span>
            </div>
          </div>
          <div className="pa-header-right">
            {feedback && <div className={`pa-feedback ${feedback.type}`}>{feedback.message}</div>}
            <div className="pa-header-actions">
              <button className="pa-action-btn pa-action-btn-primary" onClick={() => selectAdminTab("orders")} title="Gestionar órdenes">
                <Icons.Orders /> <span>Gestionar órdenes</span>
              </button>
              <button className="pa-action-btn" onClick={() => selectAdminTab("credits")} title="Seguimiento">
                <Icons.AlertCircle /> <span>Seguimiento</span>
              </button>
              <button className="pa-refresh-btn" onClick={handleHeaderRefresh} title="Recargar" aria-label="Recargar datos">
                <Icons.Refresh />
              </button>
            </div>
            <NotificationCenter
              notifications={adminVisibleNotifications}
              unreadCount={adminUnreadCount}
              toasts={adminVisibleToasts}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDismissToast={notif.dismissToast}
            />
          </div>
        </header>
        <main className="pa-main">

        {activeTab === "kpi" && (
          <Suspense fallback={<div className="pa-feedback info">Cargando KPI...</div>}>
            <KPIModule userId={authUser?.id} />
          </Suspense>
        )}

        {activeTab === "notifications" && (
          <DesignerNotificationsModule
            notifications={adminVisibleNotifications}
            archivedNotifications={notif.archivedNotifications}
            unreadCount={adminUnreadCount}
            loading={notif.loading}
            archivedLoading={notif.archivedLoading}
            onMarkAsRead={notif.markAsRead}
            onMarkAllAsRead={notif.markAllAsRead}
            onArchive={notif.archive}
            onDelete={notif.deleteNotification}
            onDeleteAll={notif.deleteNotificationsByScope}
            notificationSoundEnabled={notif.notificationSoundEnabled}
            notificationSoundLoading={notif.notificationSoundLoading}
            onNotificationSoundChange={notif.setNotificationSoundEnabled}
            moduleLabel="Administración"
            moduleIcon={Icons.Bell}
            moduleTone="admin"
            onOpenCreditTracking={handleOpenCreditNotification}
          />
        )}

        {activeTab === "overview" &&
          <section className="pa-section pa-overview-section">
            <div className="pa-section-heading acm-heading">
              <div>
                <h2>Panel General</h2>
                <p>Resumen del estado actual de tu negocio.</p>
                <div className="pa-overview-banner-badges">
                  <div className="acm-total-badge pa-overview-banner-badge" data-tone="orders">
                    <Icons.Orders />
                    <strong>{loadingOrders ? "..." : formatOverviewCount(getOverviewCount("total"))}</strong> órdenes
                  </div>
                  <div className="acm-total-badge pa-overview-banner-badge" data-tone="completed">
                    <Icons.Check />
                    <strong>{loadingOrders ? "..." : formatOverviewCount(getOverviewCount("completed"))}</strong> completadas
                  </div>
                  <div className="acm-total-badge pa-overview-banner-badge" data-tone="clients">
                    <Icons.User />
                    <strong>{clientsLoading ? "..." : clients.length.toLocaleString("es-PE")}</strong> clientes
                  </div>
                  <div className="acm-total-badge pa-overview-banner-badge" data-tone="employees">
                    <Icons.Users />
                    <strong>{loadingUsers ? "..." : profiles.length}</strong> empleados
                  </div>
                </div>
              </div>
            </div>

            <nav className="pa-overview-quick-actions" aria-label="Accesos rápidos">
              {overviewQuickActions.map(action => (
                <button key={action.tab} type="button" onClick={() => handleAdminTabChange(action.tab)}>
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </nav>

            <div className="pa-overview-executive-grid">
              <div className="pa-overview-metrics-grid">
                {overviewFlowMetrics.map(item => (
                  <article key={item.label} className="pa-overview-flow-step" style={{ "--flow-color": item.color }}>
                    <span className="pa-overview-flow-step-icon">{item.icon}</span>
                    <strong className="pa-overview-flow-step-value">{loadingOrders ? "..." : formatOverviewCount(item.value)}</strong>
                    <span className="pa-overview-flow-step-label">{item.label}</span>
                    <span className="pa-overview-flow-step-sub">{item.detail}</span>
                  </article>
                ))}
                <button type="button" className="pa-overview-flow-step pa-overview-flow-step--interactive" style={{ "--flow-color": "#F97316" }} onClick={() => selectAdminTab("credits")}>
                  <span className="pa-overview-flow-step-icon"><Icons.AlertCircle /></span>
                  <strong className="pa-overview-flow-step-value">{creditPendingClientCount}</strong>
                  <span className="pa-overview-flow-step-label">Seguimiento de crédito</span>
                  <span className="pa-overview-flow-step-sub">Clientes con saldo por revisar</span>
                </button>
              </div>

              <section className="pa-panel pa-overview-activity-panel">
                <div className="ps-panel-stripe" />
                <div className="pa-overview-card-head pa-overview-card-head-row">
                  <div>
                    <h2>Actividad reciente</h2>
                    <p>Últimas órdenes registradas en el sistema.</p>
                  </div>
                  <button className="ps-link-btn" onClick={() => handleAdminTabChange("orders")}>
                    Ver todas <Icons.ArrowRight />
                  </button>
                </div>
                <div className="ps-table-wrap">
                  <table className="ps-table">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Estado</th>
                        <th>Vendedor</th>
                        <th>Fecha de entrega</th>
                        <th>Estado de pago</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewRecentOrders.length === 0 ? (
                        <tr><td colSpan={5} className="ps-table-empty">No hay órdenes recientes para mostrar.</td></tr>
                      ) : overviewRecentOrders.map(order => (
                        <tr key={order.id} className="row-hover" onClick={() => setSelectedOrder(order)}>
                          <td className="td-pad">
                            <div className="ps-client-cell">
                              <span className="acm-avatar acm-avatar-small">{String(order.client_name || "Cliente").trim().charAt(0).toUpperCase()}</span>
                              <span className="ps-client-cell-main">
                                <strong title={order.client_name || "Sin cliente"}>{order.client_name || "Cliente sin nombre"}</strong>
                              </span>
                            </div>
                          </td>
                          <td className="td-pad"><StatusBadge status={order.status} className="ps-badge" showDot bordered order={order} /></td>
                          <td className="td-pad td-name">{order.seller_id ? getUserDisplayName(usersById[order.seller_id]) : "Sin asignar — Administración"}</td>
                          <td className="td-pad">
                            <span className={`pa-overview-delivery-badge${formatOverviewDeliveryDate(order.delivery_date) ? "" : " is-indefinite"}`}>
                              {formatOverviewDeliveryDate(order.delivery_date) || "Indefinida"}
                            </span>
                          </td>
                          <td className="td-pad"><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pa-overview-activity-footer">
                  Mostrando {overviewRecentOrders.length} de {orders.length} órdenes
                </div>
              </section>
            </div>
          </section>
        }

        {activeTab === "orders" && !advancedSettingsOpen &&
          <section className="pa-section">
<div className="pa-section-heading acm-heading">
              <div>
                <h2>Gestión de Órdenes</h2>
                <p>Supervisa, filtra y administra las órdenes del sistema.</p>
                {ordersTotal > 0 && (
                  <div className="acm-total-badge">
                    <Icons.Orders />
                    <strong>{ordersTotal.toLocaleString("es-PE")}</strong> órdenes registradas
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button className="pa-btn primary" onClick={() => setShowOrderStatisticsModal(true)}>
                  <Icons.BarChart />
                  Estadísticas
                </button>
                <button className="pa-btn primary" onClick={openCreateOrder}>
                  <Icons.Plus />
                  Nueva orden
                </button>
              </div>
            </div>
            <SalesFilterToolbar
              ariaLabel="Filtros de órdenes"
              search={{
                label: "Buscar órdenes",
                value: search,
                onChange: (value) => { setSearch(value); setPage(1); },
                placeholder: "Buscar por cliente, facturación, descripción, material o usuario...",
              }}
              controls={[
                { id: "status", label: "Estado operativo", icon: <Icons.FileText />, value: statusFilter, onChange: (value) => { setStatusFilter(value); setPage(1); }, isActive: statusFilter !== "all", options: [{ value: "all", label: "Todos los estados" }, ...STATUS_OPTIONS.map((status) => ({ value: status, label: STATUS_LABELS[status] || status }))] },
                { id: "date", label: "Fecha", icon: <Icons.Calendar />, value: dateFilter, onChange: (value) => { setDateFilter(value); setPage(1); }, isActive: dateFilter !== "all", options: [{ value: "all", label: "Todas las fechas" }, { value: "today", label: "Hoy" }, { value: "week", label: "Últimos 7 días" }] },
                { id: "owner", label: "Empleado", icon: <Icons.Users />, allowMultiline: true, value: ownerFilter, onChange: (value) => { setOwnerFilter(value); setPage(1); }, isActive: ownerFilter !== "all", options: [{ value: "all", label: "Todos los empleados" }, ...profiles.map((item) => ({ value: item.id, label: getUserDisplayName(item) }))] },
                { id: "client", label: "Cliente", icon: <Icons.User />, allowMultiline: true, value: clientFilter, onChange: (value) => { setClientFilter(value); setPage(1); }, isActive: clientFilter !== "all", options: [{ value: "all", label: "Todos los clientes" }, { value: NO_CLIENT_FILTER_VALUE, label: "Sin cliente registrado" }, ...clients.map((client) => ({ value: client.id, label: getClientDisplayName(client) }))] },
                { id: "archive", label: "Archivo", icon: <Icons.Archive />, value: archiveFilter, onChange: (value) => { setArchiveFilter(value); setPage(1); }, isActive: archiveFilter !== "active", options: [{ value: "active", label: "Activas" }, { value: "all", label: "Todas" }, { value: "archived", label: "Archivadas" }] },
                { id: "intervention", label: "Intervención", icon: <Icons.AlertCircle />, className: "pp-filter-select-wrap--wide", value: interventionFilter, onChange: (value) => { setInterventionFilter(value); setPage(1); }, isActive: interventionFilter !== "all", options: [{ value: "all", label: "Todas las intervenciones" }, { value: "intervened", label: "Intervenidas por Admin" }, { value: "not_intervened", label: "Sin intervención avanzada" }] },
                { id: "operational", label: "Situación operativa", icon: <Icons.Orders />, className: "pp-filter-select-wrap--wide", value: operationalFilter, onChange: (value) => { setOperationalFilter(value); setPage(1); }, isActive: operationalFilter !== "all", options: [{ value: "all", label: "Toda la situación operativa" }, { value: "overdue", label: "Atrasadas" }, { value: "blocked", label: "Bloqueadas" }, { value: "priority", label: "Prioridad 911" }, { value: "commercial_review", label: "Revisión comercial pendiente" }] },
              ]}
              resultCount={ordersTotal}
              resultLabel={`resultado${ordersTotal === 1 ? "" : "s"}`}
              activeFilters={[search, statusFilter !== "all", dateFilter !== "all", ownerFilter !== "all", clientFilter !== "all", archiveFilter !== "active", interventionFilter !== "all", operationalFilter !== "all"].filter(Boolean).length}
              onReset={() => { setSearch(""); setStatusFilter("all"); setDateFilter("all"); setOwnerFilter("all"); setClientFilter("all"); setArchiveFilter("active"); setInterventionFilter("all"); setOperationalFilter("all"); setPage(1); }}
            />
            <div className="pa-panel acm-table-panel pa-orders-panel">
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <h2>Órdenes del sistema</h2>
                </div>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table acm-table pa-orders-table">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Facturación</th>
                      <th>Estado</th>
                      <th>Pago</th>
                      <th>Fecha</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {loadingOrders ? <tr><td colSpan={6} className="ps-table-empty">Cargando órdenes...</td></tr> : loadOrdersError ? <tr><td colSpan={6} className="ps-table-empty">{loadOrdersError}</td></tr> : filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="ps-table-empty">
                          <div className="acm-empty-state">
                            <Icons.Search />
                            <strong>No se encontraron órdenes</strong>
                            <span>{(search || statusFilter !== "all" || dateFilter !== "all" || ownerFilter !== "all" || clientFilter !== "all" || archiveFilter !== "active" || interventionFilter !== "all" || operationalFilter !== "all") ? "Intenta con otros filtros o limpia la búsqueda." : "Las órdenes del sistema aparecerán aquí."}</span>
                          </div>
                        </td>
                      </tr>
                    ) : paginatedOrders.map(order =>
                          <tr
                            key={order.id}
                            className="row-hover acm-client-row"
                            tabIndex={0}
                            onClick={(event) => handleOrderRowClick(event, order)}
                            onKeyDown={(event) => handleOrderRowKeyDown(event, order)}
                            aria-label={`Ver detalles de la orden ${order.id?.slice(0, 8) || ""} de ${order.client_name || "cliente sin nombre"}`}
                          >
                            <td className="td-pad">
                              <div className="acm-client-cell">
                                <span className="acm-avatar acm-avatar-small">{(order.client_name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("") || "?"}</span>
                                <span>
                                  <small>#{order.id?.slice(0, 8) || "---"}</small>
                                  <strong title={order.client_name || "Sin cliente"}>{order.client_name || "Sin cliente"}</strong>
                                </span>
                              </div>
                            </td>
                            <td className="td-pad td-desc" title={order.invoice_number || "---"}>
                              <span className="pa-order-cell-ellipsis">{order.invoice_number || "---"}</span>
                            </td>
                            <td className="td-pad">
                              <div className="acm-badge-stack">
                                <StatusBadge status={order.status} className="ps-badge" showDot bordered order={order} />
                                {order.operational_status === "blocked" && <span className="acm-badge danger">Bloqueada</span>}
                                {order.commercial_review_required && <span className="acm-badge warning">Revisión</span>}
                                {order.order_type === "orden 911" && <span className="acm-badge danger">911</span>}
                              </div>
                            </td>
                            <td className="td-pad">
                              <PaymentBadge status={order.payment_status} className="ps-badge" bordered />
                            </td>
                            <td className="td-pad td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="td-pad td-actions" onClick={(event) => event.stopPropagation()}>
                              <div className="table-actions acm-row-actions" data-row-action>
                                <button className="table-action-btn view" onClick={() => setSelectedOrder(order)} title="Ver detalles" aria-label="Ver detalles">
                                  <Icons.Eye />
                                </button>
                                <AdminOrderActions
                                  order={order}
                                  onEdit={openEditOrder}
                                  onAdvanced={openAdvancedSettings}
                                  onPayment={openPaymentModal}
                                  onCancel={openCancelModal}
                                />
                                {canArchiveOrder(order, ARCHIVE_MODULES.ADMIN, user?.id) ? (
                                  <button className="table-action-btn archive" onClick={() => openArchiveModal(order)} title="Archivar orden" aria-label="Archivar orden">
                                    <Icons.Archive />
                                  </button>
                                ) : order.is_archived_admin ? (
                                  <button className="table-action-btn archive" title="Orden archivada" aria-label="Orden archivada" disabled>
                                    <Icons.Archive />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>)}
                  </tbody>
                </table>
              </div>
              {!loadingOrders && !loadOrdersError && (
                <div className="acm-pagination-footer">
                  <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
                </div>
              )}
            </div>
          </section>
        }

        {activeTab === "orders" && advancedSettingsOpen && (
          <AdminAdvancedSettings
            order={settingsOrder}
            profiles={profiles}
            loading={advancedActionLoading}
            onClose={() => { setSettingsOrder(null); setSettingsView("list"); }}
            onRunAction={handleAdvancedAction}
            onRefreshOrder={loadOrders}
            currentUserId={authUser?.id}
          />
        )}

        {activeTab === "credits" && creditView === "list" && (
          <section className="pa-section">
            <div className="pa-section-heading acm-heading">
              <div>
                <h2>Gestión de seguimiento</h2>
                <p>Supervisa pendientes administrativos agrupados por cliente.</p>
                <div className="acm-total-badge">
                  <Icons.AlertCircle />
                  <strong>{creditPendingInvoicesCount.toLocaleString("es-PE")}</strong> seguimientos pendientes
                </div>
              </div>
            </div>
            <SalesFilterToolbar
              ariaLabel="Filtros de seguimiento"
              search={{
                label: "Buscar seguimientos",
                value: creditSearch,
                onChange: setCreditSearch,
                placeholder: "Buscar por cliente, teléfono, factura u orden...",
              }}
              controls={[{
                id: "credit-status",
                label: "Estado",
                icon: <Icons.AlertCircle />,
                value: creditStatusFilter,
                onChange: setCreditStatusFilter,
                isActive: creditStatusFilter !== "open",
                options: [
                  { value: "open", label: "Pendientes" },
                  { value: "all", label: "Todos" },
                  { value: "resolved", label: "Resueltas" },
                ],
              }]}
              resultCount={creditClientGroups.length}
              resultLabel={`cliente${creditClientGroups.length === 1 ? "" : "s"}`}
              activeFilters={[Boolean(creditSearch), creditStatusFilter !== "open"].filter(Boolean).length}
              onReset={() => { setCreditSearch(""); setCreditStatusFilter("open"); }}
            />

            <div className="pa-credit-metrics" aria-label="Resumen de seguimiento">
              <div className="pa-credit-summary-item">
                <span className="pa-credit-summary-icon client"><Icons.User /></span>
                <div><strong>{creditClientGroups.length}</strong><span>Clientes filtrados</span></div>
              </div>
              <div className="pa-credit-summary-item">
                <span className="pa-credit-summary-icon pending"><Icons.Receipt /></span>
                <div><strong>{creditPendingInvoicesCount}</strong><span>Pendientes</span></div>
              </div>
              <div className="pa-credit-summary-item">
                <span className="pa-credit-summary-icon followup"><Icons.AlertCircle /></span>
                <div><strong>{creditPendingClientCount}</strong><span>Clientes con pendientes</span></div>
              </div>
            </div>

            {creditPendingInvoicesCount > 0 && (
              <div className="pa-credit-pending-banner pa-credit-dashboard-alert" role="status">
                <span className="pa-credit-pending-banner-icon"><Icons.AlertCircle /></span>
                <div>
                  <strong>{creditPendingInvoicesCount} seguimiento{creditPendingInvoicesCount === 1 ? "" : "s"} pendiente{creditPendingInvoicesCount === 1 ? "" : "s"}</strong>
                  <span>{creditPendingClientCount} cliente{creditPendingClientCount === 1 ? "" : "s"} requiere{creditPendingClientCount === 1 ? "" : "n"} seguimiento administrativo. Este aviso se mostrara una vez al mes mientras existan créditos pendientes.</span>
                </div>
                <button className="pa-btn secondary pa-btn-sm" onClick={() => setCreditStatusFilter("open")}>
                  Revisar pendientes
                </button>
              </div>
            )}

            <div className="pa-panel pa-credit-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <span className="pa-section-kicker">Seguimiento</span>
                  <h2>Seguimientos por cliente</h2>
                </div>
                <span className="pa-results-count">
                  {creditClientGroups.length} cliente{creditClientGroups.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table acm-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Órdenes</th>
                      <th>Fechas</th>
                      <th>Estado</th>
                      <th className="pa-credit-actions-col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditClientGroups.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="ps-table-empty">
                          <div className="acm-empty-state">
                            <Icons.Receipt />
                            <strong>No hay seguimientos registrados</strong>
                            <span>{hasCreditFilters ? "Intenta con otros filtros o limpia la búsqueda." : "Los pendientes de seguimiento aparecerán aquí."}</span>
                            {hasCreditFilters && <button className="pa-btn secondary pa-btn-sm" onClick={() => { setCreditSearch(""); setCreditStatusFilter("open"); }}>Limpiar filtros</button>}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedCreditClientGroups.map(group => {
                        const clientId = group.client?.id;
                        return (
                          <tr
                            key={clientId}
                            className="row-hover acm-client-row"
                            onClick={() => { setCreditDetailClientId(clientId); setCreditView("detail"); }}
                            onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setCreditDetailClientId(clientId); setCreditView("detail"); } }}
                            tabIndex={0}
                          >
                            <td className="td-pad td-name">
                              <div className="pa-credit-client-cell">
                                <div className="pa-credit-client-meta">
                                  <strong>{group.client?.name || "Cliente sin nombre"}</strong>
            <span>{group.client?.phone || "Sin telefono"}</span>
                                </div>
                              </div>
                            </td>
                            <td className="td-pad">
                              <div className="pa-credit-badge-stack">
                                <span className="acm-badge warning">
                                  {group.pendingCount} pendiente{group.pendingCount === 1 ? "" : "s"}
                                </span>
                              </div>
                            </td>
                            <td className="td-pad">
                              <div className="pa-credit-date-stack">
                                <span>Antigua: <strong>{formatCreditDate(group.oldestIssuedAt)}</strong></span>
                                <span>Reciente: <strong>{formatCreditDate(group.newestIssuedAt)}</strong></span>
                              </div>
                            </td>
                            <td className="td-pad">
                              <span className={`acm-badge ${group.pendingCount > 0 ? "warning" : "success"}`}>
                                {group.pendingCount > 0 ? "Con pendientes" : "Sin pendientes"}
                              </span>
                            </td>
                            <td className="td-pad td-actions" onClick={(event) => event.stopPropagation()}>
                              <div className="table-actions acm-row-actions">
                                <button
                                  className="table-action-btn view"
                                  onClick={() => { setCreditDetailClientId(clientId); setCreditView("detail"); }}
                                  title="Ver pendientes del cliente"
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
              {creditClientGroups.length > 0 && (
                <div className="acm-pagination-footer">
                  <Pagination currentPage={safeCreditPage} totalPages={creditTotalPages} onPageChange={setCreditPage} />
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "credits" && creditView === "detail" && creditDetailClient && (
          <CreditClientDetailView
            group={creditDetailClient}
            selectedCreditOrderIds={selectedCreditOrderIds}
            onToggleSelection={toggleCreditOrderSelection}
            onToggleAll={toggleAllCreditOrdersForClient}
            onSettle={openCreditSettlementModal}
            onCreateReminder={openCreditReminderModal}
            onViewOrder={setSelectedOrder}
            onBack={() => { setCreditView("list"); setCreditDetailClientId(null); }}
            isOpenCreditReceivable={isOpenCreditReceivable}
            getCreditReceivableStatusLabel={getCreditReceivableStatusLabel}
            getCreditReceivableStatusStyle={getCreditReceivableStatusStyle}
            formatCreditDate={formatCreditDate}
            readOnly
          />
        )}

        {activeTab === "clients" && (
          <AdminClientsModule
            supabase={supabase}
            refreshKey={clientDirectoryRefreshKey}
            onAddClient={handleAddClient}
            onEditClient={handleEditClient}
            onRequestDelete={(client) => setClientToDelete(client)}
            onRestoreClient={handleRestoreClient}
            onCreateOrder={openCreateOrderFromClient}
            onViewOrders={(clientId) => handleClientClick({ id: clientId })}
            onManageCredit={handleManageClientCredit}
          />
        )}

        <ModalShell open={!!recordPaymentClient} onClose={() => setRecordPaymentClient(null)} title="Cerrar pendientes" size="compact">
          <div style={{ minWidth: 320 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
              {recordPaymentClient?.name}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>
              Pendientes abiertos: {receivablesByClient[recordPaymentClient?.id]?.count || 0}
            </p>

            {(receivablesByClient[recordPaymentClient?.id]?.invoices || []).length > 0 && (
              <div className="pa-field">
                <span>Referencias</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {receivablesByClient[recordPaymentClient?.id].invoices.map((invoiceNumber) => (
                    <span key={invoiceNumber} className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>
                      {invoiceNumber}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="pa-field">
              <span>Nota de cierre</span>
              <textarea
                value={recordPaymentForm.notes}
                onChange={(event) => setRecordPaymentForm(prev => ({ ...prev, notes: event.target.value }))}
                rows={3}
                placeholder="Ej: Seguimiento revisado por administración"
              />
            </label>

            <div className="pa-modal-actions">
              <button className="pa-btn secondary" onClick={() => setRecordPaymentClient(null)} disabled={recordPaymentLoading}>
                Cancelar
              </button>
              <button className="pa-btn primary" onClick={handleRecordClientPayment} disabled={recordPaymentLoading}>
                {recordPaymentLoading ? "Cerrando..." : "Cerrar pendientes"}
              </button>
            </div>
          </div>
        </ModalShell>

        <ModalShell open={!!creditSettlementTarget} onClose={() => setCreditSettlementTarget(null)} title="Cerrar pendientes" size="compact">
          <div style={{ minWidth: 320 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
              {creditSettlementTarget?.client?.name || "Cliente sin nombre"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>
              Pendientes a cerrar: {creditSettlementTarget?.orderIds?.length || 0}
            </p>

            {(creditSettlementTarget?.invoices || []).length > 0 && (
              <div className="pa-field">
                <span>Referencias</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {creditSettlementTarget.invoices.map((invoiceNumber) => (
                    <span key={invoiceNumber} className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>
                      {invoiceNumber}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="pa-field">
              <span>Nota de cierre</span>
              <textarea
                value={creditSettlementNotes}
                onChange={(event) => setCreditSettlementNotes(event.target.value)}
                rows={3}
                placeholder="Ej: Seguimiento revisado por administración"
              />
            </label>

            <div className="pa-modal-actions">
              <button className="pa-btn secondary" onClick={() => setCreditSettlementTarget(null)} disabled={creditSettlementLoading}>
                Cancelar
              </button>
              <button className="pa-btn primary" onClick={handleConfirmCreditSettlement} disabled={creditSettlementLoading}>
                {creditSettlementLoading ? "Cerrando..." : "Marcar todas como saldadas"}
              </button>
            </div>
          </div>
        </ModalShell>

        {showClientModal && (
          <div className="pa-overlay">
            <div className="pa-modal pa-client-modal ps-file-details-modal" style={{ maxWidth: 620 }} onClick={event => event.stopPropagation()}>
              <div className="pa-modal-head">
                <div>
                  <h3>{editingClient ? "Editar cliente" : "Agregar cliente"}</h3>
                  <p className="pa-client-modal-subtitle">Estos datos se reutilizan al crear ordenes y ayudan a autocompletar el formulario Seller.</p>
                </div>
                <button className="pa-close-btn" onClick={() => setShowClientModal(false)}>
                  <Icons.Close />
                </button>
              </div>
              <div className="pa-modal-body">
                <div className="pa-client-form-intro">
                  <Icons.AlertCircle />
                  <div>
                    <span>Cliente registrado</span>
                    <strong>Nombre y telefono son obligatorios</strong>
                  </div>
                </div>
                <div className="ps-file-details-content">
                  <div className="ps-field">
                    <label className="ps-label">Nombre <span className="ps-label-req">*</span></label>
                    <input
                      className="ps-form-input"
                      value={clientForm.name}
                      onChange={event => {
                        setClientForm(prev => ({ ...prev, name: event.target.value }));
                        setClientFormError("");
                        setClientFormErrors(prev => ({ ...prev, name: "" }));
                      }}
                      placeholder="Nombre del cliente"
                      autoComplete="name"
                      autoFocus
                    />
                    {clientFormErrors.name && <p className="ps-field-error-message">{clientFormErrors.name}</p>}
                  </div>
                  <div className="ps-field">
                    <label className="ps-label">Teléfono <span className="ps-label-req">*</span></label>
                    <input
                      className="ps-form-input"
                      type="tel"
                      value={clientForm.phone}
                      onChange={event => {
                        setClientForm(prev => ({ ...prev, phone: formatPhone(event.target.value) }));
                        setClientFormError("");
                        setClientFormErrors(prev => ({ ...prev, phone: "" }));
                      }}
                      placeholder="+1 555 123 4567"
                      autoComplete="tel"
                    />
                    {clientFormErrors.phone && <p className="ps-field-error-message">{clientFormErrors.phone}</p>}
                  </div>
                  <div className="ps-field">
                    <label className="ps-label">Correo <span className="ps-label-opt">(opcional)</span></label>
                    <input
                      className="ps-form-input"
                      type="email"
                      value={clientForm.email}
                      onChange={event => setClientForm(prev => ({ ...prev, email: event.target.value }))}
                      placeholder="cliente@empresa.com"
                      autoComplete="email"
                    />
                  </div>
                  <div className="ps-field">
                    <label className="ps-label">Dirección <span className="ps-label-opt">(opcional)</span></label>
                    <input
                      className="ps-form-input"
                      value={clientForm.address}
                      onChange={event => setClientForm(prev => ({ ...prev, address: event.target.value }))}
                      placeholder="Dirección opcional"
                      autoComplete="street-address"
                    />
                  </div>
                  <div className="ps-field">
                    <label className="ps-label">Notas <span className="ps-label-opt">(opcional)</span></label>
                    <textarea
                      className="ps-form-input"
                      rows={3}
                      value={clientForm.notes}
                      onChange={event => setClientForm(prev => ({ ...prev, notes: event.target.value }))}
                      placeholder="Notas internas opcionales"
                    />
                  </div>
                </div>
                {clientFormError && <p className="pa-client-form-error">{clientFormError}</p>}
              </div>
              <div className="pq-production-dialog-footer">
                <div className="pq-dialog-actions">
                  <button type="button" className="pq-btn pq-btn-secondary" onClick={() => setShowClientModal(false)} disabled={saving}>Cancelar</button>
                  <button type="button" className="pq-btn pq-btn-primary" onClick={handleSaveClient} disabled={saving}>
                    {saving ? "Guardando..." : <><Icons.Plus />{editingClient ? "Guardar cambios" : "Agregar cliente"}</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "materials" && (
          <section className="pa-section">
            <div className="pa-section-heading acm-heading acm-heading--materials">
              <div>
                <h2>Gestión de Materiales</h2>
                <p>Administra los materiales y terminaciones disponibles para las órdenes de producción.</p>
                <div className="acm-materials-badges">
                  <div className="acm-total-badge acm-material-badge" data-tone="materials">
                    <Icons.Package />
                    <strong>{materials.length.toLocaleString("es-PE")}</strong> materiales registrados
                  </div>
                  <div className="acm-total-badge acm-termination-badge" data-tone="terminations">
                    <Icons.Paintbrush />
                    <strong>{productionTerminations.length.toLocaleString("es-PE")}</strong> terminaciones registradas
                  </div>
                </div>
              </div>
              <div className="acm-heading-actions">
                <button
                  type="button"
                  className="pa-btn primary"
                  ref={materialAnalyticsOverviewTriggerRef}
                  onClick={() => setShowMaterialAnalyticsOverview(true)}
                >
                  <Icons.ChartArea />
                  Estadísticas generales
                </button>
              </div>
            </div>
            <SalesFilterToolbar
              ariaLabel="Filtros de materiales"
              search={{
                label: "Buscar materiales",
                value: materialSearch,
                onChange: setMaterialSearch,
                placeholder: "Buscar por nombre...",
              }}
              resultCount={filteredMaterials.length}
              resultLabel="resultados"
              activeFilters={materialSearch ? 1 : 0}
              onReset={() => setMaterialSearch("")}
              actions={(
                <>
                  <button
                    type="button"
                    className="pa-btn primary acm-materials-registration-action"
                    onClick={handleAddMaterial}
                  >
                    <Icons.Plus />
                    Registrar material
                  </button>
                  <button
                    type="button"
                    className="pa-btn primary acm-materials-registration-action"
                    onClick={() => openTerminationModal()}
                  >
                    <Icons.Paintbrush />
                    Registrar terminación
                  </button>
                </>
              )}
            />
            <div className="pa-panel mat-table-panel">
              <div className="pa-panel-head mat-unified-head">
                <div>
                  <span className="mat-kicker">Catálogo de producción</span>
                  <h2>Materiales y Terminaciones</h2>
                </div>
                <div className="mat-panel-tools">
                  <div className="mat-tabs" role="tablist" aria-label="Filtro de materiales y terminaciones">
                    <button
                      type="button"
                      className={materialViewMode === "materials" ? "active" : ""}
                      onClick={() => setMaterialViewMode("materials")}
                      aria-selected={materialViewMode === "materials"}
                    >
                      <Icons.Package />
                      <span>Materiales</span>
                      <strong>{materials.length}</strong>
                    </button>
                    <button
                      type="button"
                      className={materialViewMode === "terminations" ? "active" : ""}
                      onClick={() => setMaterialViewMode("terminations")}
                      aria-selected={materialViewMode === "terminations"}
                    >
                      <Icons.Clipboard />
                      <span>Terminaciones</span>
                      <strong>{productionTerminations.length}</strong>
                    </button>
                  </div>
                  {materialViewMode === "materials" && (
                    <div className="mat-tabs" role="tablist" aria-label="Filtro por área de producción">
                      <button
                        type="button"
                        className={materialAreaFilter === "all" ? "active" : ""}
                        onClick={() => setMaterialAreaFilter("all")}
                        aria-selected={materialAreaFilter === "all"}
                      >
                        <span>Todos</span>
                      </button>
                      <button
                        type="button"
                        className={materialAreaFilter === "ploteo" ? "active" : ""}
                        onClick={() => setMaterialAreaFilter(materialAreaFilter === "ploteo" ? "all" : "ploteo")}
                        aria-selected={materialAreaFilter === "ploteo"}
                      >
                        <Icons.Package />
                        <span>Ploteo</span>
                      </button>
                      <button
                        type="button"
                        className={materialAreaFilter === "digital" ? "active" : ""}
                        onClick={() => setMaterialAreaFilter(materialAreaFilter === "digital" ? "all" : "digital")}
                        aria-selected={materialAreaFilter === "digital"}
                      >
                        <Icons.Package />
                        <span>Impresión</span>
                      </button>
                      <button
                        type="button"
                        className={materialAreaFilter === "dtf" ? "active" : ""}
                        onClick={() => setMaterialAreaFilter(materialAreaFilter === "dtf" ? "all" : "dtf")}
                        aria-selected={materialAreaFilter === "dtf"}
                      >
                        <Icons.Package />
                        <span>DTF</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {materialViewMode === "materials" ? (
                <>
                  <div className="ps-table-wrap" style={{ maxHeight: 520 }}>
                    <table className="ps-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Área de producción</th>
                          <th>Registro</th>
                          <th style={{ width: 120 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialsLoading ? (
                          <tr>
                            <td colSpan={4} className="ps-table-empty">Cargando materiales...</td>
                          </tr>
                        ) : filteredMaterials.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="ps-table-empty">
                              {materialSearch ? "No hay materiales que coincidan con la búsqueda." : "No hay materiales registrados. Agrega el primer material para comenzar."}
                            </td>
                          </tr>
                        ) : (
                          paginatedMaterials.map((mat) => (
                            <tr key={mat.id} className="row-hover">
                              <td className="td-pad td-name">{mat.name}</td>
                              <td className="td-pad"><span className={`acm-badge ${mat.production_area_code ? "info" : "neutral"}`}>{productionAreas.find((area) => area.code === mat.production_area_code)?.label || "Sin clasificar"}</span></td>
                              <td className="td-pad td-date">
                                <span className="acm-badge neutral">{new Date(mat.created_at).toLocaleDateString("es-DO", {
                                  day: "2-digit", month: "short", year: "numeric"
                                })}</span>
                              </td>
                              <td className="td-pad td-actions" onClick={(e) => e.stopPropagation()}>
                                <div className="table-actions mat-row-actions">
                                  <button
                                    type="button"
                                    className="table-action-btn view"
                                    title={`Ver actividad de ${mat.name}`}
                                    aria-label={`Ver actividad de ${mat.name}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      materialAnalyticsTriggerRef.current = event.currentTarget;
                                      setSelectedMaterialAnalytics({ material_id: mat.id, name: mat.name });
                                    }}
                                  >
                                    <Icons.Eye />
                                  </button>
                                  <button type="button" className="table-action-btn edit" onClick={() => handleEditMaterial(mat)} title="Editar material">
                                    <Icons.Edit />
                                  </button>
                                  <button
                                    type="button"
                                    className="table-action-btn cancel"
                                    onClick={() => handleDeleteMaterial(mat)}
                                    title="Eliminar material"
                                  >
                                    <Icons.Trash />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!materialsLoading && filteredMaterials.length > 0 && (
                    <div className="acm-pagination-footer">
                      <Pagination currentPage={safeMaterialPage} totalPages={totalMaterialPages} onPageChange={setMaterialsPage} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="ps-table-wrap" style={{ maxHeight: 520 }}>
                    <table className="ps-table">
                      <thead><tr><th>Terminación</th><th>Área</th><th style={{ width: 120 }} /></tr></thead>
                      <tbody>
                        {productionTerminations.length === 0 ? (
                          <tr><td colSpan={3} className="ps-table-empty">No hay terminaciones registradas.</td></tr>
                        ) : paginatedTerminations.map((termination) => (
                          <tr key={termination.id} className="row-hover">
                            <td className="td-pad td-name">{termination.name}</td>
                            <td className="td-pad">{productionAreas.find((area) => area.code === termination.production_area_code)?.label || termination.production_area_code}</td>
                            <td className="td-pad td-actions"><div className="table-actions mat-row-actions">
                              <button className="table-action-btn edit" onClick={() => openTerminationModal(termination)} title="Editar terminación"><Icons.Edit /></button>
                              <button className="table-action-btn cancel" onClick={() => handleDeleteTermination(termination)} title="Eliminar terminación"><Icons.Trash /></button>
                            </div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {productionTerminations.length > 0 && (
                    <div className="acm-pagination-footer">
                      <Pagination currentPage={safeTerminationPage} totalPages={totalTerminationPages} onPageChange={setTerminationsPage} />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {(selectedMaterialAnalytics || showMaterialAnalyticsOverview) && (
          <Suspense fallback={null}>
            {selectedMaterialAnalytics && (
              <MaterialDetailModal
                material={selectedMaterialAnalytics}
                previousMaterial={null}
                totalReferences={0}
                userId={authUser?.id}
                source="catalog"
                periodMeta={getMaterialGlobalBounds()}
                returnFocusRef={materialAnalyticsTriggerRef}
                onClose={() => setSelectedMaterialAnalytics(null)}
              />
            )}
            {showMaterialAnalyticsOverview && (
              <MaterialAnalyticsOverviewModal
                open={showMaterialAnalyticsOverview}
                userId={authUser?.id}
                returnFocusRef={materialAnalyticsOverviewTriggerRef}
                onClose={() => setShowMaterialAnalyticsOverview(false)}
              />
            )}
          </Suspense>
        )}

        {showOrderStatisticsModal && (
          <Suspense fallback={null}>
            <OrderStatisticsModal
              open={showOrderStatisticsModal}
              userId={authUser?.id}
              onClose={() => setShowOrderStatisticsModal(false)}
              initialPeriod={dateFilter}
            />
          </Suspense>
        )}

        <Modal
          open={showMaterialModal}
          onClose={() => setShowMaterialModal(false)}
          title={editingMaterial ? "Editar material" : "Agregar material"}
          closeOnBackdrop
          closeOnEscape={false}
          hideStripe
          className="ps-file-details-modal"
          overlayClassName="ps-file-details-overlay"
          headerContent={<h3 className="ps-file-details-title">{editingMaterial ? "Editar material" : "Agregar material"}</h3>}
        >
          <div className="ps-file-details-content">
            {materialFormError && <p className="ps-form-error-banner" role="alert">{materialFormError}</p>}
            <Field label="Nombre del material" required>
              <input
                className="ps-form-input"
                value={materialFormName}
                onChange={e => { setMaterialFormName(e.target.value); setMaterialFormError(""); }}
                placeholder="Ej. Vinilo, Banner, Lona..."
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSaveMaterial(); }}
              />
            </Field>
            <Field label="Área de producción" required>
              <select
                className="ps-form-input"
                value={materialFormAreaCode}
                onChange={e => { setMaterialFormAreaCode(e.target.value); setMaterialFormError(""); }}
              >
                <option value="">Seleccionar área</option>
                {productionAreas.map((area) => <option key={area.code} value={area.code}>{area.label}</option>)}
              </select>
            </Field>
            <div className="ps-form-actions ps-file-details-actions">
              <button type="button" className="ps-btn-cancel ps-file-details-btn-cancel" onClick={() => setShowMaterialModal(false)}>Cancelar</button>
              <button
                type="button"
                className="ps-btn-submit ps-file-details-btn-save"
                onClick={handleSaveMaterial}
                disabled={!editingMaterial && !isMaterialCreateReady}
              >
                <Icons.Check />
                {editingMaterial ? "Guardar cambios" : "Agregar material"}
              </button>
            </div>
          </div>
        </Modal>

        {showTerminationModal && (
          <div className="pa-overlay" onClick={() => setShowTerminationModal(false)}>
            <div className="pa-modal pa-modal--hide-top-accent" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="pa-modal-head">
                <h3>{editingTermination ? "Editar terminación" : "Agregar terminación"}</h3>
                <button className="pa-close-btn" onClick={() => setShowTerminationModal(false)} aria-label="Cerrar"><Icons.X /></button>
              </div>
              <div className="pa-modal-body" style={{ paddingBottom: 44 }}>
                <div className="pa-field">
                  <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: "13px", color: "#0f1e40" }}>Nombre de la terminación</label>
                  <input className="pa-input" value={terminationFormName} onChange={e => { setTerminationFormName(e.target.value); setTerminationFormError(""); }} placeholder="Ej. Dobladillo, Ojales, Mate..." autoFocus />
                  <label style={{ display: "block", margin: "14px 0 6px", fontWeight: 600, fontSize: "13px", color: "#0f1e40" }}>Área de producción</label>
                  <select className="pa-input" value={terminationFormAreaCode} onChange={e => { setTerminationFormAreaCode(e.target.value); setTerminationFormError(""); }}>
                    <option value="">Seleccionar área</option>
                    {productionAreas.map((area) => <option key={area.code} value={area.code}>{area.label}</option>)}
                  </select>
                  {terminationFormError && <p style={{ color: "#EF4444", fontSize: "12px", marginTop: 6 }}>{terminationFormError}</p>}
                </div>
              </div>
              <div className="pa-modal-actions">
                <button className="pa-btn secondary" onClick={() => setShowTerminationModal(false)}>Cancelar</button>
                <button className="pa-btn primary" onClick={handleSaveTermination}>{editingTermination ? "Guardar cambios" : "Agregar terminación"}</button>
              </div>
            </div>
          </div>
        )}

        <ArchiveOrderModal
          open={!!materialToDelete}
          onClose={() => setMaterialToDelete(null)}
          onConfirm={handleConfirmDeleteMaterial}
          order={materialToDelete}
          loading={materialDeleteLoading}
          title="Eliminar material"
          confirmText="Eliminar material"
          cancelText="Cancelar"
          className="mat-delete-modal"
        >
          <p>
            ¿Estás seguro de que deseas eliminar <strong>{materialToDelete?.name}</strong>?
          </p>
          <p className="archive-modal-hint">Esta acción no se puede deshacer. El material será eliminado permanentemente del sistema.</p>
        </ArchiveOrderModal>

        <ArchiveOrderModal
          open={!!employeeToDelete}
          onClose={() => setEmployeeToDelete(null)}
          onConfirm={handleConfirmDeleteEmployee}
          order={employeeToDelete}
          loading={employeeDeleteLoading}
          title="Dar de baja empleado"
          confirmText="Dar de baja"
          cancelText="Cancelar"
          className="emp-delete-modal"
          variant="danger"
          loadingText="Dando de baja..."
          confirmIcon={<Icons.Trash />}
        >
          <p>
            ¿Estás seguro de que deseas eliminar a{" "}
            <strong>{employeeToDelete?.name || employeeToDelete?.email}</strong>?
          </p>
          <p className="archive-modal-hint">Esta acción no se puede deshacer. El empleado será eliminado permanentemente del sistema.</p>
        </ArchiveOrderModal>

        <ArchiveOrderModal
          open={!!clientToDelete}
          onClose={() => setClientToDelete(null)}
          onConfirm={handleConfirmDeleteClient}
          order={clientToDelete}
          loading={clientDeleteLoading}
          title="Dar de baja cliente"
          confirmText="Dar de baja"
          cancelText="Cancelar"
          className="client-delete-modal"
          variant="danger"
          loadingText="Dando de baja..."
          confirmIcon={<Icons.Trash />}
        >
          <p>
            ¿Estás seguro de que deseas eliminar al cliente{" "}
            <strong>{clientToDelete?.name}</strong>?
          </p>
          <p className="archive-modal-hint">Esta acción no se puede deshacer. El cliente será eliminado permanentemente del sistema.</p>
        </ArchiveOrderModal>

        {activeTab === "users" && employeeDetailView && selectedEmployeeId ? (
          <AdminEmployeeModule
            profile={usersById[selectedEmployeeId]}
            onBack={closeEmployeeDetail}
            onEditUser={(profile) => openEditUserModal(profile)}
            onViewOrder={(order) => setSelectedOrder(order)}
            onDeleteUser={requestEmployeeRetirement}
            onRestoreUser={handleRestoreEmployee}
            currentUserId={user?.id}
          />
        ) : activeTab === "users" &&
          <section className="pa-section acm-section" aria-labelledby="users-title">
            <div className="pa-section-heading acm-heading">
              <div>
                <h2 id="users-title">Gestión de Empleados</h2>
                <p>Consulta, segmenta y administra los empleados del sistema.</p>
                {profiles.length > 0 && (
                  <div className="acm-total-badge">
                    <Icons.Users />
                    <strong>{profiles.length.toLocaleString("es-PE")}</strong> empleados registrados
                  </div>
                )}
              </div>
              <button className="pa-btn primary" onClick={openCreateUserModal}>
                <Icons.Plus /> Crear empleado
              </button>
            </div>

            <SalesFilterToolbar
              ariaLabel="Filtros de empleados"
              search={{
                label: "Buscar empleados",
                value: userSearch,
                onChange: setUserSearch,
                placeholder: "Buscar por nombre, correo o rol...",
              }}
              controls={[
                { id: "role", label: "Rol", icon: <Icons.Users />, value: roleFilter, onChange: setRoleFilter, isActive: roleFilter !== "all", options: [{ value: "all", label: "Todos los roles" }, { value: "admin", label: "Administrador" }, { value: "semi_admin", label: "Semi-Administrador" }, { value: "seller", label: "Vendedor" }, { value: "designer", label: "Diseñador" }, { value: "quote", label: "Caja" }, { value: "printer", label: "Producción legacy" }, { value: "digital_producer", label: "Producción Digital" }, { value: "dtf_producer", label: "Producción DTF" }, { value: "ploteo_producer", label: "Producción Ploteo" }, { value: "delivery", label: "Entrega" }] },
                { id: "employment", label: "Estado laboral", icon: <Icons.UserCheck />, value: employmentFilter, onChange: setEmploymentFilter, isActive: employmentFilter !== "all", options: [{ value: "all", label: "Todos" }, { value: "active", label: "Activos" }, { value: "inactive", label: "Inactivos" }] },
              ]}
              resultCount={filteredProfiles.length}
              resultLabel={`resultado${filteredProfiles.length === 1 ? "" : "s"}`}
              activeFilters={[userSearch, roleFilter !== "all", employmentFilter !== "all"].filter(Boolean).length}
              onReset={() => { setUserSearch(""); setRoleFilter("all"); setEmploymentFilter("all"); }}
            />

            <div className="pa-panel acm-table-panel">
              <div className="pa-panel-head mat-unified-head">
                <div>
                  <span className="mat-kicker">Gestión de RRHH</span>
                  <h2>Empleados del sistema</h2>
                </div>
                <div className="mat-panel-tools">
                  <div className="mat-tabs" role="tablist" ariaLabel="Filtro de empleados">
                    <button
                      type="button"
                      className={employmentFilter === "all" ? "active" : ""}
                      onClick={() => setEmploymentFilter("all")}
                      aria-selected={employmentFilter === "all"}
                    >
                      <Icons.Users />
                      <span>Todos</span>
                    </button>
                    <button
                      type="button"
                      className={employmentFilter === "active" ? "active" : ""}
                      onClick={() => setEmploymentFilter(employmentFilter === "active" ? "all" : "active")}
                      aria-selected={employmentFilter === "active"}
                    >
                      <Icons.Check />
                      <span>Activos</span>
                    </button>
                    <button
                      type="button"
                      className={employmentFilter === "inactive" ? "active" : ""}
                      onClick={() => setEmploymentFilter(employmentFilter === "inactive" ? "all" : "inactive")}
                      aria-selected={employmentFilter === "inactive"}
                    >
                      <Icons.UserMinus />
                      <span>Desactivados</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="ps-table-wrap">
                <table className="ps-table acm-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Correo</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {loadingUsers ? (
                      Array.from({ length: USERS_PER_PAGE }, (_, index) => (
                        <tr key={index} className="acm-skeleton-row" aria-hidden="true">
                          <td colSpan={5}><span /></td>
                        </tr>
                      ))
                    ) : loadUsersError ? (
                      <tr>
                        <td colSpan={5} className="ps-table-empty">
                          <div className="acm-error-state">
                            <Icons.AlertCircle />
                            <span>{loadUsersError}</span>
                            <button className="pa-btn secondary pa-btn-sm" onClick={loadProfiles}>Reintentar</button>
                          </div>
                        </td>
                      </tr>
                    ) : paginatedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="ps-table-empty">
                          <div className="acm-empty-state">
                            <Icons.Users />
                            <strong>No encontramos empleados</strong>
                            <span>{hasUserFilters ? "Intenta con otros filtros o limpia la búsqueda." : "Crea el primer empleado para comenzar."}</span>
                            {hasUserFilters && <button className="pa-btn secondary pa-btn-sm" onClick={() => { setUserSearch(""); setRoleFilter("all"); setEmploymentFilter("all"); }}>Limpiar filtros</button>}
                          </div>
                        </td>
                      </tr>
                    ) : paginatedUsers.map(item => {
                      const isActive = isEmploymentActive(item);
                      return (
                        <tr
                          key={item.id}
                          className="row-hover acm-client-row"
                          onClick={() => openEmployeeDetail(item)}
                          onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); openEmployeeDetail(item); } }}
                          tabIndex={0}
                        >
                          <td className="td-pad">
                            <div className="acm-client-cell">
                              <span className="acm-avatar acm-avatar-small">{getInitials(getUserDisplayName(item))}</span>
                              <span>
                                <strong>{getUserDisplayName(item)}</strong>
                                <small className="acm-employee-id">#{item.id.slice(0, 8).toUpperCase()}</small>
                              </span>
                            </div>
                          </td>
                          <td className="td-pad"><span className="acm-employee-email">{item.email || "Sin correo"}</span></td>
                          <td className="td-pad"><RoleBadge role={item.role} /></td>
                          <td className="td-pad">
                            <span className={`acm-badge ${isActive ? "success" : "neutral"}`}>
                              {isActive ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td className="td-pad td-actions" onClick={(e) => e.stopPropagation()}>
                            <div className="table-actions acm-row-actions">
                              <button className="table-action-btn view" onClick={() => openEmployeeDetail(item)} title="Ver detalles" aria-label={`Ver detalles de ${getUserDisplayName(item)}`}>
                                <Icons.Eye />
                              </button>
                              <button className="table-action-btn edit" onClick={() => openEditUserModal(item)} title="Editar empleado" aria-label={`Editar ${getUserDisplayName(item)}`}>
                                <Icons.Edit />
                              </button>
                              {item.id !== user?.id && (
                                <button
                                  className={`table-action-btn ${isActive ? "cancel" : "activate"}`}
                                  onClick={() => openEmploymentStatusConfirm(item)}
                                  title={isActive ? "Desactivar empleado" : "Activar empleado"}
                                  aria-label={isActive ? `Desactivar ${getUserDisplayName(item)}` : `Activar ${getUserDisplayName(item)}`}
                                >
                                  {isActive ? <Icons.UserMinus /> : <Icons.Check />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!loadingUsers && !loadUsersError && filteredProfiles.length > 0 && (
                <div className="acm-pagination-footer">
                  <Pagination currentPage={safeUserPage} totalPages={userTotalPages} onPageChange={setUserPage} />
                </div>
              )}
            </div>
          </section>
        }
        </main>
      </div>

      {orderModalMode === "create" ? (
        <CreateOrderModal
          open={orderModalOpen}
          onClose={() => { setOrderModalOpen(false); setEditingOrder(null); setClientFieldLocked(false); }}
          onCreated={async () => {
            await Promise.all([loadOrders(), fetchClients(), fetchAccountsReceivable()]);
            await notif.refresh?.({ showNewToasts: true });
            showFeedback("success", "Orden creada correctamente.");
          }}
          userId={user?.id}
          productionCatalog={productionCatalog}
          clients={clients}
          clientsLoading={clientsLoading}
          onClientSearch={handleClientSearch}
          onAddNewClient={() => setShowOrderClientModal(true)}
          clientToSelect={clientToSelectInOrderForm}
          onClientToSelectConsumed={() => setClientToSelectInOrderForm(null)}
          clientFieldDisabled={clientFieldLocked}
        />
      ) : (
        <SharedEditOrderModal
          open={orderModalOpen}
          onClose={() => { setOrderModalOpen(false); setSelectedOrder(null); setEditingOrder(null); }}
          order={editingOrder}
          onUpdated={async () => {
            await Promise.all([loadOrders(), fetchAccountsReceivable()]);
            showFeedback("success", "Orden actualizada correctamente.");
          }}
          productionCatalog={productionCatalog}
          clients={clients}
          onClientSearch={handleClientSearch}
          clientsLoading={clientsLoading}
        />
      )}
      <CreateClientModal
        open={showOrderClientModal}
        onClose={() => setShowOrderClientModal(false)}
        onCreated={handleOrderClientCreated}
      />
      {activeTab === "credits" ? (
        <CreditOrderDetailModal
          open={!!selectedOrder}
          order={selectedOrder}
          usersById={usersById}
          onClose={() => setSelectedOrder(null)}
        />
      ) : (
        <SharedOrderDetailModal
          open={!!selectedOrder}
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          responsibleName={selectedOrder ? (selectedOrder.seller_id ? getUserDisplayName(usersById[selectedOrder.seller_id]) : "Sin asignar — Administración") : "---"}
          designerName={selectedOrder?.designer_id ? getUserDisplayName(usersById[selectedOrder.designer_id]) : ""}
          primaryActionLabel="Asignar Orden"
          showPrimaryAction={false}
          onSendToDesigner={(order) => {
            setSelectedOrder(null);
            openAssignModal(order, "designer");
          }}
          onSendToQuotation={(order) => {
            setSelectedOrder(null);
            openAssignModal(order, "quote");
          }}
          adminActions={selectedOrder ? (
            <AdminOrderActions
              order={selectedOrder}
              variant="modal"
              onEdit={openEditOrder}
              onAdvanced={openAdvancedSettings}
              onPayment={openPaymentModal}
              onCancel={openCancelModal}
            />
          ) : null}
        />
      )}
      <AssignModal
        open={!!assigningOrder}
        order={assigningOrder}
      role={assigningRole}
      allowUnassigned={assigningRole === "quote"}
        title={assigningOrder?.order_design_type === "EXTERNAL_DESING" ? "Enviar a Caja" : undefined}
        onClose={() => { setAssigningOrder(null); setAssigningRole(null); }}
        onConfirm={handleAssignOrder}
        loading={assigningLoading}
      />
      <ProductionAssignmentModal
        open={!!advancedProduction}
        order={advancedProduction?.order}
        loading={advancedActionLoading}
        title={advancedProduction?.action === "reassign_production" ? "Reasignar Producción" : undefined}
        onClose={() => setAdvancedProduction(null)}
        onConfirm={handleAdvancedProductionConfirm}
      />
      <PaymentFormModal
        open={!!paymentModalOrder}
        order={paymentModalOrder}
        loading={paymentModalLoading}
        canAssignInvoiceCode
        onClose={() => setPaymentModalOrder(null)}
        onConfirm={handlePaymentConfirm}
      />
      <ModalShell open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="Confirmar Cancelación" size="compact">
        <div className="pa-confirm-modal-body">
          <div className="pa-confirm-icon cancel">
            <Icons.Trash />
          </div>
          <div className="pa-confirm-copy">
            <h4>Cancelar orden</h4>
            <p className="pa-confirm-order-name">{cancelOrderData?.client_name}</p>
            <p className="pa-confirm-order-desc">{cancelOrderData?.description?.slice(0, 60)}{cancelOrderData?.description?.length > 60 ? "..." : ""}</p>
            <label className="pa-field full">
              <span>Motivo de cancelación</span>
              <textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value.slice(0, 500))} placeholder="Describe por qué se cancela esta orden." />
            </label>
            <p className="pa-confirm-warning">La orden podrá reabrirse únicamente desde Configuración avanzada y quedará auditada.</p>
          </div>
          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={() => setCancelModalOpen(false)}>
              Cerrar
            </button>
            <button className="pa-btn pa-confirm-btn-cancel" onClick={handleConfirmCancelOrder} disabled={cancelLoading}>
              {cancelLoading ? "Cancelando..." : "Sí, cancelar orden"}
            </button>
          </div>
        </div>
      </ModalShell>
      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />
      <UserFormModal open={userModalOpen} mode={userModalMode} userForm={userForm} setUserForm={setUserForm} onClose={closeUserModal} onSubmit={handleSaveUser} saving={savingUser} submissionError={userModalError} onClearSubmissionError={() => setUserModalError("")} />
      <UserDetailModal open={userDetailModalOpen} user={selectedUser} onClose={() => setUserDetailModalOpen(false)} onEdit={openEditUserModal} onCreateOrder={handleCreateOrderFromUser} onRequestEmploymentToggle={openEmploymentStatusConfirm} onShowFeedback={showFeedback} currentUserId={user?.id} />
      <EmploymentStatusConfirmModal open={employmentStatusConfirmOpen} pendingChange={pendingEmploymentStatusChange} onClose={closeEmploymentStatusConfirm} onConfirm={confirmEmploymentStatusChange} saving={savingEmploymentStatus} />
      <SettleCreditModal
        open={!!creditSettleAllTarget}
        onClose={() => { setCreditSettleAllTarget(null); setCreditSettleAllNotes(""); }}
        onConfirm={handleConfirmCreditSettleAll}
        clientName={creditSettleAllTarget?.client?.name}
        invoiceCount={creditSettleAllTarget?.orderIds?.length}
        invoices={creditSettleAllTarget?.invoices}
        loading={creditSettleAllLoading}
        notes={creditSettleAllNotes}
        onNotesChange={setCreditSettleAllNotes}
      />
      <CreditReminderCreateModal
        open={!!creditReminderTarget}
        variant="admin"
        target={creditReminderTarget}
        form={creditReminderForm}
        visibilityOptions={CREDIT_REMINDER_VISIBILITY_OPTIONS}
        visibilityScope={creditReminderForm.visibilityScope}
        onFormChange={setCreditReminderForm}
        onVisibilityScopeChange={(visibilityScope) => setCreditReminderForm(prev => ({ ...prev, visibilityScope }))}
        onToggleOrder={toggleCreditReminderOrder}
        onClose={closeCreditReminderModal}
        onSubmit={handleSaveCreditReminder}
        saving={creditReminderSaving}
        minReminderAt={minimumCreditReminderAt}
        formatCreditDate={formatCreditDate}
        isOpenCreditReceivable={isOpenCreditReceivable}
      />
      <CreditPendingAlertModalPolished
        open={shouldShowCreditPendingAlert}
        invoiceCount={creditPendingInvoicesCount}
        clientCount={creditPendingClientCount}
        clients={creditPendingClientPreview}
        saving={creditAlertSaving}
        onClose={() => acknowledgeCreditPendingAlert()}
        onReview={() => acknowledgeCreditPendingAlert({ review: true })}
      />
      <CreditCustomReminderDueModal
        open={!shouldShowCreditPendingAlert && dueCreditCustomReminders.length > 0}
        variant="admin"
        reminders={dueCreditCustomReminders}
        completingId={creditReminderCompletingId}
        onClose={() => dismissDueCreditReminders()}
        onAcknowledge={handleAcknowledgeCreditReminder}
        onReview={handleReviewCreditReminder}
        formatCreditDate={formatCreditDate}
      />
    </div>
  );
}

function CreditPendingAlertModal({ open, invoiceCount, clientCount, clients, saving, onClose, onReview }) {
  return (
    <ModalShell open={open} onClose={onClose} title="Seguimientos pendientes" size="compact">
      <div className="pa-credit-alert-modal">
        <div className="pa-credit-alert-hero">
          <span className="pa-credit-alert-hero-icon"><Icons.Receipt /></span>
          <div>
            <strong>{invoiceCount} seguimiento{invoiceCount === 1 ? "" : "s"} pendiente{invoiceCount === 1 ? "" : "s"}</strong>
            <p>{clientCount} cliente{clientCount === 1 ? "" : "s"} requiere{clientCount === 1 ? "" : "n"} seguimiento administrativo.</p>
          </div>
        </div>

        {clients.length > 0 && (
          <div className="pa-credit-alert-client-list">
            {clients.map((group) => (
              <div key={group.client?.id || group.client?.name} className="pa-credit-alert-client">
                <div>
                  <strong>{group.client?.name || "Cliente sin nombre"}</strong>
                  <span>{group.client?.phone || "Sin telefono"}</span>
                </div>
                <span>{group.pendingCount} pendiente{group.pendingCount === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        )}

        <p className="pa-credit-alert-note">
          Este aviso se mostrara una vez al mes mientras existan seguimientos pendientes.
        </p>

        <div className="pa-modal-actions">
          <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
            {saving ? "Guardando..." : "Entendido"}
          </button>
          <button className="pa-btn primary" onClick={onReview} disabled={saving}>
            Revisar pendientes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CreditPendingAlertModalPolished({ open, invoiceCount, clientCount, clients, saving, onClose, onReview }) {
  return (
    <ModalShell open={open} onClose={onClose} title="Seguimientos pendientes" size="compact" className="pa-modal--no-gradient">
      <div className="pa-credit-alert-modal polished">
        <div className="pa-credit-alert-hero polished">
          <span className="pa-credit-alert-hero-icon"><Icons.Receipt /></span>
          <div className="pa-credit-alert-hero-copy">
            <span className="pa-credit-alert-kicker">Seguimiento administrativo</span>
            <strong>{invoiceCount} seguimiento{invoiceCount === 1 ? "" : "s"} pendiente{invoiceCount === 1 ? "" : "s"}</strong>
            <p>{clientCount} cliente{clientCount === 1 ? "" : "s"} requiere{clientCount === 1 ? "" : "n"} seguimiento administrativo.</p>
          </div>
        </div>

        <div className="pa-credit-alert-stats" aria-label="Resumen de seguimientos pendientes">
          <div>
            <span>Pendientes</span>
            <strong>{invoiceCount}</strong>
          </div>
          <div>
            <span>Clientes</span>
            <strong>{clientCount}</strong>
          </div>
        </div>

        {clients.length > 0 && (
          <div className="pa-credit-alert-section">
            <span className="pa-credit-alert-section-title">Clientes por revisar</span>
            <div className="pa-credit-alert-client-list">
              {clients.map((group) => (
                <div key={group.client?.id || group.client?.name} className="pa-credit-alert-client polished">
                  <div>
                    <strong>{group.client?.name || "Cliente sin nombre"}</strong>
                    <span>{group.client?.phone || "Sin telefono"}</span>
                  </div>
                  <span className="pa-credit-alert-client-count">{group.pendingCount} pendiente{group.pendingCount === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="pa-credit-alert-note polished">
          Este aviso se mostrara una vez al mes mientras existan seguimientos pendientes.
        </p>

        <div className="pa-modal-actions pa-credit-alert-actions">
          <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
            {saving ? "Guardando..." : "Entendido"}
          </button>
          <button className="pa-btn primary" onClick={onReview} disabled={saving}>
            Revisar pendientes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CreditClientDetailView({
  group,
  selectedCreditOrderIds,
  onToggleSelection,
  onToggleAll,
  onSettle,
  onCreateReminder,
  onViewOrder,
  onBack,
  isOpenCreditReceivable,
  getCreditReceivableStatusLabel,
  formatCreditDate,
  readOnly = false,
}) {
  const clientId = group.client?.id;
  const openInvoices = group.invoices.filter((item) => isOpenCreditReceivable(item));
  const settledInvoicesCount = group.invoices.filter((item) => item.status === "resolved").length;
  const selectedIds = selectedCreditOrderIds[clientId] || [];
  const allOpenSelected = openInvoices.length > 0 && openInvoices.every((item) => selectedIds.includes(item.order_id));
  const [detailSearch, setDetailSearch] = useState("");
  const [detailFilter, setDetailFilter] = useState("all");
  const [detailPage, setDetailPage] = useState(1);

  const filteredInvoices = useMemo(() => {
    const q = detailSearch.toLowerCase().trim();
    return group.invoices.filter((item) => {
      if (detailFilter === "open" && !isOpenCreditReceivable(item)) return false;
      if (detailFilter === "resolved" && item.status !== "resolved") return false;
      if (!q) return true;
      return (
        (item.invoiceNumber || "").toLowerCase().includes(q) ||
        (item.order_id || "").toLowerCase().includes(q)
      );
    });
  }, [group.invoices, detailFilter, detailSearch, isOpenCreditReceivable]);
  const CREDIT_DETAIL_PAGE_SIZE = 7;
  const detailTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / CREDIT_DETAIL_PAGE_SIZE));
  const safeDetailPage = Math.min(detailPage, detailTotalPages);
  const paginatedInvoices = filteredInvoices.slice((safeDetailPage - 1) * CREDIT_DETAIL_PAGE_SIZE, safeDetailPage * CREDIT_DETAIL_PAGE_SIZE);

  useEffect(() => {
    setDetailPage(1);
  }, [clientId, detailSearch, detailFilter]);

  return (
    <section className="pa-section pa-credit-layout">
      <div className="pa-credit-detail-view">
        <div className="pa-credit-detail-banner">
          <div className="pa-credit-detail-banner-top">
            <div className="pa-credit-detail-client-avatar">
              {group.client?.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="pa-credit-detail-banner-info">
              <h3>{group.client?.name || "Cliente sin nombre"}</h3>
            </div>
            <div className="pa-credit-detail-client-stats">
              <span className="pq-greeting-count pq-greeting-count--pending">
                <strong>{group.pendingCount}</strong> Pendientes
              </span>
              <span className="pq-greeting-count">
                <strong>{group.invoices.length}</strong> Total
              </span>
              <span className="pq-greeting-count pq-greeting-count--paid-today">
                <strong>{settledInvoicesCount}</strong> Saldadas
              </span>
            </div>
          </div>
          <div className="pa-credit-detail-banner-bottom">
            <button className="pa-credit-detail-back" onClick={onBack}>
              <Icons.ChevronLeft />
              Volver a seguimiento
            </button>
            {!readOnly && <button
              className="pa-credit-detail-primary-btn"
              onClick={() => onCreateReminder(group.client, openInvoices)}
              disabled={openInvoices.length === 0}
            >
              <Icons.Clock />
              Crear recordatorio
            </button>}
          </div>
        </div>

        <div className="pa-panel pa-credit-panel">
          <div className="pa-panel-stripe" />
          <div className="pa-panel-head pa-panel-head-results">
            <div>
              <span className="pa-section-kicker">Pendientes</span>
              <h2>Órdenes del cliente</h2>
            </div>
          </div>
          <div style={{ padding: "0 14px 14px" }}>
            <div className="pa-credit-detail-toolbar">
              <div className="pa-search-box acm-search">
                <Icons.Search />
                <input
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  placeholder="Buscar por referencia u orden..."
                />
                {detailSearch && (
                  <button className="acm-search-clear" onClick={() => setDetailSearch("")} aria-label="Limpiar búsqueda">
                    <Icons.X />
                  </button>
                )}
              </div>
              <select value={detailFilter} onChange={(e) => setDetailFilter(e.target.value)}>
                <option value="all">Todos</option>
                <option value="open">Pendientes</option>
                <option value="resolved">Resueltas</option>
              </select>
            </div>
          </div>
          <div className="ps-table-wrap pa-credit-invoice-wrap">
            <table className="ps-table acm-table">
              <thead>
                <tr>
                  <th className="pa-credit-check-cell">
                    <input
                      type="checkbox"
                      checked={allOpenSelected}
                      disabled={readOnly || openInvoices.length === 0}
                      onChange={() => onToggleAll(clientId, group.invoices)}
                      aria-label="Seleccionar pendientes"
                    />
                  </th>
                  <th>Referencia</th>
                  <th>Orden</th>
                  <th>Emision</th>
                  <th>Estado</th>
                  <th className="pa-credit-invoice-actions-col"></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="ps-table-empty">
                      <div className="acm-empty-state">
                        <Icons.Receipt />
                        <strong>No hay pendientes</strong>
                        <span>{detailSearch || detailFilter !== "all" ? "Intenta con otros filtros o limpia la búsqueda." : "No hay pendientes registrados para este cliente."}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedInvoices.map((item) => {
                    const itemOpen = isOpenCreditReceivable(item);
                    const selected = selectedIds.includes(item.order_id);
                    return (
                      <tr
                        key={item.id || item.order_id}
                        className="row-hover acm-client-row"
                        onClick={() => { if (item.order) onViewOrder(item.order); }}
                        onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); if (item.order) onViewOrder(item.order); } }}
                        tabIndex={0}
                      >
                        <td className="td-pad pa-credit-check-cell">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={readOnly || !itemOpen || !item.order_id}
                            onChange={() => onToggleSelection(clientId, item.order_id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Seleccionar pendiente ${item.invoiceNumber}`}
                          />
                        </td>
                        <td className="td-pad td-name">{item.invoiceNumber}</td>
                        <td className="td-pad td-id">{item.order_id?.slice(0, 8) || "---"}</td>
                        <td className="td-pad">{formatCreditDate(item.creditIssuedAt)}</td>
                        <td className="td-pad">
                          <span className={`acm-badge ${itemOpen ? "warning" : "success"}`}>
                            {getCreditReceivableStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="td-pad td-actions">
                          <div className="table-actions acm-row-actions">
                            {item.order && (
                              <button className="table-action-btn view" onClick={(e) => { e.stopPropagation(); onViewOrder(item.order); }} title="Ver orden">
                                <Icons.Eye />
                              </button>
                            )}
                            {!readOnly && itemOpen && (
                              <button
                                className="table-action-btn edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCreateReminder(group.client, [item]);
                                }}
                                title="Crear recordatorio"
                              >
                                <Icons.Clock />
                              </button>
                            )}
                            {!readOnly && itemOpen && (
                              <button
                                className="table-action-btn cancel"
                                onClick={(e) => { e.stopPropagation(); onSettle({
                                  client: group.client,
                                  orderIds: [item.order_id],
                                  invoices: [item.invoiceNumber],
                                  mode: "single",
                                }); }}
                                title="Marcar saldadas"
                              >
                                <Icons.Check />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredInvoices.length > CREDIT_DETAIL_PAGE_SIZE && (
            <div className="acm-pagination-footer">
              <Pagination currentPage={safeDetailPage} totalPages={detailTotalPages} onPageChange={setDetailPage} />
            </div>
          )}
          {!readOnly && <div className="pa-credit-detail-actions-bar">
            <span className="pa-credit-selection-count">
              {selectedIds.length} seleccionada{selectedIds.length === 1 ? "" : "s"}
            </span>
            <div className="pa-credit-detail-actions">
              <button
                className="pa-btn secondary pa-btn-sm"
                onClick={() => onToggleAll(clientId, group.invoices)}
                disabled={openInvoices.length === 0}
              >
                {allOpenSelected ? "Limpiar seleccion" : "Seleccionar pendientes"}
              </button>
              <button
                className="pa-btn primary pa-btn-sm"
                onClick={() => onSettle({
                  client: group.client,
                  orderIds: selectedIds,
                  invoices: group.invoices.filter((item) => selectedIds.includes(item.order_id)).map((item) => item.invoiceNumber),
                  mode: "selected",
                })}
                disabled={selectedIds.length === 0}
              >
                Marcar saldadas
              </button>
            </div>
          </div>}
        </div>
      </div>
    </section>
  );
}

function AdminTrackingLinkField({ orderId }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("orders")
      .select("tracking_token")
      .eq("id", orderId)
      .single()
      .then(({ data }) => {
        if (data?.tracking_token) setToken(data.tracking_token);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId]);

  const trackingUrl = token ? `${window.location.origin}/track/${token}` : null;

  const handleCopy = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = trackingUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
        <div style={{ width: 14, height: 14, border: "2px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Cargando...</span>
      </div>
    );
  }

  return (
    <div>
      {trackingUrl ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            readOnly
            value={trackingUrl}
            onClick={(e) => e.target.select()}
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-alt)",
              color: "var(--text)",
              outline: "none",
              cursor: "text",
            }}
          />
          <button
            onClick={handleCopy}
            style={{
              padding: "8px 14px",
              background: copied ? "#10B981" : "var(--primary)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.2s",
              fontFamily: "'Poppins', sans-serif",
            }}
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
          El link estará disponible cuando la orden tenga un token de seguimiento.
        </p>
      )}
    </div>
  );
}
