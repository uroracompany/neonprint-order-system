import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import CreateOrderModal from "../components/orders/CreateOrderModal";
import SharedEditOrderModal from "../components/orders/EditOrderModal";
import SharedOrderDetailModal from "../components/orders/OrderDetailModal";
import AdminAdvancedSettings from "../components/orders/AdminAdvancedSettings";
import AdminClientsModule from "../components/clients/AdminClientsModule";
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
  removeOrderAssetByPublicUrl,
  uploadOrderAsset,
} from "../utils/uploadOrderAsset";
import { Icons } from "../utils/icons";
import { StatusBadge, PaymentBadge, RoleBadge } from "../components/ui/Badge";
import { AssignModal } from "../components/ui/AssignModal";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import SettleCreditModal from "../components/ui/SettleCreditModal";
import {
  CreditCustomReminderDueModal,
  CreditReminderCreateModal,
} from "../components/ui/CreditReminderModals";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect, ClientSelect } from "../components/ui/ClientCombobox";
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
  resolveSellerId,
  ARCHIVE_MODULES,
} from "../utils/constants";
import {
  canArchiveOrder,
  archiveOrder,
} from "../utils/archive";
import { getReferenceImages } from "../utils/orderAssets";
import { formatDominicanPhone, getSelectedClientOrderFields, orderMatchesClientFilter, searchClients } from "../utils/clients";
import { adminApiFetch, isTimeoutError, FRIENDLY_TIMEOUT_MESSAGE } from "../utils/adminApi";
import { filterActiveNotifications, getActiveUnreadCount, showCreditActionFeedback } from "../utils/notifications";
import { useAuth } from "../hooks/useAuth";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";
import { FlowTracker, FlowTrackerExternal } from "../components/FlowTracker";
import useNotifications from "../hooks/useNotifications";
import { applyOrdersSnapshot } from "../utils/orderRealtime";
import NotificationCenter from "../components/NotificationCenter";
import FileCard from "../components/FileCard";
import "../css-components/page-seller.css";
import "../css-components/page-admin.css";


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
  item?.client_id && ["open", "partial"].includes(item.status)
));

const isOpenCreditReceivable = (item) => ["open", "partial"].includes(item?.status);
const formatCreditDate = (value) => (value ? formatDate(value) : "---");
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
    partial: "Pendiente",
    paid: "Saldada",
    void: "Anulada",
  };
  return labels[status] || status || "Pendiente";
};
const getCreditReceivableStatusStyle = (status) => {
  if (status === "paid") return { background: "#DCFCE7", color: "#166534", border: "1px solid #22C55E40" };
  if (status === "void") return { background: "#F1F5F9", color: "#475569", border: "1px solid #CBD5E140" };
  return { background: "#FEF3C7", color: "#92400E", border: "1px solid #F59E0B40" };
};

const resolveQuoteAssignmentId = (order) => QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).find(Boolean) || null;
const resolveAssignmentIdsByRole = (order, role) => {
  const normalizedRole = normalizeText(role);

  if (["seller", "admin"].includes(normalizedRole)) {
    return [resolveSellerId(order)].filter(Boolean);
  }

  if (normalizedRole === "designer") {
    return [order?.designer_id].filter(Boolean);
  }

  if (normalizedRole === "quote") {
    return QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).filter(Boolean);
  }

  const fallbackFields = [`${normalizedRole}_id`, `${normalizedRole}_user_id`, `assigned_${normalizedRole}_id`];
  return fallbackFields.map((field) => order?.[field]).filter(Boolean);
};
const orderMatchesProfileFilter = (order, profile) => {
  if (!profile?.id) return false;
  return resolveAssignmentIdsByRole(order, profile.role).includes(profile.id);
};
const getOrderSearchUserIds = (order) => [
  resolveSellerId(order),
  order?.designer_id,
  ...QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]),
  order?.printer_id,
].filter(Boolean);


// Genera nombres �nicos y legibles para los archivos que sube el administrador.
// Funci�n uploadOrderAsset importada desde ../utils/uploadOrderAsset.js
// Para usar: uploadOrderAsset({ bucket, path, file })

// Funciones para obtener informaci�n de los perfiles de usuario con l�gica de respaldo
// Funcion para obtener el nombre del usuario
const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";
// Normaliza el estado laboral a un booleano real para que la UI y la base hablen el mismo idioma.
const isEmploymentActive = (profile) => {
  const value = profile?.employment_status ?? profile?.employee_status ?? profile?.status;

  if (typeof value === "boolean") return value;

  const normalizedValue = normalizeText(value);
  return ["empleado", "contratado", "activo", "true"].includes(normalizedValue);
};

// Convierte el estado booleano a una etiqueta legible para mostrarla en la interfaz.
const getEmploymentStatus = (profile) => (isEmploymentActive(profile) ? "empleado" : "despedido");
const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Caja",
    admin: "Administrador",
    printer: "Producción",
    digital_producer: "Produccion Digital",
    dtf_producer: "Produccion DTF",
    ploteo_producer: "Produccion Ploteo",
    delivery: "Entrega"
  };
  return map[role] || role;
};

function ModalShell({ open, title, onClose, children, size = "default" }) {
  if (!open) return null;
  return (
    <div className="pa-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`pa-modal ${size}`}>
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
  const sellerId = resolveSellerId(order);
  const userName = getUserDisplayName(usersById[sellerId]);
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
                  <a href={preview} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                    <img
                      src={preview}
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
                  </a>
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
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {referenceImageUrls.map((url, index) => (
                      <a key={index} href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                        <img
                          src={url}
                          alt={`Ref ${index + 1}`}
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--border)",
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

// Modal de detalles de orden para el apartado de cr�dito (solo informacion, sin acciones)
function CreditOrderDetailModal({ open, order, usersById, onClose }) {
  if (!open || !order) return null;

  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      <OrderDetailInfo order={order} usersById={usersById} />
    </ModalShell>
  );
}

// Modal de asignaci�n de orden a usuario
// Versi�n enriquecida del formulario de �rdenes para admin, con la misma capacidad de carga
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
    if (fields.client_contact) fields.client_contact = formatDominicanPhone(fields.client_contact);

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
                  <img src={previewSource} alt="Preview de la orden" className="pa-preview-image" />
                  <div className="pa-preview-card-footer">
                    <div>
                      <strong>{orderForm.newPreview ? orderForm.newPreview.name : "Preview actual"}</strong>
                      <small>{orderForm.newPreview ? "Se reemplazar� al guardar" : "Archivo guardado"}</small>
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
function UserFormModal({ open, mode = "create", userForm, setUserForm, onClose, onSubmit, saving }) {
  const isEdit = mode === "edit";
  const passwordValue = userForm.password.trim();
  const confirmPasswordValue = userForm.confirmPassword.trim();
  const isPasswordReady = isEdit
    ? (!passwordValue && !confirmPasswordValue) || (passwordValue.length >= 6 && passwordValue === confirmPasswordValue)
    : passwordValue.length >= 6 && passwordValue === confirmPasswordValue;
  const isSubmitReady =
    userForm.name.trim() &&
    userForm.email.trim() &&
    userForm.role &&
    isPasswordReady;

  const roleDescriptions = {
    digital_producer: "Gestiona archivos de produccion digital.",
    dtf_producer: "Gestiona archivos de produccion DTF.",
    ploteo_producer: "Gestiona archivos de produccion ploteo.",
    seller: "Gestiona y da seguimiento comercial a las órdenes.",
    designer: "Recibe y trabaja los archivos asignados para producción.",
    quote: "Gestiona caja y valida la información de pago.",
    printer: "Gestiona producción, terminación e impresión.",
    delivery: "Coordina entregas y cierre logístico.",
    admin: "Supervisa módulos, usuarios y el flujo general del sistema.",
  };

  return (
    <ModalShell open={open} onClose={onClose} title={isEdit ? "Editar empleado" : "Crear usuario"} size="compact">
      <div className="pa-user-modal-intro">
        <div className="pa-user-modal-icon"><Icons.Users /></div>
        <div>
          <h4>{isEdit ? "Actualizar acceso del empleado" : "Nuevo miembro del sistema"}</h4>
          <p>{isEdit ? "Modifica la identidad, correo y permisos sin cambiar el estado laboral actual." : "Organiza primero la identidad del usuario y luego define su rol y estado inicial dentro del equipo."}</p>
        </div>
      </div>
      <div className="pa-user-modal-layout">
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Identidad</span>
            <h5>Información principal</h5>
          </div>
          <div className="pa-form-grid single">
            <label className="pa-field"><span>Nombre</span><input value={userForm.name} onChange={(e) => setUserForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ej. Maria Fernanda" autoComplete="name" /><small className="pa-field-help">Este nombre será visible en el sistema y se guardará también en autenticación.</small></label>
            <label className="pa-field"><span>Email</span><input type="email" value={userForm.email} onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))} placeholder="usuario@empresa.com" autoComplete="email" /><small className="pa-field-help">Usa un correo único para evitar conflictos de acceso.</small></label>
            <label className="pa-field"><span>{isEdit ? "Nueva contraseña" : "Contraseña"}</span><input type="password" value={userForm.password} onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))} placeholder={isEdit ? "Dejar vacío para no cambiar" : "Mínimo 6 caracteres"} autoComplete="new-password" /></label>
            <label className="pa-field"><span>Confirmar contraseña</span><input type="password" value={userForm.confirmPassword} onChange={(e) => setUserForm(prev => ({ ...prev, confirmPassword: e.target.value }))} placeholder={isEdit ? "Confirma solo si cambias contraseña" : "Repite la contraseña"} autoComplete="new-password" /></label>
          </div>
        </section>
        
        {/* Apartado para configurar los permisos y estados del usuario */}
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Acceso</span>
            <h5>Permisos y estado</h5>
          </div>
          <div className="pa-form-grid single">
            {/* Apartado para elegir el rol de usuario */}
            <label className="pa-field">
              <span>Rol</span>
              <select value={userForm.role} onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}>
                <option value="seller">Vendedor</option>
                <option value="designer">Diseñador</option>
                <option value="quote">Caja</option>
                <option value="printer">Produccion legacy</option>
                <option value="digital_producer">Produccion Digital</option>
                <option value="dtf_producer">Produccion DTF</option>
                <option value="ploteo_producer">Produccion Ploteo</option>
                <option value="delivery">Entrega</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <div className="pa-static-field">
              <span>Estado laboral</span>
              <div className="pa-static-value">{isEdit ? getEmploymentStatus(userForm) : "Empleado por defecto"}</div>
              <small className="pa-field-help">Acceso actual: {roleDescriptions[userForm.role]}</small>
            </div>
          </div>
          <div className="pa-user-modal-pills">
            <span className="pa-user-pill neutral">El rol define el acceso dentro del sistema.</span>
            <span className="pa-user-pill info">{isEdit ? "El estado laboral se administra con Activar/Desactivar." : "Se guardará como empleado activo (`employment_status = true`)."}</span>
          </div>
        </section>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving || !isSubmitReady}>{saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear usuario"}</button>
      </div>
    </ModalShell>
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
            <div><span>Responsable</span><strong>{getUserDisplayName(usersById[order.seller_id || order.created_by])}</strong></div>
            <div><span>Tipo</span><strong>{order.order_type || "No definido"}</strong></div>
            <div><span>Material</span><strong>{order.material || "No definido"}</strong></div>
            <div><span>Fecha</span><strong>{formatDate(order.created_at)}</strong></div>
          </div>
          <div className="pa-detail-description">{order.description || "Sin descripci�n"}</div>
        </div>
        <div className="pa-panel">
          <div className="pa-panel-title">Dise�os y caja</div>
          <div className="pa-detail-list">
            <div><span>Estado</span><strong><StatusBadge status={order.status} className="ps-badge" showDot bordered /></strong></div>
            <div><span>Pago</span><strong><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></strong></div>
            <div><span>Facturacion</span><strong>{order.invoice_number || "No definido"}</strong></div>
            <div><span>Precio</span><strong>{order.price ? `RD$${Number(order.price).toLocaleString("es-DO")}` : "Precio pendiente"}</strong></div>
            <div><span>Preview</span><strong>{order.preview_image ? <a href={order.preview_image} target="_blank" rel="noreferrer">Ver preview</a> : "Sin preview"}</strong></div>
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
            <div className="pa-empty-small">No hay dise�os cargados.</div>
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
    <ModalShell
      open={open}
      onClose={onClose}
      title={willActivate ? "Activar usuario" : "Desactivar usuario"}
      size="compact"
    >
      <div className="pa-confirm-modal-body">
        <div className={`pa-confirm-icon ${willActivate ? "activate" : "deactivate"}`}>
          {willActivate ? <Icons.Users /> : <Icons.Close />}
        </div>

        <div className="pa-confirm-copy">
          <h4>{pendingChange.userName}</h4>
          <p>
            {willActivate
              ? "Si confirmas esta acción, el usuario volverá a estar activo y podrá iniciar sesión."
              : "Si continúas, el usuario quedará inactivo y no podrá iniciar sesión hasta ser activado nuevamente."}
          </p>
        </div>
      </div>

      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button
          className={`pa-btn ${willActivate ? "primary" : "danger"}`}
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? "Guardando..." : willActivate ? "Activar usuario" : "Desactivar usuario"}
        </button>
      </div>
    </ModalShell>
  );
}

