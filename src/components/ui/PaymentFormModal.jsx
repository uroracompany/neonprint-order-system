import { useEffect, useMemo, useRef, useState } from "react";
import { getPaymentConfirmButtonLabel } from "../../utils/paymentUi";
import { validateReceiptFile, PAYMENT_RECEIPT_HINT } from "../../utils/receiptValidation";
import { createSignedOrderAssetUrlFromStoredUrl } from "../../utils/uploadOrderAsset";
import { Icons } from "../../utils/icons";
import { ORDER_STATUS, PAYMENT_STATUS } from "../../utils/constants";
import { PaymentBadge } from "./Badge";
import FileUploadZone from "./FileUploadZone";
import "./PaymentFormModal.css";

export default function PaymentFormModal({
  open,
  order,
  loading = false,
  onClose,
  onConfirm,
}) {
  const [paymentStatus, setPaymentStatus] = useState("Pending_Payment");
  const [receiptFile, setReceiptFile] = useState(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState("");
  const receiptInputRef = useRef(null);
  const [receiptPreviewAvailable, setReceiptPreviewAvailable] = useState(true);
  const [receiptZoneError, setReceiptZoneError] = useState("");
  const [receiptZoneErrorKey, setReceiptZoneErrorKey] = useState(0);
  const [internalError, setInternalError] = useState("");
  const orderId = order?.id;
  const orderPaymentStatus = order?.payment_status;

  useEffect(() => {
    if (!open || !orderId) return;
    setPaymentStatus(orderPaymentStatus || "Pending_Payment");
    setReceiptFile(null);
    setReceiptPreviewAvailable(true);
    setReceiptZoneError("");
    setReceiptZoneErrorKey(0);
    setInternalError("");
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  }, [open, orderId, orderPaymentStatus]);

  useEffect(() => {
    let active = true;
    const loadReceipt = async () => {
      if (!order?.invoice_payment) {
        if (active) setExistingReceiptUrl("");
        return;
      }
      const signedUrl = await createSignedOrderAssetUrlFromStoredUrl({
        bucket: "payment-invoice",
        url: order.invoice_payment,
      });
      if (active) setExistingReceiptUrl(signedUrl || "");
    };
    loadReceipt();
    return () => { active = false; };
  }, [order?.invoice_payment, orderId]);

  const receiptPreviewUrl = useMemo(() => {
    if (!receiptFile) return "";
    return URL.createObjectURL(receiptFile);
  }, [receiptFile]);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    };
  }, [receiptPreviewUrl]);

  const confirmLabel = useMemo(
    () => getPaymentConfirmButtonLabel(paymentStatus, loading),
    [paymentStatus, loading],
  );

  const paymentOptions = useMemo(() => {
    const isInProduction = order?.status === ORDER_STATUS.IN_PRODUCTION || order?.status === ORDER_STATUS.IN_TERMINATION || order?.status === ORDER_STATUS.IN_COMPLETED || order?.status === ORDER_STATUS.IN_DELIVERED;
    return [
      ...(isInProduction ? [] : [{ value: PAYMENT_STATUS.PENDING, label: "Pendiente" }]),
      { value: PAYMENT_STATUS.PARTIAL, label: "Pago parcial" },
      { value: PAYMENT_STATUS.CREDIT, label: "Pago a crédito" },
      { value: PAYMENT_STATUS.PAID, label: "Pagado" },
    ];
  }, [order?.status]);

  const handleReceiptAccepted = async ([file]) => {
    if (!file) return;
    const validation = await validateReceiptFile(file);
    if (!validation.isValid) {
      setReceiptZoneError(validation.error || "La imagen no es válida.");
      setReceiptZoneErrorKey((prev) => prev + 1);
      return;
    }
    setReceiptFile(file);
    setReceiptPreviewAvailable(validation.previewAvailable !== false);
    setReceiptZoneError("");
  };

  const handleRemoveReceipt = () => {
    if (receiptInputRef.current) receiptInputRef.current.value = "";
    setReceiptFile(null);
    setReceiptPreviewAvailable(true);
    setReceiptZoneError("");
    setReceiptZoneErrorKey((prev) => prev + 1);
  };

  const handleSubmit = async () => {
    setInternalError("");

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      if (!String(order?.invoice_number || "").trim()) {
        return setInternalError("La orden debe tener un número de facturación para vender a crédito.");
      }
      if (!order?.client_id) {
        return setInternalError("Para vender a crédito debes registrar y vincular este cliente.");
      }
    }

    if (paymentStatus === PAYMENT_STATUS.PAID && !receiptFile && !order?.invoice_payment) {
      return setInternalError("Debe subir la imagen de pago para marcar como pagado.");
    }

    try {
      await onConfirm({ paymentStatus, receiptFile });
    } catch (err) {
      setInternalError(err?.message || "No se pudo procesar el pago.");
    }
  };

  if (!open || !order) return null;

  return (
    <div className="pa-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pa-modal compact pfm-modal" role="dialog" aria-modal="true" aria-labelledby="pfm-title">
        <div className="pa-modal-head">
          <div className="pa-modal-copy">
            <span className="pa-modal-kicker">Registro de pago</span>
            <h3 id="pfm-title">Gestionar pago</h3>
          </div>
          <button className="pa-icon-btn pa-modal-close" onClick={onClose} aria-label="Cerrar">
            <Icons.Close />
          </button>
        </div>
        <div className="pa-modal-body">
          <div className="pfm-order-summary">
            <span className="pfm-summary-icon"><Icons.Receipt /></span>
            <div className="pfm-order-info">
              <span className="pfm-client-name">{order.client_name}</span>
              {order.description && (
                <span className="pfm-desc">
                  {order.description.length > 60 ? `${order.description.slice(0, 60)}…` : order.description}
                </span>
              )}
            </div>
            <div className="pfm-current-badge">
              <span className="pfm-label">Estado actual</span>
              <PaymentBadge status={order.payment_status} className="ps-badge" bordered />
            </div>
          </div>

          <div className="pfm-field">
            <span className="pfm-label">Estado de pago</span>
            <div className="pfm-select-wrap">
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                disabled={loading}
              >
                {paymentOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <Icons.ChevronDown aria-hidden="true" />
            </div>
          </div>

          {paymentStatus === PAYMENT_STATUS.CREDIT && (
            <div className="pfm-credit-info">
              <Icons.AlertCircle />
              <span>Facturación: <strong>{order?.invoice_number || "No definido"}</strong></span>
            </div>
          )}

          {paymentStatus === PAYMENT_STATUS.PAID && (
            <div className="pfm-receipt-section">
              <span className="pfm-label">Comprobante de pago</span>
              {receiptFile ? (
                <div className="pfm-receipt-card">
                  <FileUploadZone
                    mode="image"
                    replaceMode
                    inputRef={receiptInputRef}
                    className="file-upload-zone--hidden-picker"
                    buttonLabel="Cambiar comprobante"
                    disabled={loading}
                    externalError={receiptZoneError}
                    externalErrorKey={receiptZoneErrorKey}
                    onFilesAccepted={handleReceiptAccepted}
                  />
                  {receiptPreviewAvailable && receiptPreviewUrl ? (
                    <a href={receiptPreviewUrl} target="_blank" rel="noreferrer">
                      <img
                        src={receiptPreviewUrl}
                        alt="Vista previa del comprobante"
                        className="pfm-receipt-preview"
                      />
                    </a>
                  ) : (
                    <div className="pfm-receipt-no-preview">
                      <Icons.Image />
                      <span>{receiptFile.name}</span>
                      <small>Vista previa no disponible</small>
                    </div>
                  )}
                  <div className="pfm-receipt-actions">
                    <span>{receiptFile.name}</span>
                    <div>
                      <button type="button" className="pfm-receipt-btn" onClick={() => receiptInputRef.current?.click()}>
                        <Icons.Edit /> Cambiar
                      </button>
                      <button type="button" className="pfm-receipt-btn pfm-receipt-btn--danger" onClick={handleRemoveReceipt}>
                        <Icons.Trash /> Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <FileUploadZone
                  mode="image"
                  replaceMode
                  inputRef={receiptInputRef}
                  buttonLabel="Seleccionar desde el ordenador"
                  hint={PAYMENT_RECEIPT_HINT}
                  disabled={loading}
                  externalError={receiptZoneError}
                  externalErrorKey={receiptZoneErrorKey}
                  onFilesAccepted={handleReceiptAccepted}
                />
              )}

              {existingReceiptUrl && !receiptFile && (
                <div className="pfm-existing-receipt">
                  <span className="pfm-label">Comprobante actual</span>
                  <a href={existingReceiptUrl} target="_blank" rel="noreferrer">
                    <img src={existingReceiptUrl} alt="Comprobante de pago actual" className="pfm-receipt-preview" />
                  </a>
                </div>
              )}
            </div>
          )}

          {internalError && (
            <div className="pfm-error" role="alert">
              <Icons.AlertCircle />{internalError}
            </div>
          )}

          <div className="pfm-actions">
            <button className="pfm-btn pfm-btn--secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button
              className="pfm-btn pfm-btn--primary"
              onClick={handleSubmit}
              disabled={
                loading ||
                (paymentStatus === PAYMENT_STATUS.PAID && !receiptFile && !order?.invoice_payment)
              }
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
