import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  ORDER_STATUS,
  PRODUCTION_AREAS,
  QUOTE_ASSIGNMENT_FIELDS,
  STATUS_OPTIONS,
  ARCHIVE_MODULES,
  getOrderStatusConfig,
  isOrderStatus,
  isOrderStatusIn,
  getFileNameFromUrl,
} from "../utils/constants";
import { getReferenceImages } from "../utils/orderAssets";
import { getProductionFiles } from "../utils/production";
import { useAuth } from "../hooks/useAuth";
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
const isQuoteEditable = (order) => isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) && order?.payment_status !== "pagado" && !order?.is_archived_quote;
// Verifica si una orden está asignada al usuario actual
const isOrderAssignedToQuote = (order, quoteUserId) => Boolean(order?.id) && hasQuoteAssignment(order, quoteUserId);
// Verifica si una orden puede ser archivada (recibe userId explícitamente)
const canArchiveQuoteOrder = (order, userId) => canArchiveOrder(order, ARCHIVE_MODULES.QUOTE, userId);
// Verifica si una orden fue devuelta (tiene estado de diseño/pendiente Y razón de devolución)
const isReturnedOrder = (order) => isOrderStatusIn(order?.status, [ORDER_STATUS.IN_DESIGN, ORDER_STATUS.PENDING]) && Boolean(String(order?.return_reason || "").trim());
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
      const [{ data: areaData, error: areaError }, { data: userData, error: userError }] = await Promise.all([
        supabase
          .from("production_areas")
          .select("code, label, producer_role, is_active")
          .eq("is_active", true),
        supabase
          .from("profiles")
          .select("id, name, role, employment_status")
          .in("role", PRODUCTION_AREAS.map((area) => area.role))
          .eq("employment_status", true),
      ]);

      if (!active) return;

      const nextAreas = areaError || !Array.isArray(areaData) || areaData.length === 0
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

      setAreas(nextAreas);
      setUsers(Array.isArray(userData) && !userError ? userData : []);
      setLoadingOptions(false);

      if (userError) {
        setError("No se pudieron cargar los usuarios de produccion.");
      }
    };

    loadOptions();

    return () => {
      active = false;
    };
  }, [open]);

  if (!open || !order) return null;

  const usersByRole = users.reduce((acc, userItem) => {
    acc[userItem.role] = [...(acc[userItem.role] || []), userItem];
    return acc;
  }, {});
  const allAreasAssigned = areas.every((area) => Boolean(assignments[area.code]));

  const handleConfirm = () => {
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

function QuoteOrderDetailModal({ open, onClose, order, onConfirmPayment, paymentSaving, sellerDirectory, onOpenReturnModal, onValidationError, onOpenProductionModal }) {
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreviewAvailable, setReceiptPreviewAvailable] = useState(true);
  const [receiptZoneError, setReceiptZoneError] = useState("");
  const [receiptZoneErrorKey, setReceiptZoneErrorKey] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState("pagado");
  const [localError, setLocalError] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReceiptFile(null);
      setReceiptPreviewAvailable(true);
      setReceiptZoneError("");
      setReceiptZoneErrorKey(0);
      setPaymentStatus(order?.payment_status || "Pending_Payment");
      setLocalError("");
      setReceiptUrl("");
    }
  }, [open, order?.id, order?.payment_status]);

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
  const canReturnToDesigner = isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) && order?.payment_status !== "pagado" && !order?.is_archived_quote;
  const canMoveToProduction = isOrderStatus(order?.status, ORDER_STATUS.IN_QUOTE) && order?.payment_status === "pagado" && !order?.is_archived_quote;
  const returnedReason = String(order?.return_reason || "").trim();
  const readonlyMessage =
    order.is_archived_quote
      ? "Esta orden está en modo lectura porque fue archivada en caja."
      : order.payment_status === "pagado"
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
    if (paymentStatus === "pagado" && !receiptFile) {
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
              <div className="pq-panel-title">Archivos entregados</div>
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
                  <Icons.Eye /> Orden de trabajo
                </span>
                {order.preview_image ? (
                  <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                    <img
                      src={order.preview_image}
                      alt="preview"
                      style={{
                        width: "100%",
                        maxHeight: 200,
                        objectFit: "contain",
                        objectPosition: "left",
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
                ) : (
                  <span className="pq-preview-empty">No hay preview cargado.</span>
                )}
              </div>

              {referenceImageUrls.length > 0 && (
                <div className="pq-preview-block" style={{ marginTop: 16 }}>
                  <span className="pq-description-label">Imágenes de referencia</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                    {referenceImageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                        <img
                          src={url}
                          alt={`Ref ${i + 1}`}
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: 8,
                            border: "1px solid var(--pq-border)",
                            cursor: "pointer",
                            transition: "transform 0.2s",
                          }}
                          onMouseEnter={e => { e.target.style.transform = "scale(1.05)"; }}
                          onMouseLeave={e => { e.target.style.transform = "scale(1)"; }}
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
              <div className={`pq-readonly-note ${order.payment_status === "pagado" ? "success" : ""}`}>
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
                  disabled={!canConfirmPayment || paymentSaving}
                  onChange={event => setPaymentStatus(event.target.value)}
                >
                  <option value="Pending_Payment">Pendiente</option>
                  <option value="parcial">Parcial</option>
                  <option value="pagado">Pagado</option>
                </select>
              </div>

              <div className="pq-payment-field">
                <label>Recibo o factura</label>
                {paymentStatus === "pagado" ? (
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
                  <span className="pq-upload-hint">El campo de recibo solo se muestra cuando el estado es "Pagado"</span>
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

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  const fetchOrders = async (...args) => fetchOrdersImpl(...args);
  const fetchOrdersRef = useRef(fetchOrders);

  useEffect(() => {
    fetchOrdersRef.current = fetchOrders;
  });


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
    
    // SUSCRIPCIÓN EN TIEMPO REAL: escucha cambios en la tabla "orders"
    const channel = supabase
      .channel(`quote-orders-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        async (payload) => {
          const nextOrder = payload.new;
          const previousOrder = payload.old;

          // Solo recarga si la orden cambió pertenece a este usuario
          if (
            isOrderAssignedToQuote(nextOrder, user.id)
            || isOrderAssignedToQuote(previousOrder, user.id)
          ) {
            await fetchOrdersRef.current(user.id, true); // true = sin mostrar loading spinner
          }
        }
      )
      .subscribe();

    // LIMPIEZA: desuscribirse de Supabase y remover listeners al desmontar
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);


  // ============= EFECTO 3: SINCRONIZAR ORDEN SELECCIONADA =============
  // Mantiene el modal actualizado si la orden cambia en tiempo real
  // Si la orden abierta en el modal se actualiza en la BD, refleja los cambios
  useEffect(() => {
    if (!selectedOrder) return;
    const freshOrder = orders.find(o => o.id === selectedOrder.id);
    if (freshOrder) {
      setSelectedOrder(freshOrder); // Actualiza los datos del modal sin cerrarlo
    }
  }, [orders, selectedOrder]);

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
    if (paymentStatus === "pagado" && !receiptFile) {
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

    // Solo incluir invoice_payment si hay URL (o si es null para limpiar)
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
      label: "Imagen requerida",
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

    // Actualizamos la orden seleccionada
    setSelectedOrder(updatedOrder);
    setForwardToProductionOrder(null);

    notif.showActionNotification({
      type: "order_cancelled",
      label: "En producción",
      orderTitle: updatedOrder.client_name || updatedOrder.description || `Orden #${updatedOrder.id?.slice(0, 8).toUpperCase()}`,
      message: `La orden fue enviada a producción y asignada a un impresor.`,
    });
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

  const shouldEnableOrdersScroll = filteredOrders.length > 7;

  const metrics = [
    { label: "Órdenes asignadas", value: orders.length, icon: <Icons.Orders /> },
    { label: "Pendientes de pago", value: orders.filter(order => order.payment_status !== "pagado" && !order.is_archived_quote).length, icon: <Icons.Money /> },
    { label: "Pagadas", value: orders.filter(order => order.payment_status === "pagado").length, icon: <Icons.Check /> },
    { label: "Archivadas", value: orders.filter(order => order.is_archived_quote).length, icon: <Icons.Archive /> },
  ];

  const menuItems = [
    { id: "dashboard", label: "Resumen", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Mis órdenes", icon: <Icons.Orders />, badge: orders.filter(order => !order.is_archived_quote).length },
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
              <span className="pq-header-kicker">Caja</span>
              {/* Nombre del apartado de la pantalla */}
              <h1 className="pq-header-title">
                {activeTab === "dashboard" ? "Panel de Caja" : "Mis órdenes de caja"}
              </h1>
            </div>
          </div>

          <div className="pq-header-actions">
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
        ) : (
          // Vista de listado principal de órdenes, con filtros y búsqueda.
          <section className="pq-section">
            {/* Filtros y búsqueda */}
            <div className="pq-filters">
              <div className="pq-search-box">
                <Icons.Search />
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
              <div className={`pq-orders-grid ${shouldEnableOrdersScroll ? "pq-orders-scroll" : ""}`}>
                {paginatedOrders.map(order => (
                  <article key={order.id} className="pq-order-card">
                    <div className="pq-order-top">
                      <div className="pq-order-identity">
                        <span className="pq-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                        <span className="pq-order-date">
                          <Icons.Clock /> {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
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

    </div>
  );
}