// Detalles del usuario
function UserDetailModal({ open, user, onClose, onEdit, onCreateOrder, onRequestEmploymentToggle, onShowFeedback }) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Estados de validaci�n
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
    } else if (newPassword.length < 6) {
      newErrors.newPassword = "Mínimo 6 caracteres";
      hasErrors = true;
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

    // Limpiar errores si todo est� bien
    setErrors({ newPassword: "", confirmPassword: "" });

    setChangingPassword(true);

    try {
      const { response, result } = await adminApiFetch("/api/change-user-password", { userId: user.id, newPassword });

      if (!response.ok) {
        onShowFeedback?.("error", `Error al cambiar la contrase�a: ${result.error}`);
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
                  Cambiar contrase�a
                </button>
              ) : (
                <div className="pa-password-form">
                  <label className="pa-field">
                    <span>Nueva contrase�a</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setErrors(prev => ({ ...prev, newPassword: "" })); }}
                      placeholder="M�nimo 6 caracteres"
                      className={errors.newPassword ? "pa-field-error" : ""}
                    />
                    {errors.newPassword && <small className="pa-field-help error">{errors.newPassword}</small>}
                  </label>
                  <label className="pa-field">
                    <span>Confirmar contrase�a</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: "" })); }}
                      placeholder="Repite la contrase�a"
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
            <details className="pa-user-more-menu">
              <summary aria-label="Más acciones"><Icons.Menu /></summary>
              <div>
                <button onClick={() => { onRequestEmploymentToggle(user); }}>
                  {isActive ? "Desactivar usuario" : "Activar usuario"}
                </button>
              </div>
            </details>
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
            <h3>Contrase�a cambiada correctamente</h3>
            <p>La contrase�a del usuario ha sido actualizada exitosamente.</p>
          </div>
        </div>
      )}
    </>
  );
}

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
  { color: "#06B6D4", bg: "#CFFAFE", glow: "#CFFAFE" },
  { color: "#EF4444", bg: "#FEE2E2", glow: "#FEE2E2" },
  { color: "#EC4899", bg: "#FCE7F3", glow: "#FCE7F3" },
  { color: "#6366F1", bg: "#E0E7FF", glow: "#E0E7FF" },
  { color: "#14B8A6", bg: "#CCFBF1", glow: "#CCFBF1" },
];

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
  const { user: authUser, profile: authProfile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(getInitialAdminSidebarOpen);
  const [activeTab, setActiveTab] = useState("overview");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
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
  const [deletingOrder, setDeletingOrder] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PER_PAGE = 7;
  const [dateFilter, setDateFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [interventionFilter, setInterventionFilter] = useState("all");
  const [operationalFilter, setOperationalFilter] = useState("all");
  const notif = useNotifications(user?.id);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  // userViewMode eliminado: solo vista tabla
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
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetailModalOpen, setUserDetailModalOpen] = useState(false);
  // Guarda la intenci�n de cambio hasta que el admin confirme la acci�n en el modal.
  const [employmentStatusConfirmOpen, setEmploymentStatusConfirmOpen] = useState(false);
  const [pendingEmploymentStatusChange, setPendingEmploymentStatusChange] = useState(null);
  const [savingEmploymentStatus, setSavingEmploymentStatus] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [materialFormName, setMaterialFormName] = useState("");
  const [materialFormError, setMaterialFormError] = useState("");
  const [deletingMaterialId, setDeletingMaterialId] = useState(null);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialsPage, setMaterialsPage] = useState(1);
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
  const [showClientModal, setShowClientModal] = useState(false);
  const [showOrderClientModal, setShowOrderClientModal] = useState(false);
  const [clientToSelectInOrderForm, setClientToSelectInOrderForm] = useState(null);
  const [clientFieldLocked, setClientFieldLocked] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState(DEFAULT_CLIENT_FORM);
  const [clientFormError, setClientFormError] = useState("");
  const [clientFormErrors, setClientFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deletingClientId, setDeletingClientId] = useState(null);

  const usersById = useMemo(() => Object.fromEntries(profiles.map(item => [item.id, item])), [profiles]);
  const adminVisibleNotifications = useMemo(() => filterActiveNotifications(notif.notifications), [notif.notifications]);
  const adminVisibleToasts = useMemo(() => filterActiveNotifications(notif.toasts), [notif.toasts]);
  const adminUnreadCount = useMemo(() => getActiveUnreadCount(adminVisibleNotifications), [adminVisibleNotifications]);
  const creditAlertPeriodKey = useMemo(() => getCreditAlertPeriodKey(), []);
  const minimumCreditReminderAt = useMemo(() => getMinimumCreditReminderAt(creditReminderNow), [creditReminderNow]);
  const showFeedback = (type, message) => setFeedback({ type, message, id: Date.now() });
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

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingOrders(true);
      setLoadOrdersError(null);
    }

    try {
      const { response, result } = await adminApiFetch("/api/admin-list-orders", { page: 1, pageSize: 1000 });

      if (!response.ok) {
        throw new Error(result?.error || "No se pudieron cargar ordenes.");
      }

      applyOrdersSnapshot({
        orders: result?.orders,
        setOrders,
        setSelectedOrder,
        openOrderSetters: [setSettingsOrder, setPaymentModalOrder],
        openOrderContainers: [{ setter: setAdvancedProduction }],
      });
      if (!silent) setLoadingOrders(false);
      return;
    } catch (error) {
      console.error("Error loading orders:", error);
      if (!silent) {
        setLoadOrdersError(error?.message || "No se pudieron cargar ordenes.");
        setOrders([]);
        setLoadingOrders(false);
      }
      return;
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    setLoadingUsers(true);
    setLoadUsersError(null);

    try {
      const { response, result } = await adminApiFetch("/api/admin-list-users", { page: 1, pageSize: 500 });

      if (!response.ok) {
        throw new Error(result?.error || "No se pudieron cargar usuarios.");
      }

      setProfiles(Array.isArray(result?.users) ? result.users : []);
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

  const fetchMaterials = async () => {
    setMaterialsLoading(true);
    try {
      const { data, error } = await supabase
        .from("materials")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      setMaterials(data || []);
    } catch (err) {
      console.error("Error fetching materials:", err);
    } finally {
      setMaterialsLoading(false);
    }
  };

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
        .select("*, client:clients(id,name,phone,email,address,notes,created_at,updated_at)")
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
        console.warn("No se pudieron cargar recordatorios de cr�dito:", error?.message || error);
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

  useEffect(() => {
    if (!user?.id) return undefined;

    const refreshReminderClock = async () => {
      await syncCreditReminderServerTime();
      await dispatchDueCreditReminderNotifications();
      fetchCreditCustomReminders();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshReminderClock();
      }
    };

    window.addEventListener("focus", refreshReminderClock);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshReminderClock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dispatchDueCreditReminderNotifications, fetchCreditCustomReminders, syncCreditReminderServerTime, user?.id]);

  useEffect(() => {
    if (!authUser?.id) return undefined;

    loadOrders();
    loadProfiles();
    fetchClients();
    fetchAccountsReceivable();
    dispatchDueCreditReminderNotifications();
    fetchCreditCustomReminders();

    const relatedDataChannel = supabase
      .channel(`admin-related-data-${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts_receivable' }, () => {
        loadOrders(true);
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
  }, [authUser?.id, dispatchDueCreditReminderNotifications, fetchAccountsReceivable, fetchClients, fetchCreditCustomReminders, loadOrders, loadProfiles]);

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
        setActiveTab("credits");
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
    if (activeTab === "clients" || activeTab === "orders" || activeTab === "credits") {
      fetchClients();
      fetchAccountsReceivable();
      fetchCreditCustomReminders();
    }
  }, [activeTab, fetchAccountsReceivable, fetchClients, fetchCreditCustomReminders]);

  useEffect(() => {
    fetchCreditCustomReminders();
  }, [fetchCreditCustomReminders]);

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

    // Subir nuevos archivos de dise�o
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

    // Si se elimin� el preview existente
    if (orderForm.removePreview || (!orderForm.newPreview && orderForm.existingPreview && orderForm.removePreview)) {
      finalPreviewUrl = null;
    }

    // Eliminar archivos removidos
    const remainingFiles = finalFileUrls.filter(url => !orderForm.removedFiles.includes(url));

    payload.preview_image = finalPreviewUrl;
    payload.order_file_url = remainingFiles.length > 0 ? serializeFileUrls(remainingFiles) : null;

    // Determinar si es create o edit
    const isCreate = orderModalMode === "create";
    const orderId = orderForm.id;

    let error;
    if (isCreate) {
      const { error: insertError } = await supabase.from("orders").insert([payload]).select().single();
      error = insertError;
    } else {
      const { error: updateError } = await supabase.from("orders").update(payload).eq("id", orderId);
      error = updateError;
    }

    setSavingOrder(false);

    if (error) return showFeedback("error", isTimeoutError(error) ? FRIENDLY_TIMEOUT_MESSAGE : `No se pudo guardar la orden: ${error.message}`);

    await Promise.all([
      ...orderForm.removedFiles.map((url) => removeOrderAssetByPublicUrl({ bucket: "order-docs", url })),
      orderForm.removePreview && orderForm.existingPreview
        ? removeOrderAssetByPublicUrl({ bucket: "order-previews", url: orderForm.existingPreview })
        : Promise.resolve({ removed: false, error: null }),
    ]);

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
  };

  const handleConfirmCancelOrder = async () => {
    if (!cancelOrderData) return;
    if (cancelReason.trim().length < 10) {
      showFeedback("error", "Explica el motivo de cancelaci�n con al menos 10 caracteres.");
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
      showFeedback("error", "Solo se pueden archivar �rdenes canceladas, completadas o entregadas.");
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

  const handleConfirmDeleteOrder = async () => {
    if (!deletingOrder?.id) return;
    setDeleteLoading(true);

    const { response, result } = await adminApiFetch("/api/admin-delete-order", {
      orderId: deletingOrder.id,
    });

    setDeleteLoading(false);

    if (!response.ok) {
      return showFeedback("error", result?.error || "No se pudo eliminar la orden y sus archivos.");
    }

    if (selectedOrder?.id === deletingOrder.id) setSelectedOrder(null);
    setDeletingOrder(null);
    await loadOrders();
    showFeedback("success", "La orden y sus archivos fueron eliminados correctamente.");
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
        payload: { target_user_id: userId },
        reasonCategory: "assignment_correction",
        reasonDetail: "Asignaci�n realizada por Administraci�n desde el detalle de la orden.",
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
    showFeedback("success", `Orden asignada a ${isDesigner ? "dise�ador" : "caja"} correctamente.`);
  };

  const openPaymentModal = (order) => {
    setPaymentModalOrder(order);
  };

  const handlePaymentConfirm = async ({ paymentStatus, receiptFile }) => {
    const currentOrder = paymentModalOrder;
    if (!currentOrder) return;

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      setPaymentModalLoading(true);
      const { error } = await supabase.rpc("mark_order_as_credit", {
        p_order_id: currentOrder.id,
        p_due_date: null,
      });
      setPaymentModalLoading(false);

      if (error) {
        throw new Error(error.message || "No se pudo aprobar el cr�dito.");
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
        throw new Error(validation.error || "La imagen no es v�lida.");
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
        payload: { payment_status: paymentStatus, invoice_payment: paymentInvoiceUrl },
        reasonCategory: "workflow_correction",
        reasonDetail: "Pago registrado por Administraci�n desde el listado de �rdenes.",
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
    setUserModalOpen(true);
  };

  const openEditUserModal = (profileItem) => {
    setUserModalMode("edit");
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
  };

  // Funcionalidad para registrar usuarios
  const handleCreateUser = async () => {
    const trimmedName = userForm.name.trim();
    const trimmedEmail = userForm.email.trim().toLowerCase();
    const trimmedPassword = userForm.password.trim();
    const trimmedConfirmPassword = userForm.confirmPassword.trim();

    if (!trimmedName || !trimmedEmail || !userForm.role) {
      return showFeedback("error", "Nombre, email y rol son obligatorios.");
    }

    if (!trimmedPassword || trimmedPassword.length < 6) {
      return showFeedback("error", "La contraseña debe tener al menos 6 caracteres.");
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      return showFeedback("error", "Las contraseñas no coinciden.");
    }

    setSavingUser(true);
    let response;
    let result;
    try {
      ({ response, result } = await adminApiFetch("/api/admin-create-user", {
          name: trimmedName,
          email: trimmedEmail,
          password: trimmedPassword,
          role: userForm.role,
        }));
    } catch (err) {
      setSavingUser(false);
      return showFeedback("error", isTimeoutError(err) ? FRIENDLY_TIMEOUT_MESSAGE : "No se pudo conectar con el servicio de creación de usuarios.");
    }

    setSavingUser(false);

    if (!response.ok) {
      return showFeedback("error", result?.error || "No se pudo crear el usuario.");
    }

    closeUserModal();
    await loadProfiles();
    showFeedback("success", result?.message || "Usuario creado correctamente en autenticación y profiles.");

  };

  const handleUpdateUser = async () => {
    if (!selectedUser?.id) {
      return showFeedback("error", "Selecciona un empleado para editar.");
    }

    const trimmedName = userForm.name.trim();
    const trimmedEmail = userForm.email.trim().toLowerCase();
    const trimmedPassword = userForm.password.trim();
    const trimmedConfirmPassword = userForm.confirmPassword.trim();

    if (!trimmedName || !trimmedEmail || !userForm.role) {
      return showFeedback("error", "Nombre, email y rol son obligatorios.");
    }

    if ((trimmedPassword || trimmedConfirmPassword) && trimmedPassword.length < 6) {
      return showFeedback("error", "La contraseña debe tener al menos 6 caracteres.");
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      return showFeedback("error", "Las contraseñas no coinciden.");
    }

    setSavingUser(true);
    let response;
    let result;
    try {
      ({ response, result } = await adminApiFetch("/api/admin-update-user", {
          userId: selectedUser.id,
          name: trimmedName,
          email: trimmedEmail,
          password: trimmedPassword || undefined,
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
    showFeedback("success", result?.message || "Empleado actualizado correctamente.");
  };

  const handleSaveUser = () => (
    userModalMode === "edit" ? handleUpdateUser() : handleCreateUser()
  );

  // Prepara el cambio de estado, pero no actualiza la base hasta que el admin confirme.
  const openEmploymentStatusConfirm = (profile) => {
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
  const handleEmploymentStatusChange = async (profileId, nextStatus) => {
    setSavingEmploymentStatus(true);
    let response;
    let result;

    try {
      ({ response, result } = await adminApiFetch("/api/admin-set-user-status", {
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
    showFeedback(
      "success",
      nextStatus ? "Usuario activado correctamente." : "Usuario desactivado correctamente."
    );
  };

  // Si el admin confirma, reci�n aqu� se persiste el cambio.
  const confirmEmploymentStatusChange = async () => {
    if (!pendingEmploymentStatusChange) return;

    await handleEmploymentStatusChange(
      pendingEmploymentStatusChange.userId,
      pendingEmploymentStatusChange.nextStatus
    );

    closeEmploymentStatusConfirm();
  };

  const handleAddMaterial = () => {
    setEditingMaterial(null);
    setMaterialFormName("");
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleEditMaterial = (mat) => {
    setEditingMaterial(mat);
    setMaterialFormName(mat.name);
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleSaveMaterial = async () => {
    const name = materialFormName.trim();
    if (!name || name.length < 2) {
      setMaterialFormError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    try {
      if (editingMaterial) {
        const { error } = await supabase
          .from("materials")
          .update({ name, updated_at: new Date().toISOString() })
          .eq("id", editingMaterial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("materials")
          .insert({ name });
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

  const handleDeleteMaterial = async (id) => {
    if (deletingMaterialId === id) {
      try {
        const { error } = await supabase.from("materials").delete().eq("id", id);
        if (error) throw error;
        setDeletingMaterialId(null);
        fetchMaterials();
      } catch (err) {
        console.error("Error deleting material:", err);
      }
    } else {
      setDeletingMaterialId(id);
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
    setActiveTab("orders");
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
    const payload = {
      name: clientForm.name.trim(),
      phone: clientForm.phone.trim(),
      email: clientForm.email.trim() || null,
      address: clientForm.address.trim() || null,
      notes: clientForm.notes.trim() || null,
    };

    const nextErrors = {};

    if (!payload.name) {
      nextErrors.name = "Escribe el nombre del cliente.";
    } else if (payload.name.length < 2) {
      nextErrors.name = "El nombre debe tener al menos 2 caracteres.";
    }

    if (!payload.phone) {
      nextErrors.phone = "Escribe el número de teléfono del cliente.";
    } else if (phone.length < 3) {
      nextErrors.phone = "El teléfono debe tener al menos 3 caracteres.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setClientFormErrors(nextErrors);
      setClientFormError("Completa los campos obligatorios para guardar el cliente.");
      return;
    }

    setClientFormErrors({});
    setSaving(true);

    try {
      if (editingClient) {
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", editingClient.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("clients")
          .insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
      }

      setShowClientModal(false);
      setEditingClient(null);
      setClientForm(DEFAULT_CLIENT_FORM);
      setClientFormErrors({});
      await fetchClients();
      notif.showActionNotification({
        type: "success",
        title: editingClient ? "Cliente actualizado" : "Cliente registrado",
        message: `Cliente "${clientForm.name.trim()}" ${editingClient ? "actualizado" : "creado"} correctamente.`,
      });
    } catch (err) {
      setClientFormError(err.message || "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClient = async (id) => {
    if (deletingClientId === id) {
      try {
        const { error } = await supabase.from("clients").delete().eq("id", id);
        if (error) throw error;
        setDeletingClientId(null);
        await fetchClients();
        await loadOrders();
        showFeedback("success", "Cliente eliminado correctamente.");
        return true;
      } catch (err) {
        setClientFormError(err.message || "No se pudo eliminar el cliente.");
        showFeedback("error", "No se pudo eliminar el cliente.");
        return false;
      }
    } else {
      setDeletingClientId(id);
      return false;
    }
  };

  const handleManageClientCredit = (clientId) => {
    setActiveTab("credits");
    setCreditStatusFilter("all");
    setCreditDetailClientId(clientId);
    setCreditView("detail");
  };

  const handleOpenCreditSettleAll = (client, openInvoices) => {
    const orderIds = openInvoices.map((item) => item.order_id);
    const invoices = openInvoices.map((item) => item.invoiceNumber);
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];
    if (uniqueOrderIds.length === 0) {
      showFeedback("error", "No hay facturas pendientes para cerrar.");
      return;
    }
    setCreditSettleAllTarget({ client, orderIds: uniqueOrderIds, invoices: [...new Set((invoices || []).filter(Boolean))] });
    setCreditSettleAllNotes("");
  };

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
      showFeedback("error", "No hay facturas pendientes para cerrar.");
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
      showFeedback("error", "No hay créditos pendientes para cerrar.");
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
      showFeedback("error", error.message || "No se pudo registrar el cierre del cr�dito.");
      return false;
    }

    await Promise.all([loadOrders(true), fetchAccountsReceivable()]);
    if (onSuccess) onSuccess();
    showFeedback("success", uniqueOrderIds.length === 1 ? "Factura marcada como saldada correctamente." : "Facturas marcadas como saldadas correctamente.");
    return true;
  };

  const handleRecordClientPayment = async () => {
    if (!recordPaymentClient?.id) return;
    const orderIds = receivablesByClient[recordPaymentClient.id]?.orderIds || [];
    if (orderIds.length === 0) {
      showFeedback("error", "El cliente no tiene créditos pendientes para cerrar.");
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
    setActiveTab("credits");
    setCreditStatusFilter("open");
    if (reminder.client_id) {
      setCreditDetailClientId(reminder.client_id);
      setCreditView("detail");
    } else {
      setCreditView("list");
    }
  };

  // Funcionalidad de filtros 
  const filteredOrders = useMemo(() => {
    const q = normalizeText(search);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    const selectedProfile = ownerFilter === "all" ? null : usersById[ownerFilter];

    return orders.filter(order => {
      const relatedUserNames = [...new Set(getOrderSearchUserIds(order))]
        .map((userId) => getUserDisplayName(usersById[userId]));
      const matchesSearch = !q || [order.client_name, order.description, order.material, order.invoice_number, order.id, ...relatedUserNames].some(value => normalizeText(value).includes(q));
      const matchesStatus = statusFilter === "all" || isOrderStatus(order.status, statusFilter);
      const matchesOwner = ownerFilter === "all" || orderMatchesProfileFilter(order, selectedProfile);
      const matchesClient = orderMatchesClientFilter(order, clientFilter);
      const matchesArchive = archiveFilter === "all"
        || (archiveFilter === "active" && !order.is_archived_admin)
        || (archiveFilter === "archived" && order.is_archived_admin);
      const createdAt = new Date(order.created_at);
      const matchesDate = dateFilter === "all" || (dateFilter === "today" && createdAt >= startOfToday) || (dateFilter === "week" && createdAt >= startOfWeek);
      const matchesIntervention = interventionFilter === "all"
        || (interventionFilter === "intervened" && Boolean(order.last_admin_intervention_at))
        || (interventionFilter === "not_intervened" && !order.last_admin_intervention_at);
      const matchesOperational = operationalFilter === "all"
        || (operationalFilter === "blocked" && order.operational_status === "blocked")
        || (operationalFilter === "priority" && order.order_type === "orden 911")
        || (operationalFilter === "commercial_review" && order.commercial_review_required);
      return matchesSearch && matchesStatus && matchesOwner && matchesClient && matchesArchive && matchesDate && matchesIntervention && matchesOperational;
    });
  }, [orders, search, statusFilter, ownerFilter, clientFilter, archiveFilter, dateFilter, interventionFilter, operationalFilter, usersById]);

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const receivablesByClient = useMemo(() => {
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
  }, [accountsReceivable]);

  const receivablesTotal = useMemo(() => (
    Object.values(receivablesByClient).reduce((sum, item) => sum + item.count, 0)
  ), [receivablesByClient]);

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

  const dueCreditCustomReminders = useMemo(() => {
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
  }, [creditCustomReminderRows, creditReminderDismissedIds, creditReminderNow]);

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

  useEffect(() => {
    if (!selectedOrder?.id) return;
    const freshOrder = ordersById[selectedOrder.id];
    if (freshOrder && freshOrder !== selectedOrder) {
      setSelectedOrder(freshOrder);
    }
  }, [ordersById, selectedOrder]);

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
      return matchesSearch && matchesRole;
    });
  }, [profiles, userSearch, roleFilter]);

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
    return q ? materials.filter(mat => normalizeText(mat.name).includes(q)) : materials;
  }, [materials, materialSearch]);

  const MATERIALS_PER_PAGE = 20;
  const totalMaterialPages = Math.ceil(filteredMaterials.length / MATERIALS_PER_PAGE) || 1;
  const safeMaterialPage = Math.min(materialsPage, totalMaterialPages);
  const paginatedMaterials = filteredMaterials.slice((safeMaterialPage - 1) * MATERIALS_PER_PAGE, safeMaterialPage * MATERIALS_PER_PAGE);

  useEffect(() => { setMaterialsPage(1); }, [filteredMaterials.length]);

  const metrics = [
    { label: "Órdenes totales", value: orders.length, icon: <Icons.Orders />, accentIdx: 0 },
    { label: "Caja", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)).length, icon: <Icons.Money />, accentIdx: 5 },
    { label: "En diseño", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_DESIGN)).length, icon: <Icons.File />, accentIdx: 2 },
    { label: "Usuarios", value: profiles.length, icon: <Icons.Users />, accentIdx: 3 },
    { label: "Pendientes", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.PENDING)).length, icon: <Icons.Clock />, accentIdx: 1 },
    { label: "En producción", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)).length, icon: <Icons.Brush />, accentIdx: 6 },
    { label: "En terminación", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)).length, icon: <Icons.Paintbrush />, accentIdx: 7 },
    { label: "En entrega", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED)).length, icon: <Icons.Truck />, accentIdx: 8 },
    { label: "Completadas", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)).length, icon: <Icons.Check />, accentIdx: 4 },
    { label: "Clientes Registrados", value: clients.length, icon: <Icons.User />, accentIdx: 9 },
    { label: "Crédito pendiente", value: receivablesTotal, icon: <Icons.Money />, accentIdx: 5 },
    { label: "Bloqueadas", value: orders.filter(order => order.operational_status === "blocked").length, icon: <Icons.AlertCircle />, accentIdx: 1 },
    { label: "Revisión comercial", value: orders.filter(order => order.commercial_review_required).length, icon: <Icons.Receipt />, accentIdx: 2 },
  ];

  const typeMetrics = [
    { label: "Órdenes normales", value: orders.filter(order => order.order_type !== "orden 911").length },
    { label: "Órdenes 911", value: orders.filter(order => order.order_type === "orden 911").length },
    { label: "Pendientes (Ventas)", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.PENDING)).length },
    { label: "En diseño", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_DESIGN)).length },
    { label: "En caja", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)).length },
    { label: "En producción", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_PRODUCTION)).length },
    { label: "En terminación", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_TERMINATION)).length },
    { label: "En entrega", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED)).length },
    { label: "Completadas", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)).length },
    { label: "Canceladas", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.CANCELLED)).length },
    { label: "Archivadas", value: orders.filter(order => order.is_archived_admin).length },
  ];

  const getSidebarBadge = (loading, value) => (loading ? "..." : value);

  const menuItems = [
    { id: "overview", label: "Resumen", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Órdenes", icon: <Icons.Orders />, badge: getSidebarBadge(loadingOrders, orders.length) },
    { id: "credits", label: "Créditos", icon: <Icons.Receipt />, badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount) },
    { id: "clients", label: "Clientes", icon: <Icons.User />, badge: getSidebarBadge(clientsLoading, clientsTotal) },
    { id: "materials", label: "Materiales", icon: <Icons.Package /> },
    { id: "users", label: "Usuarios", icon: <Icons.Users />, badge: getSidebarBadge(loadingUsers, profiles.length) },
  ];

  const handleAdminTabChange = (nextTab) => {
    setActiveTab(nextTab);
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
      <Sidebar isOpen={sidebarOpen} activeTab={activeTab} onTabChange={handleAdminTabChange} role="Admin" userName={getUserDisplayName(profile)} menuItems={menuItems} onLogout={handleLogout} onCreateNew={openCreateOrder} showCreateButton />
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
            <div><span className="pa-kicker">Administrador</span><h1>{activeTab === "overview" ? "Panel General" : activeTab === "orders" ? "Gestión de Órdenes" : activeTab === "credits" ? "Gestión de Créditos" : activeTab === "clients" ? "Gestión de clientes" : activeTab === "materials" ? "Gestión de Materiales" : "Gestión de usuarios"}</h1></div>
          </div>
          <div className="pa-header-right">
            {feedback && <div className={`pa-feedback ${feedback.type}`}>{feedback.message}</div>}
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

        {activeTab === "overview" &&
          <section className="pa-section">
            <div className="pa-metrics-grid">
              {metrics.map((metric) => {
                const acc = CARD_ACCENTS[metric.accentIdx];
                return (
                  <article key={metric.label} className="pa-metric-card"
                    onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
                    <div className="pa-metric-glow" style={{ background: acc.glow }} />
                    <div className="pa-metric-icon" style={{ background: acc.bg, color: acc.color }}>
                      {metric.icon}
                    </div>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </article>
                );
              })}
            </div>
            {creditPendingInvoicesCount > 0 && (
              <div className="pa-credit-dashboard-alert" role="status">
                <span className="pa-credit-dashboard-alert-icon"><Icons.Receipt /></span>
                <div>
                  <span className="pa-section-kicker">Créditos pendientes</span>
                  <strong>{creditPendingInvoicesCount} factura{creditPendingInvoicesCount === 1 ? "" : "s"} a crédito pendiente{creditPendingInvoicesCount === 1 ? "" : "s"}</strong>
                  <p>{creditPendingClientCount} cliente{creditPendingClientCount === 1 ? "" : "s"} requiere{creditPendingClientCount === 1 ? "" : "n"} seguimiento administrativo.</p>
                </div>
                <button className="pa-btn primary pa-btn-sm" onClick={() => { setActiveTab("credits"); setCreditStatusFilter("open"); setCreditView("list"); }}>
                  Revisar créditos pendientes
                </button>
              </div>
            )}
            <div className="pa-two-col">
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-stripe" />
                <div className="pa-panel-head">
                  <div>
                    <span className="pa-section-kicker">
                      Monitoreo
                    </span>
                    <h2>
                      Estado del sistema
                    </h2>
                  </div>
                </div>
                <div className="pa-panel-body">
                  <div className="pa-stats-list">
                    {typeMetrics.map(item => <div key={item.label} className="pa-stat-row">
                      <span>
                        {item.label}
                      </span>
                      <strong>
                        {item.value}
                      </strong></div>)
                    }
                  </div>
                </div>
              </div>
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-stripe" />
                <div className="pa-panel-head">
                  <div>
                    <span className="pa-section-kicker">
                      Actividad reciente
                    </span>
                    <h2>
                      órdenes más recientes
                    </h2>
                  </div>
                </div>
                <div className="pa-panel-body">
                  <div className="pa-recent-list">
                    {orders.slice(0, 5).map(order =>
                      <button key={order.id} className="pa-recent-item" onClick={() => setSelectedOrder(order)}>
                        <div>
                          <strong>
                            {order.client_name || "Cliente sin nombre"}
                          </strong>
                          <span>
                            {getUserDisplayName(usersById[order.seller_id || order.created_by])}
                          </span>
                        </div>
                        <div className="pa-recent-meta">
                          <StatusBadge status={order.status} className="ps-badge" showDot bordered />
                          <span>
                            {formatDate(order.created_at)}
                          </span>
                        </div>
                      </button>)}
                  </div>
                </div>
              </div>
            </div>
          </section>
        }

        {activeTab === "orders" && !advancedSettingsOpen &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-orders">
              <div className="pa-toolbar-orders-primary">
                <div className="pa-search-box pa-toolbar-search pa-orders-search">
                  <Icons.Search />
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar por cliente, facturacion, descripcion, material o usuario..." />
                </div>
                <button className="pa-btn primary pa-toolbar-create" onClick={openCreateOrder}><Icons.Plus />
                  Nueva orden
                </button>
              </div>
              <div className="pa-toolbar-filter-row" aria-label="Filtros de órdenes">
                <select className="pa-order-filter-control" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                  <option value="all">Todos los estados</option>
                  {STATUS_OPTIONS.map(status => <option key={status} value={status}>{STATUS_LABELS[status] || status}</option>)}
                </select>
                <select className="pa-order-filter-control" value={dateFilter} onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}>
                  <option value="all">Todas las fechas</option>
                  <option value="today">Hoy</option>
                  <option value="week">Últimos 7 días</option>
                </select>
                <select className="pa-order-filter-control" value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }}>
                  <option value="all">Todos los usuarios</option>
                  {profiles.map(item =>
                    <option key={item.id} value={item.id}>
                      {getUserDisplayName(item)}
                    </option>
                  )}
                </select>
                <ClientFilterSelect
                  clients={clients}
                  value={clientFilter}
                  onChange={(value) => { setClientFilter(value); setPage(1); }}
                  allLabel="Todos los clientes"
                  className="pa-order-filter-control"
                />
                <select className="pa-order-filter-control" value={archiveFilter} onChange={(e) => { setArchiveFilter(e.target.value); setPage(1); }}>
                  <option value="active">Activas</option>
                  <option value="all">Todas</option>
                  <option value="archived">Archivadas</option>
                </select>
                <select className="pa-order-filter-control pa-order-filter-control-wide" value={interventionFilter} onChange={(e) => { setInterventionFilter(e.target.value); setPage(1); }}>
                  <option value="all">Todas las intervenciones</option>
                  <option value="intervened">Intervenidas por Admin</option>
                  <option value="not_intervened">Sin intervención avanzada</option>
                </select>
                <select className="pa-order-filter-control pa-order-filter-control-wide" value={operationalFilter} onChange={(event) => { setOperationalFilter(event.target.value); setPage(1); }}>
                  <option value="all">Toda la situación operativa</option>
                  <option value="blocked">Bloqueadas</option>
                  <option value="priority">Prioridad 911</option>
                  <option value="commercial_review">Revisión comercial pendiente</option>
                </select>
              </div>
            </div>
            <div className="pa-panel pa-orders-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <span className="pa-section-kicker">
                    Supervisión
                  </span>
                  <h2>
                    Órdenes del sistema
                  </h2>
                </div>
                <span className="pa-results-count">
                  {filteredOrders.length} resultados
                </span>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table pa-orders-table">
                  <colgroup>
                    <col className="pa-order-col-id" />
                    <col className="pa-order-col-client" />
                    <col className="pa-order-col-invoice" />
                    <col className="pa-order-col-description" />
                    <col className="pa-order-col-material" />
                    <col className="pa-order-col-status" />
                    <col className="pa-order-col-payment" />
                    <col className="pa-order-col-type" />
                    <col className="pa-order-col-date" />
                    <col className="pa-order-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      {["ID", "Cliente", "Facturación", "Descripción", "Material", "Estado", "Pago", "Tipo", "Fecha", "Acciones"].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingOrders ? <tr><td colSpan={10} className="ps-table-empty">Cargando órdenes...</td></tr> : loadOrdersError ? <tr><td colSpan={10} className="ps-table-empty">{loadOrdersError}</td></tr> : filteredOrders.length === 0 ? <tr><td colSpan={10} className="ps-table-empty">No hay órdenes disponibles.</td></tr> : paginatedOrders.map(order =>
                          <tr
                            key={order.id}
                            className="row-hover pa-orders-clickable-row"
                            tabIndex={0}
                            onClick={(event) => handleOrderRowClick(event, order)}
                            onKeyDown={(event) => handleOrderRowKeyDown(event, order)}
                            aria-label={`Ver detalles de la orden ${order.id?.slice(0, 8) || ""} de ${order.client_name || "cliente sin nombre"}`}
                          >
                            <td className="td-pad td-id">{order.id?.slice(0, 8) || "---"}</td>
                            <td className="td-pad td-name" title={order.client_name || "Sin cliente"}>{order.client_name || "Sin cliente"}</td>
                            <td className="td-pad" title={order.invoice_number || "---"}>
                              <span className="pa-order-cell-ellipsis">{order.invoice_number || "---"}</span>
                            </td>
                            <td className="td-pad td-desc" title={order.description || "Sin descripción"}>
                              <span className="pa-order-cell-ellipsis">{order.description || "Sin descripción"}</span>
                            </td>
                            <td className="td-pad td-mat" title={order.material || "---"}>
                              <span className="pa-order-cell-ellipsis">{order.material || "---"}</span>
                            </td>
                            <td className="td-pad"><StatusBadge status={order.status} className="ps-badge" showDot bordered />{order.operational_status === "blocked" ? <span className="pa-order-flag is-blocked">Bloqueada</span> : null}{order.commercial_review_required ? <span className="pa-order-flag is-review">Revisión</span> : null}</td>
                            <td className="td-pad"><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></td>
                            <td className="td-pad">
                              {order.order_type === "orden 911" ? (
                                <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #EF444420" }}>911</span>
                              ) : (
                                <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>Normal</span>
                              )}
                            </td>
                            <td className="td-pad td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="td-pad td-actions">
                              <div className="table-actions" data-row-action>
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
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
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
            <div className="pa-toolbar">
              <div className="pa-search-box pa-toolbar-search">
                <Icons.Search />
                <input
                  value={creditSearch}
                  onChange={(event) => setCreditSearch(event.target.value)}
                  placeholder="Buscar por cliente, telefono, factura u orden..."
                />
              </div>
              <select value={creditStatusFilter} onChange={(event) => setCreditStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="open">Pendientes</option>
                <option value="paid">Saldadas</option>
              </select>
            </div>

            <div className="pa-credit-metrics" aria-label="Resumen de cr�ditos">
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
              <div className="pa-credit-pending-banner" role="status">
                <span className="pa-credit-pending-banner-icon"><Icons.AlertCircle /></span>
                <div>
                  <strong>{creditPendingInvoicesCount} factura{creditPendingInvoicesCount === 1 ? "" : "s"} a crédito pendiente{creditPendingInvoicesCount === 1 ? "" : "s"}</strong>
                  <span>{creditPendingClientCount} cliente{creditPendingClientCount === 1 ? "" : "s"} requiere{creditPendingClientCount === 1 ? "" : "n"} seguimiento administrativo.</span>
                </div>
                <button className="pa-btn secondary pa-btn-sm" onClick={() => setCreditStatusFilter("open")}>
                  Revisar créditos pendientes
                </button>
              </div>
            )}

            <div className="pa-panel pa-credit-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <span className="pa-section-kicker">Seguimiento</span>
                  <h2>Créditos agrupados por cliente</h2>
                </div>
                <span className="pa-results-count">
                  {creditClientGroups.length} cliente{creditClientGroups.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Facturas</th>
                      <th>Fechas</th>
                      <th>Estado</th>
                      <th className="pa-credit-actions-col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditClientGroups.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="ps-table-empty">No hay cr�ditos que coincidan con los filtros.</td>
                      </tr>
                    ) : (
                      creditClientGroups.map(group => {
                        const clientId = group.client?.id;
                        const openInvoices = group.invoices.filter(item => isOpenCreditReceivable(item));
                        return (
                          <tr key={clientId} className="row-hover pa-credit-client-row" style={{ cursor: "pointer" }} onClick={() => { setCreditDetailClientId(clientId); setCreditView("detail"); }}>
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
                                <span className="ps-badge" style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #F59E0B40" }}>
                                  {group.pendingCount} factura{group.pendingCount === 1 ? "" : "s"}
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
                              <span className="ps-badge" style={group.pendingCount > 0 ? getCreditReceivableStatusStyle("open") : getCreditReceivableStatusStyle("paid")}>
                                {group.pendingCount > 0 ? "Con saldo pendiente" : "Sin pendientes"}
                              </span>
                            </td>
                            <td className="td-pad td-actions pa-credit-row-actions" onClick={(event) => event.stopPropagation()}>
                              <div className="table-actions">
                                <button
                                  className="table-action-btn view"
                                  onClick={() => { setCreditDetailClientId(clientId); setCreditView("detail"); }}
                                  title="Ver facturas del cliente"
                                >
                                  <Icons.Eye />
                                </button>
                                {openInvoices.length > 0 && (
                                  <button
                                    className="table-action-btn"
                                    onClick={() => openCreditReminderModal(group.client, openInvoices)}
                                    title="Crear recordatorio"
                                  >
                                    <Icons.Clock />
                                  </button>
                                )}
                                {openInvoices.length > 0 && (
                                  <button
                                    className="table-action-btn"
                                    onClick={() => handleOpenCreditSettleAll(group.client, openInvoices)}
                                    title="Marcar todas como saldadas"
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
          />
        )}

        {activeTab === "clients" && (
          <AdminClientsModule
            supabase={supabase}
            refreshKey={clientDirectoryRefreshKey}
            deletingClientId={deletingClientId}
            onAddClient={handleAddClient}
            onEditClient={handleEditClient}
            onDeleteClient={handleDeleteClient}
            onCreateOrder={openCreateOrderFromClient}
            onViewOrders={(clientId) => handleClientClick({ id: clientId })}
            onManageCredit={handleManageClientCredit}
          />
        )}

        <ModalShell open={!!recordPaymentClient} onClose={() => setRecordPaymentClient(null)} title="Marcar cr�dito saldado" size="compact">
          <div style={{ minWidth: 320 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
              {recordPaymentClient?.name}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>
              Facturas pendientes: {receivablesByClient[recordPaymentClient?.id]?.count || 0}
            </p>

            {(receivablesByClient[recordPaymentClient?.id]?.invoices || []).length > 0 && (
              <div className="pa-field">
                <span>Numeros de facturacion</span>
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
                placeholder="Ej: Verificado en el sistema financiero externo"
              />
            </label>

            <div className="pa-modal-actions">
              <button className="pa-btn secondary" onClick={() => setRecordPaymentClient(null)} disabled={recordPaymentLoading}>
                Cancelar
              </button>
              <button className="pa-btn primary" onClick={handleRecordClientPayment} disabled={recordPaymentLoading}>
                {recordPaymentLoading ? "Cerrando..." : "Marcar saldado"}
              </button>
            </div>
          </div>
        </ModalShell>

        <ModalShell open={!!creditSettlementTarget} onClose={() => setCreditSettlementTarget(null)} title="Marcar cr�dito saldado" size="compact">
          <div style={{ minWidth: 320 }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
              {creditSettlementTarget?.client?.name || "Cliente sin nombre"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>
              Facturas a cerrar: {creditSettlementTarget?.orderIds?.length || 0}
            </p>

            {(creditSettlementTarget?.invoices || []).length > 0 && (
              <div className="pa-field">
                <span>Numeros de facturacion</span>
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
                placeholder="Ej: Factura saldada en el sistema financiero externo"
              />
            </label>

            <div className="pa-modal-actions">
              <button className="pa-btn secondary" onClick={() => setCreditSettlementTarget(null)} disabled={creditSettlementLoading}>
                Cancelar
              </button>
              <button className="pa-btn primary" onClick={handleConfirmCreditSettlement} disabled={creditSettlementLoading}>
                {creditSettlementLoading ? "Cerrando..." : "Marcar saldado"}
              </button>
            </div>
          </div>
        </ModalShell>

        {showClientModal && (
          <div className="pa-overlay" onClick={() => setShowClientModal(false)}>
            <div className="pa-modal pa-client-modal" style={{ maxWidth: 620 }} onClick={event => event.stopPropagation()}>
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
                <div className="pa-form-grid pa-client-form-grid">
                  <label className="pa-field">
                    <span>Nombre <strong className="pa-required-mark">*</strong></span>
                    <input
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
                    {clientFormErrors.name && <small className="pa-field-help error">{clientFormErrors.name}</small>}
                  </label>
                  <label className="pa-field">
                    <span>Teléfono <strong className="pa-required-mark">*</strong></span>
                    <input
                      type="tel"
                      value={clientForm.phone}
                      onChange={event => {
                        setClientForm(prev => ({ ...prev, phone: formatDominicanPhone(event.target.value) }));
                        setClientFormError("");
                        setClientFormErrors(prev => ({ ...prev, phone: "" }));
                      }}
                      placeholder="809-555-1234"
                      maxLength="12"
                      autoComplete="tel"
                    />
                    {clientFormErrors.phone && <small className="pa-field-help error">{clientFormErrors.phone}</small>}
                  </label>
                  <label className="pa-field">
                    <span>Correo <small className="pa-optional-pill">Opcional</small></span>
                    <input
                      type="email"
                      value={clientForm.email}
                      onChange={event => setClientForm(prev => ({ ...prev, email: event.target.value }))}
                      placeholder="cliente@empresa.com"
                      autoComplete="email"
                    />
                  </label>
                  <label className="pa-field">
                    <span>Dirección <small className="pa-optional-pill">Opcional</small></span>
                    <input
                      value={clientForm.address}
                      onChange={event => setClientForm(prev => ({ ...prev, address: event.target.value }))}
                      placeholder="Dirección opcional"
                      autoComplete="street-address"
                    />
                  </label>
                  <label className="pa-field full">
                    <span>Notas <small className="pa-optional-pill">Opcional</small></span>
                    <textarea
                      rows={3}
                      value={clientForm.notes}
                      onChange={event => setClientForm(prev => ({ ...prev, notes: event.target.value }))}
                      placeholder="Notas internas opcionales"
                    />
                  </label>
                </div>
                {clientFormError && <p className="pa-client-form-error">{clientFormError}</p>}
              </div>
              <div className="pa-modal-actions">
                <button className="pa-btn secondary" onClick={() => setShowClientModal(false)}>Cancelar</button>
                <button className="pa-btn primary" onClick={handleSaveClient} disabled={saving}>
                  {saving ? "Guardando..." : editingClient ? "Guardar cambios" : "Agregar cliente"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "materials" && (
          <section className="pa-section">
            <div className="pa-section-heading">
              <div>
                <span className="pa-kicker">Catálogo</span>
                <h2>Gestión de Materiales</h2>
                <p>Administra los materiales disponibles para las órdenes de producción.</p>
              </div>
              <button className="pa-btn primary" onClick={handleAddMaterial}>
                <Icons.Plus />
                Agregar material
              </button>
            </div>
            <div className="pa-toolbar pa-toolbar-users">
              <div className="pa-search-box pa-toolbar-search">
                <Icons.Search />
                <input
                  value={materialSearch}
                  onChange={(event) => setMaterialSearch(event.target.value)}
                  placeholder="Buscar por nombre..."
                />
              </div>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <span className="pa-section-kicker">Inventario</span>
                  <h2>Materiales registrados</h2>
                </div>
                <span className="pa-results-count">
                  {filteredMaterials.length} resultados
                </span>
              </div>
              <div className="ps-table-wrap" style={{ maxHeight: 520 }}>
                <table className="ps-table">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Registro</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialsLoading ? (
                      <tr>
                        <td colSpan={3} className="ps-table-empty">Cargando materiales...</td>
                      </tr>
                    ) : filteredMaterials.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="ps-table-empty">
                          {materialSearch ? "No hay materiales que coincidan con la búsqueda." : "No hay materiales registrados. Agrega el primer material para comenzar."}
                        </td>
                      </tr>
                    ) : (
                      paginatedMaterials.map((mat) => (
                        <tr key={mat.id} className="row-hover">
                          <td className="td-pad td-name">{mat.name}</td>
                          <td className="td-pad td-date">
                            {new Date(mat.created_at).toLocaleDateString("es-DO", {
                              day: "2-digit", month: "short", year: "numeric"
                            })}
                          </td>
                          <td className="td-pad td-actions" onClick={(e) => e.stopPropagation()}>
                            <div className="table-actions">
                              <button className="table-action-btn edit" onClick={() => handleEditMaterial(mat)} title="Editar material">
                                <Icons.Edit />
                              </button>
                              <button
                                className={`table-action-btn ${deletingMaterialId === mat.id ? "" : "cancel"}`}
                                onClick={() => handleDeleteMaterial(mat.id)}
                                title={deletingMaterialId === mat.id ? "Confirmar eliminación" : "Eliminar material"}
                                style={deletingMaterialId === mat.id ? { background: "#FEE2E2", color: "#DC2626", border: "1px solid #FECACA" } : undefined}
                              >
                                {deletingMaterialId === mat.id ? <Icons.Check /> : <Icons.Trash />}
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
            </div>
          </section>
        )}

        {showMaterialModal && (
          <div className="pa-overlay" onClick={() => setShowMaterialModal(false)}>
            <div className="pa-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="pa-modal-head">
                <h3>{editingMaterial ? "Editar material" : "Agregar material"}</h3>
                <button className="pa-close-btn" onClick={() => setShowMaterialModal(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="pa-modal-body" style={{ paddingBottom: 44 }}>
                <div className="pa-field">
                  <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: "13px", color: "#0f1e40" }}>Nombre del material</label>
                  <input
                    className="pa-input"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #DDE3EF", fontSize: "14px" }}
                    value={materialFormName}
                    onChange={e => { setMaterialFormName(e.target.value); setMaterialFormError(""); }}
                    placeholder="Ej. Vinilo, Banner, Lona..."
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleSaveMaterial(); }}
                  />
                  {materialFormError && (
                    <p style={{ color: "#EF4444", fontSize: "12px", marginTop: 6 }}>{materialFormError}</p>
                  )}
                </div>
              </div>
              <div className="pa-modal-actions">
                <button className="pa-btn secondary" onClick={() => setShowMaterialModal(false)}>Cancelar</button>
                <button className="pa-btn primary" onClick={handleSaveMaterial}>
                  {editingMaterial ? "Guardar cambios" : "Agregar material"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "users" &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-users">
              <div className="pa-search-box pa-toolbar-search"><Icons.Search />
                <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Buscar por nombre, correo o rol..." />
              </div>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">Todos los roles</option>
                <option value="admin">Administrador</option>
                <option value="seller">Vendedor</option>
                <option value="designer">Dise�ador</option>
                <option value="quote">Caja</option>
                <option value="printer">Produccion legacy</option>
                <option value="digital_producer">Produccion Digital</option>
                <option value="dtf_producer">Produccion DTF</option>
                <option value="ploteo_producer">Produccion Ploteo</option>
                <option value="delivery">Entrega</option>
              </select>
              <button className="pa-btn primary pa-toolbar-create" onClick={openCreateUserModal}><Icons.Plus />
                Crear usuario
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head">
                <div>
                  <span className="pa-section-kicker">Supervisi�n</span>
                  <h2>Usuarios del sistema</h2>
                </div>
                <span className="pa-results-count">{filteredProfiles.length} usuarios</span>
              </div>
              <div className="ps-table-wrap" style={{ maxHeight: 520 }}>
                <table className="ps-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Correo</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingUsers ?
                        <tr><td colSpan={5} className="ps-table-empty">Cargando usuarios...</td></tr>
                        : filteredProfiles.length === 0 ?
                          <tr><td colSpan={5} className="ps-table-empty">{loadUsersError || "No hay usuarios para mostrar."}</td></tr>
                          : filteredProfiles.map(item => {
                            const isActive = isEmploymentActive(item);

                            return <tr key={item.id} className="row-hover" onClick={() => { setSelectedUser(item); setUserDetailModalOpen(true); }}>
                              <td className="td-pad td-name">
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div className="pa-user-avatar-mini">
                                    {getUserDisplayName(item).charAt(0).toUpperCase()}
                                  </div>
                                  <strong style={{ fontSize: 13 }}>{getUserDisplayName(item)}</strong>
                                </div>
                              </td>
                              <td className="td-pad">{item.email || "Sin correo"}</td>
                              <td className="td-pad"><RoleBadge role={item.role} /></td>
                              <td className="td-pad">
                                <span className={`pa-meta-badge ${isActive ? "active" : "inactive"}`}>
                                  {getEmploymentStatus(item)}
                                </span>
                              </td>
                              <td className="td-pad td-actions">
                                <div className="table-actions">
                                  <button className="table-action-btn view" onClick={(e) => { e.stopPropagation(); setSelectedUser(item); setUserDetailModalOpen(true); }} title="Ver detalles">
                                    <Icons.Eye />
                                  </button>
                                  <button className="table-action-btn edit" onClick={(e) => { e.stopPropagation(); openEditUserModal(item); }} title="Editar empleado">
                                    <Icons.Edit />
                                  </button>
                                  <button className={`table-action-btn ${isActive ? "deactivate" : "activate"}`} onClick={(e) => { e.stopPropagation(); openEmploymentStatusConfirm(item); }} title={isActive ? "Desactivar usuario" : "Activar usuario"}>
                                    {isActive ? <Icons.X /> : <Icons.Check />}
                                  </button>
                                </div>
                              </td>
                            </tr>;
                          })}
                    </tbody>
                  </table>
                </div>
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
          materialOptions={materials.map(item => item.name)}
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
          materialOptions={materials.map(item => item.name)}
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
          responsibleName={selectedOrder ? getUserDisplayName(usersById[resolveSellerId(selectedOrder)]) : "---"}
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
        title={assigningOrder?.order_design_type === "EXTERNAL_DESING" ? "Enviar a Caja" : undefined}
        onClose={() => { setAssigningOrder(null); setAssigningRole(null); }}
        onConfirm={handleAssignOrder}
        loading={assigningLoading}
      />
      <ProductionAssignmentModal
        open={!!advancedProduction}
        order={advancedProduction?.order}
        loading={advancedActionLoading}
        title={advancedProduction?.action === "reassign_production" ? "Reasignar Producci�n" : undefined}
        onClose={() => setAdvancedProduction(null)}
        onConfirm={handleAdvancedProductionConfirm}
      />
      <PaymentFormModal
        open={!!paymentModalOrder}
        order={paymentModalOrder}
        loading={paymentModalLoading}
        onClose={() => setPaymentModalOrder(null)}
        onConfirm={handlePaymentConfirm}
      />
      <ModalShell open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="Confirmar Cancelaci�n" size="compact">
        <div className="pa-confirm-modal-body">
          <div className="pa-confirm-icon cancel">
            <Icons.Trash />
          </div>
          <div className="pa-confirm-copy">
            <h4>Cancelar orden</h4>
            <p className="pa-confirm-order-name">{cancelOrderData?.client_name}</p>
            <p className="pa-confirm-order-desc">{cancelOrderData?.description?.slice(0, 60)}{cancelOrderData?.description?.length > 60 ? "..." : ""}</p>
            <label className="pa-field full">
              <span>Motivo de cancelaci�n</span>
              <textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value.slice(0, 500))} placeholder="Describe por qu� se cancela esta orden." />
            </label>
            <p className="pa-confirm-warning">La orden podr� reabrirse �nicamente desde Configuraci�n avanzada y quedar� auditada.</p>
          </div>
          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={() => setCancelModalOpen(false)}>
              Cerrar
            </button>
            <button className="pa-btn pa-confirm-btn-cancel" onClick={handleConfirmCancelOrder} disabled={cancelLoading}>
              {cancelLoading ? "Cancelando..." : "S�, cancelar orden"}
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
      <ArchiveOrderModal
        open={!!deletingOrder}
        onClose={() => setDeletingOrder(null)}
        onConfirm={handleConfirmDeleteOrder}
        order={deletingOrder}
        loading={deleteLoading}
        title="Eliminar orden y archivos"
        confirmText="Eliminar definitivamente"
        cancelText="Conservar orden"
      >
        <p>
          Vas a eliminar la orden{" "}
          <strong>#{deletingOrder?.id?.slice(0, 8).toUpperCase()}</strong>
          {" "}y todos sus archivos relacionados.
        </p>
        <p className="archive-modal-hint">
          Primero se borraran archivos en Supabase Storage y Cloudflare R2. Si algo falla, la orden se conserva para evitar archivos huerfanos.
        </p>
      </ArchiveOrderModal>
      <UserFormModal open={userModalOpen} mode={userModalMode} userForm={userForm} setUserForm={setUserForm} onClose={closeUserModal} onSubmit={handleSaveUser} saving={savingUser} />
      <UserDetailModal open={userDetailModalOpen} user={selectedUser} onClose={() => setUserDetailModalOpen(false)} onEdit={openEditUserModal} onCreateOrder={handleCreateOrderFromUser} onRequestEmploymentToggle={openEmploymentStatusConfirm} onShowFeedback={showFeedback} />
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
    <ModalShell open={open} onClose={onClose} title="Créditos pendientes" size="compact">
      <div className="pa-credit-alert-modal">
        <div className="pa-credit-alert-hero">
          <span className="pa-credit-alert-hero-icon"><Icons.Receipt /></span>
          <div>
            <strong>{invoiceCount} factura{invoiceCount === 1 ? "" : "s"} a crédito pendiente{invoiceCount === 1 ? "" : "s"}</strong>
            <p>{clientCount} cliente{clientCount === 1 ? "" : "s"} tiene{clientCount === 1 ? "" : "n"} facturas pendientes de pago.</p>
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
          Este aviso se mostrara una vez al mes mientras existan créditos pendientes.
        </p>

        <div className="pa-modal-actions">
          <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
            {saving ? "Guardando..." : "Entendido"}
          </button>
          <button className="pa-btn primary" onClick={onReview} disabled={saving}>
            Revisar créditos pendientes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CreditPendingAlertModalPolished({ open, invoiceCount, clientCount, clients, saving, onClose, onReview }) {
  return (
    <ModalShell open={open} onClose={onClose} title="Créditos pendientes" size="compact">
      <div className="pa-credit-alert-modal polished">
        <div className="pa-credit-alert-hero polished">
          <span className="pa-credit-alert-hero-icon"><Icons.Receipt /></span>
          <div className="pa-credit-alert-hero-copy">
            <span className="pa-credit-alert-kicker">Seguimiento administrativo</span>
            <strong>{invoiceCount} factura{invoiceCount === 1 ? "" : "s"} a crédito pendiente{invoiceCount === 1 ? "" : "s"}</strong>
            <p>{clientCount} cliente{clientCount === 1 ? "" : "s"} requiere{clientCount === 1 ? "" : "n"} seguimiento de pago.</p>
          </div>
        </div>

        <div className="pa-credit-alert-stats" aria-label="Resumen de créditos pendientes">
          <div>
            <span>Facturas</span>
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
          Este aviso se mostrara una vez al mes mientras existan créditos pendientes.
        </p>

        <div className="pa-modal-actions pa-credit-alert-actions">
          <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
            {saving ? "Guardando..." : "Entendido"}
          </button>
          <button className="pa-btn primary" onClick={onReview} disabled={saving}>
            Revisar créditos pendientes
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
  getCreditReceivableStatusStyle,
  formatCreditDate,
}) {
  const clientId = group.client?.id;
  const openInvoices = group.invoices.filter((item) => isOpenCreditReceivable(item));
  const settledInvoicesCount = group.invoices.filter((item) => item.status === "paid").length;
  const selectedIds = selectedCreditOrderIds[clientId] || [];
  const allOpenSelected = openInvoices.length > 0 && openInvoices.every((item) => selectedIds.includes(item.order_id));
  const [detailSearch, setDetailSearch] = useState("");
  const [detailFilter, setDetailFilter] = useState("all");

  const filteredInvoices = useMemo(() => {
    const q = detailSearch.toLowerCase().trim();
    return group.invoices.filter((item) => {
      if (detailFilter === "open" && !isOpenCreditReceivable(item)) return false;
      if (detailFilter === "paid" && item.status !== "paid") return false;
      if (!q) return true;
      return (
        (item.invoiceNumber || "").toLowerCase().includes(q) ||
        (item.order_id || "").toLowerCase().includes(q)
      );
    });
  }, [group.invoices, detailFilter, detailSearch, isOpenCreditReceivable]);

  return (
    <section className="pa-section pa-credit-layout">
      <div className="pa-credit-detail-view">
        <div className="pa-credit-detail-header">
          <button className="pa-credit-detail-back" onClick={onBack}>
            <Icons.ChevronLeft />
            Volver a lista de cr�ditos
          </button>
          <button
            className="pa-btn secondary pa-btn-sm"
            onClick={() => onCreateReminder(group.client, openInvoices)}
            disabled={openInvoices.length === 0}
          >
            <Icons.Clock />
            Crear recordatorio
          </button>
        </div>

        <div className="pa-credit-detail-client-card">
          <div className="pa-credit-detail-client-avatar">
            {group.client?.name?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div className="pa-credit-detail-client-info">
            <h3>{group.client?.name || "Cliente sin nombre"}</h3>
            <span>{group.client?.phone || "Sin telefono"}</span>
          </div>
          <div className="pa-credit-detail-client-stats">
            <div className="pa-credit-detail-stat">
              <strong>{group.pendingCount}</strong>
              <span>Pendientes</span>
            </div>
            <div className="pa-credit-detail-stat">
              <strong>{group.invoices.length}</strong>
              <span>Total</span>
            </div>
            <div className="pa-credit-detail-stat settled">
              <strong>{settledInvoicesCount}</strong>
              <span>Saldadas</span>
            </div>
          </div>
        </div>

        <div className="pa-panel pa-credit-panel">
          <div className="pa-panel-stripe" />
          <div className="pa-panel-head pa-panel-head-results">
            <div>
              <span className="pa-section-kicker">Facturas</span>
              <h2>Facturas del cliente</h2>
            </div>
          </div>
          <div style={{ padding: "0 14px 14px" }}>
            <div className="pa-credit-detail-toolbar">
              <div className="pa-search-box pa-toolbar-search">
                <Icons.Search />
                <input
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  placeholder="Buscar por factura u orden..."
                />
              </div>
              <select value={detailFilter} onChange={(e) => setDetailFilter(e.target.value)}>
                <option value="all">Todos</option>
                <option value="open">Pendientes</option>
                <option value="paid">Saldadas</option>
              </select>
            </div>
          </div>
          <div className="ps-table-wrap pa-credit-invoice-wrap">
            <table className="ps-table">
              <thead>
                <tr>
                  <th className="pa-credit-check-cell">
                    <input
                      type="checkbox"
                      checked={allOpenSelected}
                      disabled={openInvoices.length === 0}
                      onChange={() => onToggleAll(clientId, group.invoices)}
                      aria-label="Seleccionar facturas pendientes"
                    />
                  </th>
                  <th>Factura</th>
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
                      {detailSearch || detailFilter !== "all"
                        ? "No hay facturas que coincidan con los filtros."
                        : "No hay facturas registradas para este cliente."}
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((item) => {
                    const itemOpen = isOpenCreditReceivable(item);
                    const selected = selectedIds.includes(item.order_id);
                    return (
                      <tr key={item.id || item.order_id} className="row-hover" style={{ cursor: "pointer" }} onClick={() => { if (item.order) onViewOrder(item.order); }}>
                        <td className="td-pad pa-credit-check-cell">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!itemOpen || !item.order_id}
                            onChange={() => onToggleSelection(clientId, item.order_id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Seleccionar factura ${item.invoiceNumber}`}
                          />
                        </td>
                        <td className="td-pad td-name">{item.invoiceNumber}</td>
                        <td className="td-pad td-id">{item.order_id?.slice(0, 8) || "---"}</td>
                        <td className="td-pad">{formatCreditDate(item.creditIssuedAt)}</td>
                        <td className="td-pad">
                          <span className="ps-badge" style={getCreditReceivableStatusStyle(item.status)}>
                            {getCreditReceivableStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="td-pad td-actions">
                          <div className="table-actions">
                            {item.order && (
                              <button className="table-action-btn view" onClick={(e) => { e.stopPropagation(); onViewOrder(item.order); }} title="Ver orden">
                                <Icons.Eye />
                              </button>
                            )}
                            {itemOpen && (
                              <button
                                className="table-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCreateReminder(group.client, [item]);
                                }}
                                title="Crear recordatorio"
                              >
                                <Icons.Clock />
                              </button>
                            )}
                            {itemOpen && (
                              <button
                                className="table-action-btn"
                                onClick={(e) => { e.stopPropagation(); onSettle({
                                  client: group.client,
                                  orderIds: [item.order_id],
                                  invoices: [item.invoiceNumber],
                                  mode: "single",
                                }); }}
                                title="Marcar factura saldada"
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
          <div className="pa-credit-detail-actions-bar">
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
          </div>
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
          El link estar� disponible cuando la orden tenga un token de seguimiento.
        </p>
      )}
    </div>
  );
}
