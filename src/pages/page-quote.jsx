import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import { uploadOrderAsset, buildPaymentReceiptPath, createSignedOrderAssetUrlFromStoredUrl } from "../utils/uploadOrderAsset";
import { PAYMENT_RECEIPT_HINT, validateReceiptFile } from "../utils/receiptValidation";
import { Icons } from "../utils/icons";
import { StatusBadge, PaymentBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import FileUploadZone from "../components/ui/FileUploadZone";
import CreateClientModal from "../components/ui/CreateClientModal";
import SettleCreditModal from "../components/ui/SettleCreditModal";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PRODUCTION_AREAS,
  QUOTE_ASSIGNMENT_FIELDS,
  STATUS_OPTIONS,
  ARCHIVE_MODULES,
  getOrderStatusConfig,
  isPaymentCredit,
  isPaymentPaid,
  isPaymentPartial,
  isPaymentProductionEligible,
  isOrderStatus,
  isOrderStatusIn,
  getFileNameFromUrl,
  formatDate,
} from "../utils/constants";
import { getReferenceImages } from "../utils/orderAssets";
import {
  getParticipatingProductionAreaCodes,
  getProductionFiles,
  hasUnclassifiedProductionFiles,
} from "../utils/production";
import { useAuth } from "../hooks/useAuth";
import { showCreditActionFeedback } from "../utils/notifications";
import useNotifications from "../hooks/useNotifications";
import NotificationCenter from "../components/NotificationCenter";
import FileCard from "../components/FileCard";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import "../css-components/page-quote.css";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import {
  canArchiveOrder,
  archiveOrder,
} from "../utils/archive";
import { getPaymentConfirmButtonLabel } from "../utils/paymentUi";
import {
  CreditCustomReminderDueModal,
  CreditReminderCreateModal,
} from "../components/ui/CreditReminderModals";
// Normaliza texto a minúsculas y sin espacios para comparaciones seguras
const normalizeText = (value) => String(value || "").trim().toLowerCase();
const INVOICE_PAYMENT_FIELD = "invoice_payment";
const PER_PAGE = 15;
// Verifica si una orden está asignada a un usuario específico de cotización
const hasQuoteAssignment = (order, quoteUserId) => QUOTE_ASSIGNMENT_FIELDS.some(field => order?.[field] === quoteUserId);
// Obtiene el ID del vendedor que creó la orden
const resolveSellerId = (order) => order?.seller_id || order?.created_by || null;
// Obtiene el nombre del vendedor buscando en el directorio o usando valor por defecto
const resolveSellerName = (order, sellerDirectory) => order?.seller_name || sellerDirectory?.[resolveSellerId(order)] || "No definido";
// Verifica si una orden puede ser editada en cotización (debe estar en estado IN_QUOTE, no pagada, no archivada)
const isQuoteEditable = (order) => (
  !order?.is_archived_quote &&
  !isPaymentPaid(order?.payment_status) &&
  !isPaymentCredit(order?.payment_status) &&
  (isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) || isPaymentPartial(order?.payment_status))
);
// Verifica si una orden está asignada al usuario actual
const isOrderAssignedToQuote = (order, quoteUserId) => Boolean(order?.id) && hasQuoteAssignment(order, quoteUserId);
// Verifica si una orden puede ser archivada (recibe userId explícitamente)
const canArchiveQuoteOrder = (order, userId) => canArchiveOrder(order, ARCHIVE_MODULES.QUOTE, userId);
// Verifica si una orden fue devuelta (tiene estado de diseño/pendiente Y razón de devolución)
const isReturnedOrder = (order) => isOrderStatusIn(order?.status, [ORDER_STATUS.IN_DESIGN, ORDER_STATUS.PENDING]) && Boolean(String(order?.return_reason || "").trim());
const isOpenCreditReceivable = (item) => ["open", "partial"].includes(item?.status);
const formatCreditDate = (value) => (value ? formatDate(value) : "---");
const getCreditIssuedAt = (item) => item?.issued_at || item?.created_at || item?.order?.created_at || null;
const CREDIT_REMINDER_FALLBACK_CHECK_MS = 30000;
const CREDIT_REMINDER_SERVER_TIME_RESYNC_MS = 300000;
const CREDIT_REMINDER_MAX_TIMEOUT_MS = 2147483000;
const CREDIT_REMINDER_TIME_ZONE = "America/Santo_Domingo";
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
// FUNCIÓN PARA PARSEAR ARCHIVOS DE ORDEN
// Los archivos de una orden se guardan como JSON string (puede ser un array o un objeto único)
// Esta función maneja ambos casos y devuelve siempre un array
const getOrderFiles = (order) => {
  if (!order?.order_file_url) return [];
  try {
    const parsed = JSON.parse(order.order_file_url);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Si no es válido como JSON, asumimos que es una URL directa
    return [order.order_file_url];
  }
};

// Badge que indica que una orden fue devuelta para correcciones

// Badge que indica que una orden fue devuelta para correcciones
function ReturnedBadge({ compact = false }) {
  return (
    <span className={`pq-returned-badge${compact ? " compact" : ""}`}>
      Devuelta
    </span>
  );
}

// MODAL PARA DEVOLVER ÓRDENES AL DISEÑADOR
// Cuando hay problemas con el diseño, la orden se devuelve al diseñador o vendedor
// Se debe especificar el motivo de la devolución para que sepan qué corregir
// Este modal determina automáticamente si la devuelve al diseñador o vendedor
// basándose en el tipo de diseño (interno vs. externo)

const getReturnTargetLabel = (order) => (
  order?.order_design_type === "EXTERNAL_DESING" ? "Vendedor" : "Diseñador"
);

