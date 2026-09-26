import { useEffect, useMemo, useRef, useState } from "react";
import { getPaymentConfirmButtonLabel } from "../../utils/paymentUi";
import { validateReceiptFile, PAYMENT_RECEIPT_HINT } from "../../utils/receiptValidation";
import { PAYMENT_RECEIPT_ACCEPT } from "../../utils/fileValidation";
import { createSignedOrderAssetUrlFromStoredUrl } from "../../utils/uploadOrderAsset";
import { Icons } from "../../utils/icons";
import { ORDER_STATUS, PAYMENT_STATUS } from "../../utils/constants";
import { getAvatarInitials } from "../../utils/avatar-initials";
import { PaymentBadge } from "./Badge";
import FileUploadZone from "./FileUploadZone";
import { Modal } from "../orders/CreateOrderModal";
import "./PaymentFormModal.css";

export default function PaymentFormModal({
  open,
  order,
  loading = false,
  onClose,
  onConfirm,
  canAssignInvoiceCode = false,
  onAssignInvoiceCode,
  onCreditClientRequired,
  canManagePayment = true,
  hasVerifiedPaymentReceipt = false,
  nested = false,
}) {
  const [paymentStatus, setPaymentStatus] = useState("Pending_Payment");
  const [receiptFile, setReceiptFile] = useState(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState("");
  const receiptInputRef = useRef(null);
  const [receiptPreviewAvailable, setReceiptPreviewAvailable] = useState(true);
  const [receiptZoneError, setReceiptZoneError] = useState("");
  const [receiptZoneErrorKey, setReceiptZoneErrorKey] = useState(0);
  const [internalError, setInternalError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceCodeSaving, setInvoiceCodeSaving] = useState(false);
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
    setInvoiceNumber(order?.invoice_number || "");
    setInvoiceCodeSaving(false);
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  }, [open, orderId, orderPaymentStatus, order?.invoice_number]);

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
    if (!canManagePayment) {
      setInternalError("Esta orden está en modo lectura para Caja.");
      return;
    }
    const hasPaymentEvidence = Boolean(receiptFile || hasVerifiedPaymentReceipt);
    const hasInvoiceCode = Boolean(invoiceNumber.trim() || order?.invoice_number?.trim());

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      if (!hasInvoiceCode) {
        return setInternalError("La orden debe tener un número de facturación para vender a crédito.");
      }
      if (!order?.client_id) {
        return setInternalError("Para vender a crédito debes registrar y vincular este cliente.");
      }
    }

    if (paymentStatus === PAYMENT_STATUS.PAID && !hasInvoiceCode) {
      return setInternalError("Para marcar la orden como pagada debes registrar el código de facturación.");
    }

    if (paymentStatus === PAYMENT_STATUS.PAID && !hasPaymentEvidence) {
      return setInternalError("Para marcar la orden como pagada debes adjuntar un comprobante de imagen verificado.");
    }

    try {
      const result = await onConfirm({
        paymentStatus,
        receiptFile,
        invoiceNumber: invoiceNumber.trim(),
      });
      if (result?.ok === false) return;
    } catch (err) {
      setInternalError(err?.message || "No se pudo procesar el pago.");
    }
  };

  const handleInvoiceCodeSave = async () => {
    const nextInvoiceNumber = invoiceNumber.trim();
    if (!nextInvoiceNumber || !onAssignInvoiceCode || !canAssignInvoiceCode || invoiceCodeSaving) return;

    setInternalError("");
    setInvoiceCodeSaving(true);
    try {
      const updated = await onAssignInvoiceCode(order, nextInvoiceNumber);
      if (updated?.invoice_number) setInvoiceNumber(updated.invoice_number);
    } catch (err) {
      setInternalError(err?.message || "No se pudo guardar el código de facturación.");
    } finally {
      setInvoiceCodeSaving(false);
    }
  };

  if (!open || !order) return null;

  const orderReference = order.id
    ? `ORDEN #${String(order.id).slice(0, 8).toUpperCase()}`
    : "ORDEN";
  const clientName = order.client_name || "Cliente";
  const clientInitials = getAvatarInitials(clientName);
  const clientPhone = order.client_contact || order.client_phone || "Sin teléfono";

  const paymentFooter = (
    <div className="pq-dialog-actions pfm-actions">
      <button type="button" className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>
        Cancelar
      </button>
      <button
        type="button"
        className="pq-btn pq-btn-primary"
        onClick={handleSubmit}
        disabled={
          loading ||
          !canManagePayment ||
          (paymentStatus === PAYMENT_STATUS.PAID && (
            (!invoiceNumber.trim() && !order?.invoice_number?.trim())
            || (!receiptFile && !hasVerifiedPaymentReceipt)
          ))
        }
      >
        {confirmLabel}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Gestionar pago"
      hideStripe
      closeOnBackdrop
      closeOnEscape
      className="ps-file-details-modal pfm-modal"
      overlayClassName={`ps-file-details-overlay pfm-file-details-overlay${nested ? " pfm-nested-overlay" : ""}`}
      headerContent={
        <>
          <span className="pfm-order-id">{orderReference}</span>
          <h3 className="ps-file-details-title">Gestionar pago</h3>
        </>
      }
      footer={paymentFooter}
    >
      <div className="pfm-modal-content">
        <div className="pfm-order-summary">
          <span className="pfm-avatar" aria-label={`Iniciales de ${clientName}`}>{clientInitials}</span>
          <div className="pfm-order-info">
            <span className="pfm-client-name">{clientName}</span>
            <span className="pfm-order-phone" aria-label="Teléfono del cliente">
              <Icons.Phone aria-hidden="true" />
              <span>{clientPhone}</span>
            </span>
          </div>
          <div className="pfm-current-badge">
            <span className="pfm-label">Estado actual</span>
            <PaymentBadge status={order.payment_status} className="ps-badge" bordered />
          </div>
        </div>

        {!canManagePayment && (
          <div className="pfm-readonly-note" role="status">
            Esta orden está en modo lectura para Caja. Puedes consultar su estado, pero no modificar el pago.
          </div>
        )}

          <div className="pfm-field">
            <span className="pfm-label">Estado de pago</span>
            <div className="pfm-select-wrap">
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                disabled={loading || !canManagePayment}
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
              {!order?.client_id && onCreditClientRequired && (
                <button type="button" className="pq-btn pq-btn-secondary pfm-credit-client-btn" onClick={() => onCreditClientRequired(order)} disabled={loading}>
                  <Icons.User /> Vincular cliente
                </button>
              )}
            </div>
          )}

          <div className="pfm-receipt-number-field">
              <label className="pfm-label" htmlFor="pfm-invoice-number">Código de facturación</label>
              <input
                id="pfm-invoice-number"
                className="pfm-receipt-number-input"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                disabled={loading || !canAssignInvoiceCode || !canManagePayment}
                placeholder="Código de facturación"
                aria-describedby="pfm-invoice-number-hint"
              />
              {canAssignInvoiceCode && canManagePayment && onAssignInvoiceCode && (
                <button
                  type="button"
                  className="pq-btn pq-btn-primary pfm-save-invoice-btn"
                  onClick={handleInvoiceCodeSave}
                  disabled={loading || invoiceCodeSaving || !invoiceNumber.trim() || invoiceNumber.trim() === String(order?.invoice_number || "").trim()}
                >
                  {invoiceCodeSaving ? "Guardando..." : "Guardar código"}
                </button>
              )}
              <small id="pfm-invoice-number-hint" className="pfm-receipt-number-hint pfm-invoice-code-hint">
                {canAssignInvoiceCode ? "Guarda el código antes de completar el pago." : "El código registrado es requerido antes de completar el pago."}
              </small>
          </div>

          {paymentStatus === PAYMENT_STATUS.PAID && (
            <div className="pfm-receipt-section">
              <span className="pfm-label">Comprobante de pago</span>
              {receiptFile ? (
                <div className="pfm-receipt-card">
                  <FileUploadZone
                    accept={PAYMENT_RECEIPT_ACCEPT}
                    mode="image"
                    replaceMode
                    inputRef={receiptInputRef}
                    className="file-upload-zone--hidden-picker"
                    buttonLabel="Cambiar comprobante"
                  disabled={loading || !canManagePayment}
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
                      <button type="button" className="pfm-receipt-btn" onClick={() => receiptInputRef.current?.click()} disabled={loading || !canManagePayment}>
                        <Icons.Edit /> Cambiar
                      </button>
                      <button type="button" className="pfm-receipt-btn pfm-receipt-btn--danger" onClick={handleRemoveReceipt} disabled={loading || !canManagePayment}>
                        <Icons.Trash /> Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <FileUploadZone
                  accept={PAYMENT_RECEIPT_ACCEPT}
                  mode="image"
                  replaceMode
                  inputRef={receiptInputRef}
                  buttonLabel="Seleccionar desde el ordenador"
                  hint={PAYMENT_RECEIPT_HINT}
                  disabled={loading || !canManagePayment}
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

      </div>
    </Modal>
  );
}