function ReturnToDesignerModal({ open, onClose, onConfirm, order, loading }) {
  const [reason, setReason] = useState("");
  const targetLabel = getReturnTargetLabel(order);
  const nextStatusLabel = order?.order_design_type === "EXTERNAL_DESING" ? "Pendiente" : "En Diseño";

  const handleConfirm = () => {
    if (!reason.trim()) return;
    onConfirm(reason);
  };

  if (!open || !order) return null;

  return (
    <div className="pq-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="pq-dialog">
        <div className="pq-dialog-icon return">
          <Icons.ArrowLeft />
        </div>
        <h3 className="pq-dialog-title">{`Devolver al ${targetLabel}`}</h3>
        <p className="pq-dialog-text">
          {`¿Estás seguro de que deseas devolver esta orden al ${targetLabel.toLowerCase()} para correcciones?`}
          {` El estado cambiará a "${nextStatusLabel}".`}
        </p>
        <div className="pq-dialog-order">
          <span className="pq-dialog-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
          <span className="pq-dialog-order-name">{order.client_name || order.description || "Orden sin título"}</span>
        </div>
        <div className="pq-form-group">
          <label className="pq-input-label">Razón de la devolución</label>
          <textarea
            className="pq-input pq-textarea"
            placeholder="Describe los cambios o correcciones necesarias..."
            value={reason}
            onChange={event => setReason(event.target.value)}
            disabled={loading}
            rows={3}
          />
        </div>
        <div className="pq-dialog-actions">
          <button className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="pq-btn pq-btn-return" onClick={handleConfirm} disabled={loading || !reason.trim()}>
            {loading ? "Devolviendo..." : `Devolver al ${targetLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// MODAL PARA ENVIAR ÓRDENES A PRODUCCIÓN
// Cuando una orden está cotizada y pagada, se envía a un impresor para que produzca
// Este modal:
// 1. Carga los usuarios con rol "printer" (impresores) disponibles
// 2. Permite seleccionar el impresor responsable
// 3. Asigna la orden al impresor seleccionado

// MODAL PRINCIPAL DE DETALLE DE COTIZACIÓN
// Este es el modal más importante de la página
// Permite:
// 1. Ver todos los detalles de la orden (cliente, vendedor, materiales, descripción, archivos)
// 2. Confirmar o rechazar pagos
// 3. Subir comprobantes de pago (solo si el estado es "Pagado")
// 4. Devolver la orden al diseñador si hay problemas
// 5. Enviar la orden a producción cuando está lista
// 6. Archivar órdenes completadas

function ProductionAssignmentModal({ open, onClose, onConfirm, order, loading }) {
  const [areas, setAreas] = useState(PRODUCTION_AREAS);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState("");

  const productionFiles = useMemo(() => getProductionFiles(order), [order]);
  const participatingAreaCodes = useMemo(() => (
    getParticipatingProductionAreaCodes(productionFiles)
  ), [productionFiles]);
  const hasUnclassifiedFiles = useMemo(() => (
    hasUnclassifiedProductionFiles(productionFiles)
  ), [productionFiles]);
  const areaCounts = useMemo(() => (
    productionFiles.reduce((acc, file) => {
      if (file.production_area_code) {
        acc[file.production_area_code] = (acc[file.production_area_code] || 0) + 1;
      }
      return acc;
    }, {})
  ), [productionFiles]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setAssignments({});
    setError("");
    setLoadingOptions(true);

    const loadOptions = async () => {
      const { data: areaData, error: areaError } = await supabase
        .from("production_areas")
        .select("code, label, producer_role, is_active")
        .eq("is_active", true);

      if (!active) return;

      const activeAreas = areaError || !Array.isArray(areaData) || areaData.length === 0
        ? PRODUCTION_AREAS
        : areaData
            .map((area) => ({
              code: area.code,
              label: area.label,
              role: area.producer_role,
            }))
            .sort((a, b) => {
              const aIndex = PRODUCTION_AREAS.findIndex((item) => item.code === a.code);
              const bIndex = PRODUCTION_AREAS.findIndex((item) => item.code === b.code);
              return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
            });
      const nextAreas = activeAreas.filter((area) => participatingAreaCodes.includes(area.code));
      const roles = [...new Set(nextAreas.map((area) => area.role).filter(Boolean))];
      let userData = [];
      let userError = null;

      if (roles.length > 0) {
        const userResult = await supabase
          .from("profiles")
          .select("id, name, role, employment_status")
          .in("role", roles)
          .eq("employment_status", true);
        userData = userResult.data;
        userError = userResult.error;
      }

      if (!active) return;

      setAreas(nextAreas);
      setUsers(Array.isArray(userData) && !userError ? userData : []);
      setLoadingOptions(false);

      if (hasUnclassifiedFiles) {
        setError("Todos los archivos deben tener tipo de produccion antes de enviar.");
      } else if (nextAreas.length === 0) {
        setError("La orden no tiene archivos clasificados para produccion.");
      } else if (userError) {
        setError("No se pudieron cargar los usuarios de produccion.");
      }
    };

    loadOptions();

    return () => {
      active = false;
    };
  }, [hasUnclassifiedFiles, open, participatingAreaCodes]);

  if (!open || !order) return null;

  const usersByRole = users.reduce((acc, userItem) => {
    acc[userItem.role] = [...(acc[userItem.role] || []), userItem];
    return acc;
  }, {});
  const canAssignAreas = areas.length > 0 && !hasUnclassifiedFiles;
  const allAreasAssigned = canAssignAreas && areas.every((area) => Boolean(assignments[area.code]));

  const handleConfirm = () => {
    if (hasUnclassifiedFiles) {
      setError("Todos los archivos deben tener tipo de produccion antes de enviar.");
      return;
    }
    if (areas.length === 0) {
      setError("La orden no tiene archivos clasificados para produccion.");
      return;
    }
    if (!allAreasAssigned) {
      setError("Debes seleccionar un responsable para cada area.");
      return;
    }
    setError("");
    onConfirm(assignments);
  };

  return (
    <div className="pq-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="pq-dialog pq-production-dialog">
        <div className="pq-dialog-icon return">
          <Icons.Users />
        </div>
        <h3 className="pq-dialog-title">Asignar produccion</h3>
        <p className="pq-dialog-text">
          Selecciona un responsable por area antes de enviar la orden a produccion.
        </p>
        <div className="pq-dialog-order">
          <span className="pq-dialog-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
          <span className="pq-dialog-order-name">{order.client_name || order.description || "Orden sin titulo"}</span>
        </div>

        {loadingOptions ? (
          <div className="pq-production-loading">Cargando responsables...</div>
        ) : areas.length === 0 ? (
          <div className="pq-production-loading">
            {hasUnclassifiedFiles
              ? "Clasifica todos los archivos antes de enviar a produccion."
              : "No hay areas de produccion participantes."}
          </div>
        ) : (
          <div className="pq-production-assignment-list">
            {areas.map((area) => {
              const options = usersByRole[area.role] || [];
              const count = areaCounts[area.code] || 0;
              return (
                <label className="pq-production-assignment-row" key={area.code}>
                  <span className="pq-production-area-copy">
                    <strong>{area.label}</strong>
                    <small>{count} archivo{count === 1 ? "" : "s"} relacionado{count === 1 ? "" : "s"}</small>
                  </span>
                  <select
                    className="pq-input"
                    value={assignments[area.code] || ""}
                    onChange={(event) => {
                      setAssignments(prev => ({ ...prev, [area.code]: event.target.value }));
                      setError("");
                    }}
                    disabled={loading || options.length === 0}
                  >
                    <option value="">Seleccionar responsable</option>
                    {options.map((userItem) => (
                      <option key={userItem.id} value={userItem.id}>
                        {userItem.name || "Usuario de produccion"}
                      </option>
                    ))}
                  </select>
                  {options.length === 0 && (
                    <span className="pq-production-row-error">No hay usuarios activos para esta area.</span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {error && <div className="pq-production-error">{error}</div>}

        <div className="pq-dialog-actions">
          <button className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          <button
            className="pq-btn pq-btn-return"
            onClick={handleConfirm}
            disabled={loading || loadingOptions || !allAreasAssigned}
          >
            {loading ? "Enviando..." : "Enviar a produccion"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuoteOrderDetailModal({ open, onClose, order, onConfirmPayment, paymentSaving, sellerDirectory, onOpenReturnModal, onValidationError, onOpenProductionModal, onCreditClientRequired }) {
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreviewAvailable, setReceiptPreviewAvailable] = useState(true);
  const [receiptZoneError, setReceiptZoneError] = useState("");
  const [receiptZoneErrorKey, setReceiptZoneErrorKey] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState("pagado");
  const [localError, setLocalError] = useState("");
  const [creditClientRequired, setCreditClientRequired] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReceiptFile(null);
      setReceiptPreviewAvailable(true);
      setReceiptZoneError("");
      setReceiptZoneErrorKey(0);
      setPaymentStatus(isPaymentPartial(order?.payment_status) ? PAYMENT_STATUS.PAID : order?.payment_status || PAYMENT_STATUS.PENDING);
      setLocalError("");
      setCreditClientRequired(false);
      setReceiptUrl("");
    }
  }, [open, order?.id, order?.payment_status]);

  useEffect(() => {
    if (paymentStatus !== PAYMENT_STATUS.CREDIT || order?.client_id) {
      setCreditClientRequired(false);
    }
  }, [order?.client_id, paymentStatus]);

  useEffect(() => {
    let active = true;

    const loadReceiptUrl = async () => {
      if (!open || !order?.invoice_payment) {
        if (active) setReceiptUrl("");
        return;
      }

      const signedUrl = await createSignedOrderAssetUrlFromStoredUrl({
        bucket: "payment-invoice",
        url: order.invoice_payment,
      });

      if (active) {
        setReceiptUrl(signedUrl || "");
      }
    };

    loadReceiptUrl();

    return () => {
      active = false;
    };
  }, [open, order?.invoice_payment]);

  const receiptPreviewUrl = useMemo(() => (
    receiptFile && receiptPreviewAvailable ? URL.createObjectURL(receiptFile) : ""
  ), [receiptFile, receiptPreviewAvailable]);

  useEffect(() => () => {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
  }, [receiptPreviewUrl]);

  if (!open || !order) return null;

  const orderFiles = getOrderFiles(order);
  const productionFiles = getProductionFiles(order);
  const unclassifiedProductionFiles = productionFiles.filter((file) => !file.production_area_code).length;
  const referenceImageUrls = getReferenceImages(order);
  const createdAt = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const canConfirmPayment = isQuoteEditable(order);
  const canSelectPendingPayment = !isPaymentPartial(order.payment_status);
  const isCompletingPartialPayment = isPaymentPartial(order.payment_status);
  const canReturnToDesigner = isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) && !isPaymentPaid(order?.payment_status) && !order?.is_archived_quote;
  const canMoveToProduction = isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) && isPaymentProductionEligible(order?.payment_status) && !order?.is_archived_quote;
  const returnedReason = String(order?.return_reason || "").trim();
  const readonlyMessage =
    order.is_archived_quote
      ? "Esta orden está en modo lectura porque fue archivada en caja."
      : isPaymentPaid(order.payment_status)
        ? "Esta orden está en modo lectura porque el pago ya fue confirmado."
        : "Esta orden está en modo lectura porque su estado actual no permite confirmar pago.";

  const showReceiptZoneError = (message) => {
    setReceiptZoneError(message || "No se pudo procesar la imagen del recibo.");
    setReceiptZoneErrorKey(prev => prev + 1);
  };

  const handleReceiptAccepted = async ([nextFile], { showError } = {}) => {
    const validation = await validateReceiptFile(nextFile);
    if (!validation.isValid) {
      const message = validation.error || "La imagen no cumple con los requisitos.";
      if (showError) showError(message);
      else showReceiptZoneError(message);
      return;
    }

    setReceiptFile(nextFile);
    setReceiptPreviewAvailable(validation.previewAvailable !== false);
    setReceiptZoneError("");
    setLocalError("");
  };

  const handleRemoveReceipt = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setReceiptFile(null);
    setReceiptPreviewAvailable(true);
    setReceiptZoneError("");
    setReceiptZoneErrorKey(0);
    setLocalError("");
  };

  const handleSubmit = async () => {
    if (isPaymentPartial(order.payment_status) && paymentStatus === PAYMENT_STATUS.PENDING) {
      const msg = "Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.";
      setLocalError(msg);
      if (onValidationError) onValidationError(order, msg);
      return;
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT && !String(order.invoice_number || "").trim()) {
      const msg = "La orden debe tener un numero de facturacion para vender a credito.";
      setLocalError(msg);
      if (onValidationError) onValidationError(order, msg);
      return;
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT && !order.client_id) {
      const msg = "Para crear una orden a crédito, el cliente debe estar registrado.";
      setLocalError(msg);
      setCreditClientRequired(true);
      if (onValidationError) onValidationError(order, msg);
      return;
    }

    if (paymentStatus === PAYMENT_STATUS.PAID && !receiptFile) {
      const msg = "Debes subir una imagen del recibo o factura antes de confirmar.";
      // Mostramos error inline DENTRO del modal
      setLocalError(msg);
      // Y también mostramos un toast flotante para que el usuario no se lo pierda
      if (onValidationError) onValidationError(order, msg);
      return;
    }

    setLocalError("");
    const result = await onConfirmPayment({ order, receiptFile, paymentStatus });
    if (result?.receiptError) {
      showReceiptZoneError(result.receiptError);
    }
  };

  return (
    <div className="pq-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="pq-modal">
        <div className="pq-modal-header">
          <div>
            <span className="pq-modal-kicker">Detalle de caja</span>
            <h2 className="pq-modal-title">Orden #{order.id?.slice(0, 8).toUpperCase()}</h2>
          </div>
          <button className="pq-icon-btn" onClick={onClose} aria-label="Cerrar detalle">
            <Icons.X />
          </button>
        </div>

        <div className="pq-modal-body">
          <div className="pq-flow-summary">
            <StatusBadge status={order.status} className="pq-badge" />
            <PaymentBadge status={order.payment_status} className="pq-badge" />
            {isReturnedOrder(order) && <ReturnedBadge />}
            <span className="pq-flow-date"><Icons.Clock /> {createdAt}</span>
          </div>

          <div className="pq-detail-grid">
            <div className="pq-panel">
              <div className="pq-panel-title">Información de la orden</div>
              <div className="pq-info-list">
                <div className="pq-info-row"><span>Cliente</span><strong>{order.client_name || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Vendedor</span><strong>{resolveSellerName(order, sellerDirectory)}</strong></div>
                <div className="pq-info-row"><span>Teléfono</span><strong>{order.client_contact || order.client_phone || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Núm. Facturación</span><strong>{order.invoice_number || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Tipo</span><strong>{order.order_type || "No definido"}</strong></div>
                <div className="pq-info-row"><span>Material</span><strong>{order.material || "No definido"}</strong></div>
              </div>
              <div className="pq-description-box">
                <span className="pq-description-label">Descripción</span>
                <p>{order.description || "Sin descripción"}</p>
              </div>
            </div>

            <div className="pq-panel">
              <div className="pq-panel-title" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                <Icons.File /> Archivos Adjuntos
              </div>
              {orderFiles.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {orderFiles.map((fileUrl, index) => (
                    <FileCard
                      key={`${fileUrl}-${index}`}
                      name={getFileNameFromUrl(fileUrl)}
                      url={fileUrl}
                    />
                  ))}
                </div>
              ) : (
                <div className="pq-empty-panel">No hay archivos principales disponibles.</div>
              )}

              <div className="pq-preview-block">
                <span className="pq-description-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icons.Eye /> Orden de Trabajo
                </span>
                {order.preview_image ? (
                  <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                    <img
                      src={order.preview_image}
                      alt="preview"
                      style={{
                        width: "100%",
                        borderRadius: "var(--pq-radius-md)",
                        border: "1px solid var(--pq-border)",
                        cursor: "pointer",
                        transition: "transform 0.2s, box-shadow 0.2s",
                      }}
                      onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                      onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                    />
                  </a>
                ) : (
                  <span className="pq-preview-empty">No hay preview cargado.</span>
                )}
              </div>

              {referenceImageUrls.length > 0 && (
                <div className="pq-preview-block" style={{ marginTop: 16 }}>
                  <span className="pq-description-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icons.Image /> Imágenes de referencia
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                    {referenceImageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                        <img
                          src={url}
                          alt={`Ref ${i + 1}`}
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: "var(--pq-radius-md)",
                            border: "1px solid var(--pq-border)",
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
              {productionFiles.length > 0 && (
                <div className="pq-preview-block" style={{ marginTop: 16 }}>
                  <span className="pq-description-label">Clasificacion de produccion</span>
                  <span className="pq-upload-hint">
                    {productionFiles.length - unclassifiedProductionFiles} clasificados / {productionFiles.length} archivos
                  </span>
                </div>
              )}
            </div>
          </div>

          {isReturnedOrder(order) && (
            <div className="pq-panel pq-return-panel">
              <div className="pq-panel-title">Motivo de devolución</div>
              <div className="pq-return-reason">{returnedReason}</div>
            </div>
          )}

          <div className="pq-panel pq-payment-panel">
            <div className="pq-panel-title">Confirmación de pago</div>

            {!canConfirmPayment && (
              <div className={`pq-readonly-note ${isPaymentPaid(order.payment_status) ? "success" : ""}`}>
                <Icons.Check />
                {readonlyMessage}
              </div>
            )}

            <div className="pq-payment-grid">
              <div className="pq-payment-field">
                <label>Estado del pago</label>
                <select
                  className="pq-input"
                  value={paymentStatus}
                  disabled={!canConfirmPayment || paymentSaving || isCompletingPartialPayment}
                  onChange={event => setPaymentStatus(event.target.value)}
                >
                  <option value={PAYMENT_STATUS.PENDING} disabled={!canSelectPendingPayment}>Pendiente</option>
                  <option value={PAYMENT_STATUS.PARTIAL}>Pago parcial</option>
                  <option value={PAYMENT_STATUS.CREDIT}>Pago a crédito</option>
                  <option value={PAYMENT_STATUS.PAID}>Pagado</option>
                </select>
              </div>

              <div className="pq-payment-field">
                <label>Recibo o factura</label>
                {paymentStatus === PAYMENT_STATUS.PAID ? (
                  receiptFile ? (
                    <div className="pq-receipt-preview-card">
                      <FileUploadZone
                        mode="image"
                        replaceMode
                        inputRef={fileInputRef}
                        className="file-upload-zone--hidden-picker"
                        buttonLabel="Cambiar recibo"
                        disabled={!canConfirmPayment || paymentSaving}
                        externalError={receiptZoneError}
                        externalErrorKey={receiptZoneErrorKey}
                        onFilesAccepted={handleReceiptAccepted}
                      />
                      {receiptPreviewAvailable && receiptPreviewUrl ? (
                        <a href={receiptPreviewUrl} target="_blank" rel="noreferrer">
                          <img
                            src={receiptPreviewUrl}
                            alt="Vista previa del recibo"
                            className="pq-receipt-preview-img"
                          />
                        </a>
                      ) : (
                        <div className="pq-receipt-preview-unavailable">
                          <Icons.Image />
                          <span>{receiptFile.name}</span>
                          <small>Vista previa no disponible</small>
                        </div>
                      )}
                      <div className="pq-receipt-preview-footer">
                        <span className="pq-receipt-preview-name">{receiptFile.name}</span>
                        <div className="pq-receipt-preview-actions">
                          <button
                            type="button"
                            className="pq-receipt-preview-action"
                            disabled={!canConfirmPayment || paymentSaving}
                            aria-label="Cambiar recibo o factura"
                            onClick={() => {
                              if (fileInputRef.current) {
                                fileInputRef.current.value = "";
                                fileInputRef.current.click();
                              }
                            }}
                          >
                            <Icons.Edit /> Cambiar
                          </button>
                          <button
                            type="button"
                            className="pq-receipt-preview-action danger"
                            disabled={!canConfirmPayment || paymentSaving}
                            aria-label="Eliminar recibo o factura cargado"
                            title="Eliminar recibo o factura"
                            onClick={handleRemoveReceipt}
                          >
                            <Icons.Trash />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <FileUploadZone
                      mode="image"
                      replaceMode
                      inputRef={fileInputRef}
                      buttonLabel="Seleccionar desde el ordenador"
                      hint={PAYMENT_RECEIPT_HINT}
                      disabled={!canConfirmPayment || paymentSaving}
                      externalError={receiptZoneError}
                      externalErrorKey={receiptZoneErrorKey}
                      onFilesAccepted={handleReceiptAccepted}
                    />
                  )
                ) : (
                  <span className="pq-upload-hint">El campo de recibo solo se muestra cuando el estado es "Pagado". En pago parcial o crédito no se adjunta comprobante final.</span>
                )}
              </div>
            </div>

            {receiptUrl && (
              <div className="pq-preview-block" style={{ marginTop: 16 }}>
                <span className="pq-description-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icons.Eye /> Comprobante de pago
                </span>
                <a href={receiptUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  <img
                    src={receiptUrl}
                    alt="Comprobante de pago"
                    style={{
                      width: "100%",
                      maxHeight: 200,
                      objectFit: "contain",
                      background: "var(--pq-surface-alt, #f5f7fb)",
                      borderRadius: "var(--pq-radius-md)",
                      border: "1px solid var(--pq-border)",
                      cursor: "pointer",
                      transition: "transform 0.2s, box-shadow 0.2s",
                    }}
                    onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                    onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                  />
                </a>
              </div>
            )}

            {/* Contenedor de errores */}
            {localError && <div className="pq-inline-error">{localError}</div>}
            {creditClientRequired && paymentStatus === PAYMENT_STATUS.CREDIT && !order.client_id && (
              <div className="pq-credit-client-action">
                <button
                  type="button"
                  className="pq-btn pq-btn-secondary"
                  onClick={() => onCreditClientRequired?.(order)}
                  disabled={paymentSaving}
                >
                  <Icons.User />
                  Registrar Cliente {order.client_name || "sin nombre"}
                </button>
              </div>
            )}

            {/* Acciones del modal para cotizar orden */}
            <div className="pq-modal-actions">
              {canReturnToDesigner && (
                <button className="pq-btn pq-btn-return" onClick={() => onOpenReturnModal(order)}>
                  <Icons.ArrowLeft />
                  {`Devolver al ${getReturnTargetLabel(order)}`}
                </button>
              )}
              {canMoveToProduction && (
                <button className="pq-btn pq-btn-return" onClick={() => onOpenProductionModal(order)}>
                  <Icons.Package />
                  Dar paso a producción
                </button>
              )}
              <button className="pq-btn pq-btn-secondary" onClick={onClose}>Cerrar</button>
              <button className="pq-btn pq-btn-primary" onClick={handleSubmit} disabled={!canConfirmPayment || paymentSaving}>
                {getPaymentConfirmButtonLabel(paymentStatus, paymentSaving)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
}) {
  const clientId = group.client?.id;
  const openInvoices = group.invoices.filter((item) => isOpenCreditReceivable(item));
  const settledInvoicesCount = group.invoices.filter((item) => item.status === "paid").length;
  const selectedIds = selectedCreditOrderIds[clientId] || [];
  const allOpenSelected = openInvoices.length > 0 && openInvoices.every((item) => selectedIds.includes(item.order_id));
  const [detailSearch, setDetailSearch] = useState("");
  const [detailFilter, setDetailFilter] = useState("all");

  const filteredInvoices = useMemo(() => {
    const q = normalizeText(detailSearch);
    return group.invoices.filter((item) => {
      if (detailFilter === "open" && !isOpenCreditReceivable(item)) return false;
      if (detailFilter === "paid" && item.status !== "paid") return false;
      if (!q) return true;
      return normalizeText(`${item.invoiceNumber || ""} ${item.order_id || ""}`).includes(q);
    });
  }, [detailFilter, detailSearch, group.invoices]);

  return (
    <section className="pq-section pq-credit-layout">
      <div className="pq-credit-detail-header">
        <button className="pq-credit-back" onClick={onBack}>
          <Icons.ChevronLeft />
          Volver a lista de créditos
        </button>
        <button
          className="pq-btn pq-btn-secondary"
          onClick={() => onCreateReminder(group.client, openInvoices)}
          disabled={openInvoices.length === 0}
        >
          <Icons.Clock />
          Crear recordatorio
        </button>
      </div>

      <div className="pq-credit-client-card">
        <div className="pq-credit-client-avatar">
          {group.client?.name?.charAt(0)?.toUpperCase() || "?"}
        </div>
        <div className="pq-credit-client-info">
          <h3>{group.client?.name || "Cliente sin nombre"}</h3>
          <span>{group.client?.phone || "Sin telefono"}</span>
        </div>
        <div className="pq-credit-detail-stats">
          <div><strong>{group.pendingCount}</strong><span>Pendientes</span></div>
          <div><strong>{group.invoices.length}</strong><span>Total</span></div>
          <div><strong>{settledInvoicesCount}</strong><span>Saldadas</span></div>
        </div>
      </div>

      <div className="pq-panel pq-credit-panel">
        <div className="pq-panel-head">
          <div>
            <span className="pq-section-kicker">Facturas</span>
            <h2>Facturas del cliente</h2>
          </div>
        </div>

        <div className="pq-credit-detail-toolbar">
          <div className="pq-search-box">
            <Icons.Search />
            <input
              value={detailSearch}
              onChange={(event) => setDetailSearch(event.target.value)}
              placeholder="Buscar por factura u orden..."
            />
          </div>
          <select className="pq-input" value={detailFilter} onChange={(event) => setDetailFilter(event.target.value)}>
            <option value="all">Todos</option>
            <option value="open">Pendientes</option>
            <option value="paid">Saldadas</option>
          </select>
        </div>

        <div className="pq-credit-table-wrap">
          <table className="pq-credit-table">
            <thead>
              <tr>
                <th>
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
                <th>Emisión</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="pq-credit-empty">No hay facturas que coincidan con los filtros.</td>
                </tr>
              ) : (
                filteredInvoices.map((item) => {
                  const itemOpen = isOpenCreditReceivable(item);
                  const selected = selectedIds.includes(item.order_id);
                  return (
                    <tr key={item.id || item.order_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!itemOpen || !item.order_id}
                          onChange={() => onToggleSelection(clientId, item.order_id)}
                          aria-label={`Seleccionar factura ${item.invoiceNumber}`}
                        />
                      </td>
                      <td>{item.invoiceNumber}</td>
                      <td>{item.order_id?.slice(0, 8) || "---"}</td>
                      <td>{formatCreditDate(item.creditIssuedAt)}</td>
                      <td><span className="pq-badge" style={getCreditReceivableStatusStyle(item.status)}>{getCreditReceivableStatusLabel(item.status)}</span></td>
                      <td>
                        <div className="pq-credit-actions">
                          {item.order && (
                            <button className="pq-icon-action" onClick={() => onViewOrder(item.order)} title="Ver orden">
                              <Icons.Eye />
                            </button>
                          )}
                          {itemOpen && (
                            <button className="pq-icon-action" onClick={() => onCreateReminder(group.client, [item])} title="Crear recordatorio">
                              <Icons.Clock />
                            </button>
                          )}
                          {itemOpen && (
                            <button
                              className="pq-icon-action success"
                              onClick={() => onSettle({
                                client: group.client,
                                orderIds: [item.order_id],
                                invoices: [item.invoiceNumber],
                                mode: "single",
                              })}
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

        <div className="pq-credit-detail-actions-bar">
          <span>{selectedIds.length} seleccionada{selectedIds.length === 1 ? "" : "s"}</span>
          <div>
            <button className="pq-btn pq-btn-secondary" onClick={() => onToggleAll(clientId, group.invoices)} disabled={openInvoices.length === 0}>
              {allOpenSelected ? "Limpiar selección" : "Seleccionar pendientes"}
            </button>
            <button
              className="pq-btn pq-btn-primary"
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
    </section>
  );
}

export default function PageQuote() {
  const navigate = useNavigate();
  const { user: authUser, profile: authProfile, signOut } = useAuth();

  // ============= ESTADOS GLOBALES DEL COMPONENTE =============
  // Estados de UI
  const [sidebarOpen, setSidebarOpen] = useState(true); // Control del menú lateral
  const [activeTab, setActiveTab] = useState("dashboard"); // Tab activo (dashboard, etc.)
  
  // Estados del usuario
  const [user, setUser] = useState(null); // Usuario autenticado
  const [profile, setProfile] = useState(null); // Perfil del usuario (nombre, rol, etc.)
  
  // Estados de órdenes
  const [orders, setOrders] = useState([]); // Lista de todas las órdenes asignadas al usuario
  const [loading, setLoading] = useState(true); // Indica si se están cargando órdenes
  const [selectedOrder, setSelectedOrder] = useState(null); // Orden actualmente abierta en el modal
  
  // Estados para archivo
  const [archivingOrder, setArchivingOrder] = useState(null); // Orden que se va a archivar
  const [archiveLoading, setArchiveLoading] = useState(false); // Indica si se está archivando
  
  // Estados para devolución
  const [returningOrder, setReturningOrder] = useState(null); // Orden que se va a devolver
  const [returnLoading, setReturnLoading] = useState(false); // Indica si se está devolviendo
  
  // Estados para envío a producción
  const [forwardToProductionOrder, setForwardToProductionOrder] = useState(null); // Orden que se enviará a producción
  const [productionSaving, setProductionSaving] = useState(false); // Indica si se está enviando a producción
  
  // Estados de pago
  const [paymentSaving, setPaymentSaving] = useState(false); // Indica si se está guardando pago
  
  // Estados de búsqueda y filtrado
  const [search, setSearch] = useState(""); // Texto de búsqueda
  const [filterStatus, setFilterStatus] = useState("all"); // Filtro por estado de orden
  const [filterDate, setFilterDate] = useState("all"); // Filtro por fecha
  const [filterClient, setFilterClient] = useState("all"); // Filtro por cliente registrado
  const [filterArchive, setFilterArchive] = useState("active"); // Mostrar activas o archivadas
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [clientInitialValues, setClientInitialValues] = useState(null);
  const [creditPendingOrder, setCreditPendingOrder] = useState(null);
  const [accountsReceivable, setAccountsReceivable] = useState([]);
  const [accountsReceivableLoading, setAccountsReceivableLoading] = useState(true);
  const [creditOrders, setCreditOrders] = useState([]);
  const [creditSearch, setCreditSearch] = useState("");
  const [creditStatusFilter, setCreditStatusFilter] = useState("open");
  const [creditView, setCreditView] = useState("list");
  const [creditDetailClientId, setCreditDetailClientId] = useState(null);
  const [selectedCreditOrderIds, setSelectedCreditOrderIds] = useState({});
  const [creditSettlementTarget, setCreditSettlementTarget] = useState(null);
  const [creditSettlementNotes, setCreditSettlementNotes] = useState("");
  const [creditSettlementLoading, setCreditSettlementLoading] = useState(false);
  const [creditCustomReminders, setCreditCustomReminders] = useState([]);
  const [creditCustomReminderLinks, setCreditCustomReminderLinks] = useState([]);
  const [creditReminderTarget, setCreditReminderTarget] = useState(null);
  const [creditReminderForm, setCreditReminderForm] = useState({ remind_at: "", note: "", orderIds: [] });
  const [creditReminderSaving, setCreditReminderSaving] = useState(false);
  const [creditReminderDismissedIds, setCreditReminderDismissedIds] = useState([]);
  const [creditReminderCompletingId, setCreditReminderCompletingId] = useState(null);
  const [creditReminderNow, setCreditReminderNow] = useState(null);
  const creditReminderServerClockRef = useRef(null);
  
  // Directorio de vendedores (cache para no hacer múltiples queries)
  const [sellerDirectory, setSellerDirectory] = useState({});

  // Paginación
  const [page, setPage] = useState(1);

  // Hook personalizado para notificaciones y alertas
  const notif = useNotifications(user?.id);

  // Referencias mutables para rastrear cambios sin causar re-renders
  const previousAssignedIdsRef = useRef(new Set());
  const previousOrdersRef = useRef({});
  const assignmentsInitializedRef = useRef(false);

  // ============= EFECTO 1: VALIDAR SESIÓN Y ROL =============
  // Se ejecuta una sola vez al montar el componente
  // Verifica que:
  // 1. El usuario esté autenticado
  // 2. El usuario tenga el rol "quote"
  // Si no cumple, lo redirige al login
  useEffect(() => {
    setUser(authUser || null);
    setProfile(authProfile || null);
  }, [authProfile, authUser]);

  const showCreditFeedback = useCallback((variant, title, message) => {
    showCreditActionFeedback(notif, {
      variant,
      title,
      message,
      eventKind: "quote_credit_feedback",
    });
  }, [notif]);

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const data = await loadClients(supabase);
      setClients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.warn("No se pudieron cargar clientes para caja:", error?.message || error);
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const fetchAccountsReceivable = useCallback(async () => {
    setAccountsReceivableLoading(true);
    try {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("*")
        .order("issued_at", { ascending: false });

      if (error) throw error;

      const receivables = Array.isArray(data) ? data : [];
      setAccountsReceivable(receivables);

      const orderIds = [...new Set(receivables.map(item => item.order_id).filter(Boolean))];
      if (orderIds.length === 0) {
        setCreditOrders([]);
        return;
      }

      const { data: creditOrderData, error: creditOrdersError } = await supabase
        .from("orders")
        .select("*, order_production_files(*)")
        .in("id", orderIds);

      if (creditOrdersError) {
        console.warn("No se pudieron cargar ordenes asociadas a credito:", creditOrdersError?.message || creditOrdersError);
        setCreditOrders([]);
        return;
      }

      setCreditOrders(Array.isArray(creditOrderData) ? creditOrderData : []);
    } catch (error) {
      console.warn("No se pudieron cargar cuentas por cobrar para caja:", error?.message || error);
      setAccountsReceivable([]);
      setCreditOrders([]);
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
        console.warn("No se pudieron cargar recordatorios de credito en caja:", error?.message || error);
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
        console.warn("No se pudieron emitir notificaciones de recordatorios en caja:", error?.message || error);
      }
    }
  }, [user?.id]);

  const syncCreditReminderServerTime = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_server_time");
    if (error) {
      console.warn("No se pudo sincronizar la hora del servidor para recordatorios de caja:", error.message || error);
      return null;
    }

    const serverTimeValue = Array.isArray(data) ? data[0] : data;
    const serverNowMs = new Date(serverTimeValue).getTime();
    if (!Number.isFinite(serverNowMs)) {
      console.warn("La hora del servidor para recordatorios de caja no es valida:", serverTimeValue);
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
    fetchClients();
  }, [fetchClients]);

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

  const fetchOrders = async (...args) => fetchOrdersImpl(...args);
  const fetchOrdersRef = useRef(fetchOrders);

  useEffect(() => {
    fetchOrdersRef.current = fetchOrders;
  });

  const applyCreditToOrder = async (order) => {
    if (!order?.client_id) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Cliente requerido",
        orderTitle: order?.client_name || order?.description || `Orden #${order?.id?.slice(0, 8).toUpperCase()}`,
        message: "Para crear una orden a crédito, el cliente debe estar registrado.",
      });
      return { ok: false };
    }

    setPaymentSaving(true);
    const { data: updatedOrder, error } = await supabase
      .rpc("mark_order_as_credit", { p_order_id: order.id, p_due_date: null });
    setPaymentSaving(false);

    if (error || !updatedOrder) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Crédito no aprobado",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: error?.message || "No se pudo aprobar el pago a crédito.",
      });
      return { ok: false };
    }

    setOrders(prev => prev.map(item => item.id === updatedOrder.id ? updatedOrder : item));
    setSelectedOrder(updatedOrder);
    await fetchAccountsReceivable();
    return { ok: true, order: updatedOrder };
  };

  const openCreditClientRegistration = (order) => {
    setCreditPendingOrder(order);
    setClientInitialValues({
      name: order?.client_name || "",
      phone: order?.client_contact || order?.client_phone || "",
      email: order?.client_email || "",
      address: order?.client_address || "",
      notes: "",
    });
    setShowNewClientModal(true);
  };

  const handleNewClientCreated = async (newClient, options = {}) => {
    setClients(prev => {
      const exists = prev.some(c => c.id === newClient.id);
      return exists ? prev : [...prev, newClient].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    notif.showActionNotification({
      type: "info",
      title: options.reusedExisting ? "Cliente vinculado" : "Cliente registrado",
      message: options.reusedExisting
        ? `Cliente "${newClient.name}" encontrado y vinculado correctamente.`
        : `Cliente "${newClient.name}" registrado correctamente.`,
      metadata: { event_kind: options.reusedExisting ? "client_reused" : "client_created", client_id: newClient.id, variant: "success" },
    });

    if (!creditPendingOrder?.id) return;

    const orderToLink = orders.find(item => item.id === creditPendingOrder.id) || selectedOrder || creditPendingOrder;
    if (orderToLink?.client_id === newClient.id) {
      setCreditPendingOrder(null);
      setClientInitialValues(null);
      setSelectedOrder(orderToLink);
      return;
    }

    if (orderToLink?.client_id) {
      setCreditPendingOrder(null);
      setClientInitialValues(null);
      setSelectedOrder(orderToLink);
      notif.showActionNotification({
        type: "info",
        label: "Cliente ya vinculado",
        orderTitle: orderToLink.client_name || orderToLink.description || `Orden #${orderToLink.id?.slice(0, 8).toUpperCase()}`,
        message: "La orden ya fue vinculada a un cliente registrado.",
      });
      return;
    }

    const { data: linkedOrder, error } = await supabase
      .from("orders")
      .update({
        client_id: newClient.id,
        client_name: newClient.name || orderToLink.client_name,
        client_contact: newClient.phone || orderToLink.client_contact || null,
      })
      .eq("id", orderToLink.id)
      .select("*, order_production_files(*)")
      .single();

    if (error || !linkedOrder) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Cliente no vinculado",
        orderTitle: creditPendingOrder.client_name || creditPendingOrder.description || `Orden #${creditPendingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: error?.message || "El cliente se creó, pero no se pudo vincular la orden.",
      });
      return;
    }

    setOrders(prev => prev.map(item => item.id === linkedOrder.id ? linkedOrder : item));
    setSelectedOrder(linkedOrder);
    setCreditPendingOrder(null);
    setClientInitialValues(null);
  };

  // ============= EFECTO 2: SUSCRIPCIÓN EN TIEMPO REAL Y REFRESCO =============
  // Se ejecuta cuando el user cambia
  // Este es el corazón del sistema de actualización en tiempo real:
  // 1. Carga las órdenes asignadas al usuario
  // 2. Se suscribe a cambios en la tabla "orders"
  // 3. Si una orden asignada a este usuario cambia, recarga la lista
  // 4. Si la página pierde y recupera el foco, recarga las órdenes
  // Esto asegura que el usuario siempre vea datos actualizados sin necesidad de F5
  useEffect(() => {
    if (!user?.id) return undefined;

    // Carga inicial de órdenes
    fetchOrdersRef.current(user.id);
    fetchClients();
    fetchAccountsReceivable();
    dispatchDueCreditReminderNotifications();
    fetchCreditCustomReminders();
    
    // SUSCRIPCIÓN EN TIEMPO REAL: escucha cambios en la tabla "orders"
    const channel = supabase
      .channel(`quote-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        async (payload) => {
          const nextOrder = payload.new;
          const previousOrder = payload.old;
          fetchAccountsReceivable();

          // Solo recarga si la orden cambió pertenece a este usuario
          if (
            isOrderAssignedToQuote(nextOrder, user.id)
            || isOrderAssignedToQuote(previousOrder, user.id)
          ) {
            await fetchOrdersRef.current(user.id, true); // true = sin mostrar loading spinner
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts_receivable" },
        () => {
          fetchAccountsReceivable();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients" },
        () => {
          fetchClients();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_custom_reminders" },
        () => {
          fetchCreditCustomReminders();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_custom_reminder_orders" },
        () => {
          fetchCreditCustomReminders();
        }
      )
      .subscribe();

    // LIMPIEZA: desuscribirse de Supabase y remover listeners al desmontar
    return () => {
      supabase.removeChannel(channel);
    };
  }, [dispatchDueCreditReminderNotifications, fetchAccountsReceivable, fetchClients, fetchCreditCustomReminders, user?.id]);


  // ============= EFECTO 3: SINCRONIZAR ORDEN SELECCIONADA =============
  // Mantiene el modal actualizado si la orden cambia en tiempo real
  // Si la orden abierta en el modal se actualiza en la BD, refleja los cambios
  useEffect(() => {
    if (!selectedOrder) return;
    const freshOrder = [...orders, ...creditOrders].find(o => o.id === selectedOrder.id);
    if (freshOrder) {
      setSelectedOrder(freshOrder); // Actualiza los datos del modal sin cerrarlo
    }
  }, [creditOrders, orders, selectedOrder]);

  // ============= FUNCIÓN: SINCRONIZAR DIRECTORIO DE VENDEDORES =============
  // Carga los nombres de los vendedores desde la tabla "profiles"
  // Evita múltiples queries a BD usando un cache (sellerDirectory)
  // Se ejecuta automáticamente después de cargar órdenes
  const syncSellerDirectory = async (ordersToSync) => {
    // Extrae IDs únicos de vendedores de las órdenes
    const sellerIds = [...new Set(
      (ordersToSync || [])
        .map(order => resolveSellerId(order))
        .filter(Boolean)
    )];

    if (sellerIds.length === 0) return;

    // Solo consulta vendedores que aún no están en el cache
    const missingSellerIds = sellerIds.filter(id => !sellerDirectory[id]);
    if (missingSellerIds.length === 0) return;

    // Query a BD para obtener nombres de vendedores
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", missingSellerIds);

    if (!error && Array.isArray(data)) {
      // Actualiza el cache con los nuevos vendedores
      setSellerDirectory(prev => ({
        ...prev,
        ...Object.fromEntries(data.map(profile => [profile.id, profile.name || "Vendedor"]))
      }));
    }
  };

  // ============= FUNCIÓN: CARGAR ÓRDENES DEL USUARIO =============
  async function fetchOrdersImpl(quoteUserId, silent = false) {
    if (!silent) setLoading(true);

    let fetchedOrders = [];
    let fetchError = null;

    const { data, error } = await supabase
      .from("orders")
      .select("*, order_production_files(*)")
      .eq("quote_id", quoteUserId)
      .order("created_at", { ascending: false });

    if (!error) {
      fetchedOrders = (data || []).filter(order => isOrderAssignedToQuote(order, quoteUserId));
    } else {
      fetchError = error;
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("orders")
        .select("*, order_production_files(*)")
        .order("created_at", { ascending: false });

      if (!fallbackError) {
        fetchedOrders = (fallbackData || []).filter(order => isOrderAssignedToQuote(order, quoteUserId));
        fetchError = null;
      }
    }

    if (fetchError) {
      setOrders([]);
      if (!silent) setLoading(false);
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al cargar",
        orderTitle: "Órdenes de caja",
        message: "No se pudieron cargar las órdenes asignadas a caja.",
      });
      return;
    }

    setOrders(fetchedOrders);
    await syncSellerDirectory(fetchedOrders);
    registerNewAssignments(fetchedOrders);
    if (!silent) setLoading(false);
  }

  // ============= FUNCIÓN: REGISTRAR NUEVAS ASIGNACIONES =============
  // Mantiene el seguimiento local de qué órdenes se han visto
  // Se usa para detectar cambios sin hacer queries constantes a BD
  // Las notificaciones de cambios las maneja Supabase en tiempo real
  const registerNewAssignments = (nextOrders) => {
    const nextIds = new Set(nextOrders.map(order => order.id));

    // INICIALIZACIÓN (primera carga)
    if (!assignmentsInitializedRef.current) {
      previousAssignedIdsRef.current = nextIds;
      previousOrdersRef.current = nextOrders.reduce((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      assignmentsInitializedRef.current = true;
      return;
    }

    // ACTUALIZACIONES POSTERIORES
    previousAssignedIdsRef.current = nextIds;
    previousOrdersRef.current = nextOrders.reduce((acc, order) => {
      acc[order.id] = order;
      return acc;
    }, {});
  };



  // ============= FUNCIÓN: ABRIR DETALLE DE ORDEN =============
  // Se ejecuta cuando el usuario hace click en una orden
  // Refresca los datos desde BD antes de abrir el modal (asegura que siempre esté actualizado)
  const handleViewOrder = async (order) => {
    const { data } = await supabase
      .from("orders")
      .select("*, order_production_files(*)")
      .eq("id", order.id)
      .single();

    const nextOrder = data || order;
    await syncSellerDirectory([nextOrder]);
    setSelectedOrder(nextOrder);
  };

  // ============= FUNCIÓN: CONFIRMAR PAGO DE ORDEN =============
  // Este es uno de los procesos más complejos:
  // 1. Valida que se haya subido un recibo si el pago es "Pagado"
  // 2. Valida que la imagen sea JPG o PNG válida
  // 3. Sube la imagen a Supabase Storage
  // 4. Actualiza la BD con el nuevo estado de pago y URL del recibo
  // 5. Notifica al usuario del resultado
  const handleConfirmPayment = async ({ order, receiptFile, paymentStatus }) => {
    // Validación inicial: si es pagado, debe haber recibo
    if (isPaymentPartial(order?.payment_status) && paymentStatus === PAYMENT_STATUS.PENDING) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Cambio no permitido",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.",
      });
      return { ok: false };
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      if (!String(order?.invoice_number || "").trim()) {
        notif.showActionNotification({
          type: "order_cancelled",
          label: "Facturacion requerida",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message: "La orden debe tener un numero de facturacion para vender a credito.",
        });
        return { ok: false };
      }

      if (!order?.client_id) {
        notif.showActionNotification({
          type: "order_cancelled",
          label: "Cliente requerido",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message: "Para crear una orden a crédito, el cliente debe estar registrado.",
        });
        return { ok: false };
      }

      return applyCreditToOrder(order);
    }

    if (paymentStatus === PAYMENT_STATUS.PAID && !receiptFile) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Imagen requerida",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: "No puedes confirmar el pago sin subir la imagen del recibo o factura.",
      });
      return { ok: false };
    }

    setPaymentSaving(true);

    let invoicePaymentUrl = null;

    // PASO 1: Si hay archivo, validar formato y subir a Storage
    if (receiptFile) {
      // Validar que sea una imagen válida (JPG/PNG, tamaño razonable)
      const validation = await validateReceiptFile(receiptFile);

      if (!validation.isValid) {
        const message = validation.error || "La imagen no cumple con los requisitos. Asegurate de que sea una imagen valida.";
        setPaymentSaving(false);
        notif.showActionNotification({
          type: "order_cancelled",
          label: "Imagen inválida",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message,
        });
        return { ok: false, receiptError: message };
      }

      // Construir ruta: /order-{orderId}/payment-{timestamp}.jpg
      const filePath = buildPaymentReceiptPath(order.id, receiptFile.name);

      try {
        // Subir a Storage en el bucket "payment-invoice" (compartido con módulo Admin)
        invoicePaymentUrl = await uploadOrderAsset({
          bucket: "payment-invoice",
          path: filePath,
          file: receiptFile,
        });

        if (!invoicePaymentUrl) {
          const message = "No se pudo obtener la URL de la imagen. Intentalo nuevamente.";
          setPaymentSaving(false);
          notif.showActionNotification({
            type: "order_cancelled",
            label: "Error al subir",
            orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
            message,
          });
          return { ok: false, receiptError: message };
        }
      } catch (uploadError) {
        const message = uploadError?.message || "No se pudo subir la imagen del comprobante. Intentalo nuevamente.";
        console.error("Error uploading image:", uploadError);
        setPaymentSaving(false);
        notif.showActionNotification({
          type: "order_cancelled",
          label: "Error al subir",
          orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
          message,
        });
        return { ok: false, receiptError: message };
      }
    }

    // PASO 2: Actualizar BD con nuevo estado de pago
    // El campo "invoice_payment" es estándar y se usa en Admin también
    const updatePayload = {
      payment_status: paymentStatus,
    };

    if (paymentStatus === PAYMENT_STATUS.PARTIAL) {
      updatePayload[INVOICE_PAYMENT_FIELD] = null;
    }

    // Solo incluir invoice_payment si hay URL final de pago completo
    if (invoicePaymentUrl) {
      updatePayload[INVOICE_PAYMENT_FIELD] = invoicePaymentUrl;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id)
      .select("*, order_production_files(*)")
      .single();

    setPaymentSaving(false);

    // Manejar errores de actualización
    if (updateError || !updatedOrder) {
      console.error("Error updating order:", updateError);
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al confirmar",
        orderTitle: order.client_name || order.description || `Orden #${order.id?.slice(0, 8).toUpperCase()}`,
        message: updateError?.message || "No se pudo guardar los cambios de pago. Verifica la conexión a la base de datos.",
      });
      return;
    }

    // Actualiza estado local con los nuevos datos
    setOrders(prev => prev.map(item => item.id === updatedOrder.id ? updatedOrder : item));
    setSelectedOrder(updatedOrder);
    return { ok: true };

  };

  // Muestra un toast de error cuando el usuario intenta confirmar el pago
  // sin haber seleccionado una imagen de comprobante.
  // Se dispara desde QuoteOrderDetailModal.handleSubmit
  const handlePaymentValidationError = (order, message) => {
    notif.showActionNotification({
      type: "order_cancelled",
      label: "Validación requerida",
      orderTitle: order?.client_name || order?.description || `Orden #${order?.id?.slice(0, 8).toUpperCase()}`,
      message,
    });
  };

  // Abre el modal para seleccionar un impresor antes de enviar a producción.
  const handleOpenProductionModal = (order) => {
    setForwardToProductionOrder(order);
  };

  // Envía la orden a producción asignándola al impresor seleccionado.
  const handleConfirmSendToProduction = async (areaAssignments) => {
    if (!forwardToProductionOrder) return;

    setProductionSaving(true);

    const { data: updatedOrder, error } = await supabase
      .rpc("send_order_to_production", {
        p_order_id: forwardToProductionOrder.id,
        p_area_assignments: areaAssignments,
      });

    setProductionSaving(false);

    if (error || !updatedOrder) {
      console.error("Error moving to production:", error);
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al enviar",
        orderTitle: forwardToProductionOrder.client_name || forwardToProductionOrder.description || `Orden #${forwardToProductionOrder.id?.slice(0, 8).toUpperCase()}`,
        message: error?.message || "No se pudo enviar la orden a producción.",
      });
      return;
    }

    const nextOrder = {
      ...forwardToProductionOrder,
      ...updatedOrder,
      order_production_files: updatedOrder.order_production_files || forwardToProductionOrder.order_production_files,
    };

    setOrders(prev => prev.map(item => item.id === nextOrder.id ? { ...item, ...nextOrder } : item));
    setSelectedOrder(nextOrder);
    setForwardToProductionOrder(null);
    if (user?.id) {
      await fetchOrdersRef.current(user.id, true);
    }
  };

  // Archiva órdenes en el campo específico del rol Quote.
  const handleConfirmArchive = async () => {
    if (!archivingOrder) return;
    if (!canArchiveQuoteOrder(archivingOrder, user?.id)) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Archivado no permitido",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "Solo puedes archivar órdenes con el pago confirmado.",
      });
      return;
    }

    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.QUOTE);
    setArchiveLoading(false);

    if (error) {
      notif.showActionNotification({
        type: "order_cancelled",
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

    setArchivingOrder(null);
  };

  // Devuelve una orden al diseñador para correcciones.
  const handleConfirmReturn = async (reason) => {
    if (!returningOrder) return;

    setReturnLoading(true);
    const isExternalDesign = returningOrder.order_design_type === "EXTERNAL_DESING";
    const nextStatus = isExternalDesign ? ORDER_STATUS.PENDING : ORDER_STATUS.IN_DESIGN;
    const returnedAt = new Date().toISOString();

    const { error } = await supabase
      .from("orders")
      .update({
        status: nextStatus,
        return_reason: reason,
        returned_to_designer_at: returnedAt,
      })
      .eq("id", returningOrder.id);

    setReturnLoading(false);

    if (error) {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al devolver",
        orderTitle: returningOrder.client_name || returningOrder.description || `Orden #${returningOrder.id?.slice(0, 8).toUpperCase()}`,
        message: isExternalDesign
          ? "No se pudo devolver la orden al vendedor."
          : "No se pudo devolver la orden al diseñador.",
      });
      return;
    }

    const nextOrder = {
      ...returningOrder,
      status: nextStatus,
      return_reason: reason,
      returned_to_designer_at: returnedAt,
    };
    setOrders(prev => (
      isExternalDesign
        ? prev.filter(order => order.id !== returningOrder.id)
        : prev.map(order => order.id === returningOrder.id ? nextOrder : order)
    ));
    if (selectedOrder?.id === returningOrder.id) {
      setSelectedOrder(nextOrder);
    }

    setReturningOrder(null);
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  // Filtros principales del módulo, alineados con la lógica de Designer.
  const quoteCreditOrdersById = useMemo(() => {
    const byId = new Map();
    [...creditOrders, ...orders].forEach((order) => {
      if (order?.id) byId.set(order.id, order);
    });
    return Object.fromEntries(byId);
  }, [creditOrders, orders]);

  const clientsById = useMemo(() => Object.fromEntries(clients.map(client => [client.id, client])), [clients]);
  const accountsReceivableById = useMemo(() => Object.fromEntries(accountsReceivable.map(item => [item.id, item])), [accountsReceivable]);
  const accountsReceivableByOrderId = useMemo(() => Object.fromEntries(accountsReceivable.filter(item => item.order_id).map(item => [item.order_id, item])), [accountsReceivable]);

  const creditRows = useMemo(() => (
    accountsReceivable
      .filter(item => item?.client_id)
      .map(item => {
        const order = quoteCreditOrdersById[item.order_id] || null;
        const client = clientsById[item.client_id] || null;
        return {
          ...item,
          order,
          client,
          clientName: client?.name || order?.client_name || "Cliente sin nombre",
          clientPhone: client?.phone || order?.client_contact || "---",
          invoiceNumber: item.invoice_number || order?.invoice_number || "---",
          creditIssuedAt: getCreditIssuedAt({ ...item, order }),
        };
      })
  ), [accountsReceivable, clientsById, quoteCreditOrdersById]);

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

  const allCreditClientGroups = useMemo(() => buildCreditClientGroups(creditRows), [buildCreditClientGroups, creditRows]);

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

  const creditCustomReminderRows = useMemo(() => (
    creditCustomReminders.map((reminder) => {
      const links = creditCustomReminderLinks.filter((link) => link.reminder_id === reminder.id);
      const client = clientsById[reminder.client_id] || { id: reminder.client_id, name: "Cliente sin nombre", phone: "" };
      const invoices = links.map((link) => {
        const receivable = accountsReceivableById[link.accounts_receivable_id] || accountsReceivableByOrderId[link.order_id] || null;
        const order = quoteCreditOrdersById[link.order_id] || (receivable?.order_id ? quoteCreditOrdersById[receivable.order_id] : null);
        return {
          ...link,
          receivable,
          order,
          invoiceNumber: receivable?.invoice_number || order?.invoice_number || "---",
        };
      });

      return { ...reminder, client, invoices };
    })
  ), [accountsReceivableById, accountsReceivableByOrderId, clientsById, creditCustomReminderLinks, creditCustomReminders, quoteCreditOrdersById]);

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

    const delay = Math.min(Math.max(nextReminderTime - serverNow + 250, 0), CREDIT_REMINDER_MAX_TIMEOUT_MS);
    const timeout = setTimeout(async () => {
      await syncCreditReminderServerTime();
      await dispatchDueCreditReminderNotifications();
      fetchCreditCustomReminders();
    }, delay);

    return () => clearTimeout(timeout);
  }, [creditCustomReminderRows, creditReminderDismissedIds, creditReminderNow, dispatchDueCreditReminderNotifications, fetchCreditCustomReminders, syncCreditReminderServerTime]);

  const openCreditOrderIds = useMemo(() => new Set(
    creditRows.filter(item => isOpenCreditReceivable(item) && item.order_id).map(item => item.order_id)
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

  const openCreditSettlementModal = ({ client, orderIds, invoices, mode }) => {
    const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];
    if (uniqueOrderIds.length === 0) {
      showCreditFeedback("error", "Sin facturas pendientes", "No hay facturas pendientes para cerrar.");
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

  const handleConfirmCreditSettlement = async () => {
    const target = creditSettlementTarget;
    if (!target) return;

    setCreditSettlementLoading(true);
    const { error } = await supabase.rpc("settle_credit_orders", {
      p_order_ids: target.orderIds,
      p_receipt_url: null,
      p_notes: creditSettlementNotes || null,
    });
    setCreditSettlementLoading(false);

    if (error) {
      showCreditFeedback("error", "Crédito no cerrado", error.message || "No se pudo registrar el cierre del crédito.");
      return;
    }

    if (target.client?.id) {
      setSelectedCreditOrderIds(prev => ({ ...prev, [target.client.id]: [] }));
    }
    setCreditSettlementTarget(null);
    setCreditSettlementNotes("");
    await Promise.all([fetchOrdersRef.current(user?.id, true), fetchAccountsReceivable()]);
    showCreditFeedback("success", "Crédito saldado", target.orderIds.length === 1 ? "Factura marcada como saldada correctamente." : "Facturas marcadas como saldadas correctamente.");
  };

  const openCreditReminderModal = (client, invoices = []) => {
    if (!client?.id) {
      showCreditFeedback("error", "Cliente requerido", "Selecciona un cliente válido para crear el recordatorio.");
      return;
    }

    const openInvoices = invoices.filter(item => isOpenCreditReceivable(item) && item.order_id);
    const serverNow = getCreditReminderServerNow(creditReminderServerClockRef.current) ?? creditReminderNow;
    setCreditReminderTarget({ client, invoices: openInvoices });
    setCreditReminderForm({
      remind_at: getDefaultCreditReminderAt(serverNow),
      note: "",
      orderIds: [...new Set(openInvoices.map(item => item.order_id).filter(Boolean))],
    });
  };

  const closeCreditReminderModal = () => {
    setCreditReminderTarget(null);
    setCreditReminderForm({ remind_at: "", note: "", orderIds: [] });
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
      showCreditFeedback("error", "Sesión no válida", "No se pudo identificar el usuario actual.");
      return;
    }
    if (!creditReminderTarget?.client?.id) {
      showCreditFeedback("error", "Cliente requerido", "Selecciona un cliente para el recordatorio.");
      return;
    }

    const validSelectedOrderIds = [...new Set(creditReminderForm.orderIds || [])].filter((orderId) => {
      const invoice = (creditReminderTarget.invoices || []).find(item => item.order_id === orderId);
      return invoice?.order_id && isOpenCreditReceivable(invoice);
    });
    if (validSelectedOrderIds.length === 0) {
      showCreditFeedback("error", "Orden a crédito requerida", "Los recordatorios personalizados solo pueden crearse para órdenes a crédito.");
      return;
    }

    const reminderNote = (creditReminderForm.note || "").trim();
    if (!reminderNote) {
      showCreditFeedback("error", "Nota requerida", "Describe la razón del recordatorio antes de continuar.");
      return;
    }

    const reminderAtValue = (creditReminderForm.remind_at || "").trim();
    if (!reminderAtValue) {
      showCreditFeedback("error", "Fecha requerida", "Selecciona una fecha antes de continuar.");
      return;
    }

    const remindAtMs = zonedDatetimeLocalToUtcMs(reminderAtValue, CREDIT_REMINDER_TIME_ZONE);
    if (!Number.isFinite(remindAtMs)) {
      showCreditFeedback("error", "Fecha inválida", "La fecha del recordatorio no es válida.");
      return;
    }

    const serverClock = await syncCreditReminderServerTime();
    if (!serverClock) {
      showCreditFeedback("error", "Hora no validada", "No se pudo validar la hora del servidor. Intenta nuevamente.");
      return;
    }

    const serverNowMs = getCreditReminderServerNow(serverClock);
    if (serverNowMs !== null && remindAtMs <= serverNowMs) {
      showCreditFeedback("error", "Fecha futura requerida", "Selecciona una fecha y hora futura para el recordatorio.");
      return;
    }

    setCreditReminderSaving(true);
    try {
      const { error } = await supabase.rpc("create_credit_custom_reminder", {
        p_client_id: creditReminderTarget.client.id,
        p_remind_at: new Date(remindAtMs).toISOString(),
        p_note: reminderNote,
        p_order_ids: validSelectedOrderIds,
        p_visibility_scope: "creator",
      });

      if (error) throw error;

      closeCreditReminderModal();
      await syncCreditReminderServerTime();
      await fetchCreditCustomReminders();
      showCreditFeedback("success", "Recordatorio creado", "Recordatorio de crédito creado correctamente.");
    } catch (error) {
      showCreditFeedback("error", "Recordatorio no creado", error?.message || "No se pudo crear el recordatorio.");
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
      showCreditFeedback("error", "Recordatorio no actualizado", error?.message || "No se pudo marcar el recordatorio.");
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
        order.invoice_number,
        order.id,
        order.material,
        resolveSellerName(order, sellerDirectory),
      ];

      const matchesSearch = !query || searchableValues.some(value => normalizeText(value).includes(query));
      const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
      const matchesClient = orderMatchesClientFilter(order, filterClient);
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

      return matchesSearch && matchesStatus && matchesClient && matchesArchive && matchesDate;
    });
  }, [orders, search, filterStatus, filterClient, filterArchive, filterDate, sellerDirectory]);

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const metrics = [
    { label: "Órdenes asignadas", value: orders.length, icon: <Icons.Orders /> },
    { label: "Pendientes de pago", value: orders.filter(order => order.payment_status !== "pagado" && !order.is_archived_quote).length, icon: <Icons.Money /> },
    { label: "Pagadas", value: orders.filter(order => order.payment_status === "pagado").length, icon: <Icons.Check /> },
    { label: "Crédito pendiente", value: accountsReceivableLoading ? "..." : creditPendingInvoicesCount, icon: <Icons.Receipt /> },
    { label: "Archivadas", value: orders.filter(order => order.is_archived_quote).length, icon: <Icons.Archive /> },
  ];

  const getSidebarBadge = (isLoading, value) => (isLoading ? "..." : value);

  const menuItems = [
    { id: "dashboard", label: "Resumen", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Mis órdenes", icon: <Icons.Orders />, badge: getSidebarBadge(loading, orders.filter(order => !order.is_archived_quote).length) },
    { id: "credits", label: "Créditos", icon: <Icons.Receipt />, badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount) },
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
        role="Caja"
        userName={profile?.name || "Usuario Caja"}
        menuItems={menuItems}
        onLogout={handleLogout}
      />

      <main className="pq-main">
        <header className="pq-header">
          <div className="pq-header-left">
            <button className="pq-mobile-toggle" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Toggle sidebar">
              <Icons.Menu />
            </button>
            <div>
              
              {/* Nombre del apartado de la pantalla */}
              <h1 className="pq-header-title">
                {activeTab === "dashboard" ? "Panel de Caja" : activeTab === "credits" ? "Gestión de Créditos" : "Mis órdenes de caja"}
              </h1>
            </div>
          </div>

          <div className="pq-header-actions">
            <button className="pq-header-client-btn" onClick={() => setShowNewClientModal(true)} title="Agregar nuevo cliente">
              <Icons.Plus /> Nuevo Cliente
            </button>
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
          </div>
        </header>

        {activeTab === "dashboard" && (
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
                  <h2>Órdenes para Caja <span className="pq-orders-count">({dashboardRecentOrders.length})</span></h2>
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
                          {isReturnedOrder(order) && <ReturnedBadge compact />}
                          <StatusBadge status={order.status} className="pq-badge" />
                          <PaymentBadge status={order.payment_status} className="pq-badge" />
                        </div>
                        <span className="pq-recent-view-btn" aria-hidden="true">
                          <Icons.Eye />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {activeTab === "credits" && creditView === "list" && (
          <section className="pq-section pq-credit-section">
            <div className="pq-filters">
              <div className="pq-search-box">
                <Icons.Search />
                <input
                  type="text"
                  className="pq-search-input"
                  placeholder="Buscar por cliente, teléfono, factura u orden..."
                  value={creditSearch}
                  onChange={event => setCreditSearch(event.target.value)}
                />
              </div>
              <select className="pq-input" value={creditStatusFilter} onChange={event => setCreditStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="open">Pendientes</option>
                <option value="paid">Saldadas</option>
              </select>
              <span className="pq-results-count">{creditClientGroups.length} cliente{creditClientGroups.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="pq-credit-metrics" aria-label="Resumen de créditos">
              <article className="pq-credit-summary-card">
                <span className="pq-credit-summary-icon client"><Icons.User /></span>
                <div><strong>{creditClientGroups.length}</strong><span>Clientes filtrados</span></div>
              </article>
              <article className="pq-credit-summary-card">
                <span className="pq-credit-summary-icon pending"><Icons.Receipt /></span>
                <div><strong>{creditPendingInvoicesCount}</strong><span>Pendientes</span></div>
              </article>
              <article className="pq-credit-summary-card">
                <span className="pq-credit-summary-icon followup"><Icons.AlertCircle /></span>
                <div><strong>{creditPendingClientCount}</strong><span>Clientes con pendientes</span></div>
              </article>
            </div>

            {creditPendingInvoicesCount > 0 && (
              <div className="pq-credit-pending-banner" role="status">
                <span className="pq-credit-pending-banner-icon"><Icons.AlertCircle /></span>
                <div>
                  <strong>{creditPendingInvoicesCount} factura{creditPendingInvoicesCount === 1 ? "" : "s"} a crédito pendiente{creditPendingInvoicesCount === 1 ? "" : "s"}</strong>
                  <span>{creditPendingClientCount} cliente{creditPendingClientCount === 1 ? "" : "s"} requiere{creditPendingClientCount === 1 ? "" : "n"} seguimiento de Caja.</span>
                </div>
                <button className="pq-btn pq-btn-secondary" onClick={() => setCreditStatusFilter("open")}>
                  Revisar créditos pendientes
                </button>
              </div>
            )}

            <div className="pq-panel pq-credit-panel">
              <div className="pq-panel-head">
                <div>
                  <span className="pq-section-kicker">Seguimiento</span>
                  <h2>Créditos agrupados por cliente</h2>
                </div>
                <span className="pq-orders-count">{creditClientGroups.length} cliente{creditClientGroups.length === 1 ? "" : "s"}</span>
              </div>

              <div className="pq-credit-table-wrap">
                <table className="pq-credit-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Facturas</th>
                      <th>Fechas</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsReceivableLoading || clientsLoading ? (
                      <tr>
                        <td colSpan={5} className="pq-credit-empty">Cargando créditos...</td>
                      </tr>
                    ) : creditClientGroups.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="pq-credit-empty">No hay créditos que coincidan con los filtros.</td>
                      </tr>
                    ) : (
                      creditClientGroups.map(group => {
                        const clientId = group.client?.id;
                        const openInvoices = group.invoices.filter(item => isOpenCreditReceivable(item));
                        const openClientDetail = () => {
                          if (!clientId) return;
                          setCreditDetailClientId(clientId);
                          setCreditView("detail");
                        };
                        const handleClientRowKeyDown = (event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          openClientDetail();
                        };
                        return (
                          <tr
                            key={clientId}
                            className="pq-credit-client-row"
                            onClick={openClientDetail}
                            onKeyDown={handleClientRowKeyDown}
                            role="button"
                            tabIndex={0}
                            aria-label={`Ver facturas de ${group.client?.name || "cliente sin nombre"}`}
                          >
                            <td>
                              <div className="pq-credit-client-cell">
                                <strong>{group.client?.name || "Cliente sin nombre"}</strong>
                                <span>{group.client?.phone || "Sin telefono"}</span>
                              </div>
                            </td>
                            <td>
                              <span className="pq-badge" style={getCreditReceivableStatusStyle(openInvoices.length > 0 ? "open" : "paid")}>
                                {group.pendingCount} factura{group.pendingCount === 1 ? "" : "s"}
                              </span>
                            </td>
                            <td>
                              <div className="pq-credit-date-stack">
                                <span>Antigua: <strong>{formatCreditDate(group.oldestIssuedAt)}</strong></span>
                                <span>Reciente: <strong>{formatCreditDate(group.newestIssuedAt)}</strong></span>
                              </div>
                            </td>
                            <td>
                              <span className="pq-badge" style={group.pendingCount > 0 ? getCreditReceivableStatusStyle("open") : getCreditReceivableStatusStyle("paid")}>
                                {group.pendingCount > 0 ? "Con saldo pendiente" : "Sin pendientes"}
                              </span>
                            </td>
                            <td>
                              <div className="pq-credit-actions">
                                <button
                                  className="pq-icon-action"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openClientDetail();
                                  }}
                                  title="Ver facturas del cliente"
                                >
                                  <Icons.Eye />
                                </button>
                                {openInvoices.length > 0 && (
                                  <button
                                    className="pq-icon-action"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCreditReminderModal(group.client, openInvoices);
                                    }}
                                    title="Crear recordatorio"
                                  >
                                    <Icons.Clock />
                                  </button>
                                )}
                                {openInvoices.length > 0 && (
                                  <button
                                    className="pq-icon-action success"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCreditSettlementModal({
                                        client: group.client,
                                        orderIds: openInvoices.map((item) => item.order_id),
                                        invoices: openInvoices.map((item) => item.invoiceNumber),
                                        mode: "all",
                                      });
                                    }}
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
          />
        )}

        {activeTab === "orders" && (
          // Vista de listado principal de órdenes, con filtros y búsqueda.
          <section className="pq-section">
            {/* Filtros y búsqueda */}
            <div className="pq-filters">
              <div className="pq-search-box">
                <Icons.Search />
                <input
                  type="text"
                  className="pq-search-input"
                  placeholder="Buscar por cliente, facturacion, ID, vendedor o descripcion..."
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </div>

              <select className="pq-input" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
                <option value="all">Todos los estados</option>
                {STATUS_OPTIONS.map(status => (
                  <option key={status} value={status}>{getOrderStatusConfig(status).label}</option>
                ))}
              </select>

              <select className="pq-input" value={filterDate} onChange={event => setFilterDate(event.target.value)}>
                <option value="all">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="yesterday">Ayer</option>
                <option value="3days">Últimos 3 días</option>
                <option value="7days">Últimos 7 días</option>
                <option value="month">Este mes</option>
              </select>

              <ClientFilterSelect
                clients={clients}
                value={filterClient}
                onChange={setFilterClient}
                className="pq-input"
                allLabel="Todos los clientes"
              />



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
              <div className="pq-orders-grid">
                {paginatedOrders.map(order => (
                  <article key={order.id} className="pq-order-card">
                    <div className="pq-order-top">
                      <div className="pq-order-identity">
                        <span className="pq-order-id">#{order.id ? order.id.slice(0, 8).toUpperCase() : "---"}</span>
                        <span className="pq-order-date">
                          <Icons.Clock /> {order.created_at ? new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "---"}
                        </span>
                      </div>
                      <div className="pq-order-badges">
                        {isReturnedOrder(order) && <ReturnedBadge compact />}
                        <StatusBadge status={order.status} className="pq-badge" />
                        <PaymentBadge status={order.payment_status} className="pq-badge" />
                      </div>
                    </div>

                    <div className="pq-order-heading">
                      <div className="pq-order-client">{order.client_name || "Cliente sin nombre"}</div>
                      <div className="pq-order-description">{order.description || "Sin descripción"}</div>
                    </div>

                    <div className="pq-order-meta">
                      <span><Icons.User /> {resolveSellerName(order, sellerDirectory)}</span>
                      <span><Icons.File /> {order.material || "Material no definido"}</span>
                    </div>
                    {/* Acciones de la orden */}
                    <div className="pq-order-footer">
                      {/* Botón para ver detalles de la orden */}
                      <button className="pq-btn pq-btn-ghost" onClick={() => handleViewOrder(order)}>
                        <Icons.Eye />
                        Ver detalles
                      </button>
                      {/* Botón para archivar la orden */}
                      {canArchiveQuoteOrder(order, user?.id) && (
                        <button
                          className="pq-btn pq-btn-inline-archive"
                          onClick={() => setArchivingOrder(order)}
                        >
                          <Icons.Archive />
                          Archivar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                </div>
              )}
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
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
        onOpenReturnModal={setReturningOrder}
        onValidationError={handlePaymentValidationError}
        onOpenProductionModal={handleOpenProductionModal}
        onCreditClientRequired={openCreditClientRegistration}
      />

      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchive}
        order={archivingOrder}
        loading={archiveLoading}
      />

      <ReturnToDesignerModal
        open={!!returningOrder}
        onClose={() => setReturningOrder(null)}
        onConfirm={handleConfirmReturn}
        order={returningOrder}
        loading={returnLoading}
      />

      <ProductionAssignmentModal
        open={!!forwardToProductionOrder}
        onClose={() => setForwardToProductionOrder(null)}
        onConfirm={handleConfirmSendToProduction}
        order={forwardToProductionOrder}
        loading={productionSaving}
      />

      <CreateClientModal
        open={showNewClientModal}
        onClose={() => {
          setShowNewClientModal(false);
          setClientInitialValues(null);
          setCreditPendingOrder(null);
        }}
        onCreated={handleNewClientCreated}
        supabase={supabase}
        userId={user?.id}
        initialValues={clientInitialValues}
      />

      <SettleCreditModal
        open={!!creditSettlementTarget}
        onClose={() => {
          setCreditSettlementTarget(null);
          setCreditSettlementNotes("");
        }}
        onConfirm={handleConfirmCreditSettlement}
        clientName={creditSettlementTarget?.client?.name}
        invoiceCount={creditSettlementTarget?.orderIds?.length || 0}
        invoices={creditSettlementTarget?.invoices || []}
        loading={creditSettlementLoading}
        notes={creditSettlementNotes}
        onNotesChange={setCreditSettlementNotes}
      />

      <CreditReminderCreateModal
        open={!!creditReminderTarget}
        variant="quote"
        target={creditReminderTarget}
        form={creditReminderForm}
        onFormChange={setCreditReminderForm}
        onToggleOrder={toggleCreditReminderOrder}
        onClose={closeCreditReminderModal}
        onSubmit={handleSaveCreditReminder}
        saving={creditReminderSaving}
        minReminderAt={getMinimumCreditReminderAt(creditReminderNow)}
        formatCreditDate={formatCreditDate}
        isOpenCreditReceivable={isOpenCreditReceivable}
      />

      <CreditCustomReminderDueModal
        open={dueCreditCustomReminders.length > 0}
        variant="quote"
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
