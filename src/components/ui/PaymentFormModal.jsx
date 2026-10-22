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
  correctionMode = false,
  nested = false,
  remoteOrderMissing = false,
}) {
  const [paymentStatus, setPaymentStatus] = useState(correctionMode ? "" : "Pending_Payment");
  const [pendingStatusTouched, setPendingStatusTouched] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState("");
  const [existingReceiptLoadState, setExistingReceiptLoadState] = useState("idle");
  const [existingReceiptPreviewFailed, setExistingReceiptPreviewFailed] = useState(false);
  const receiptInputRef = useRef(null);
  const [receiptPreviewAvailable, setReceiptPreviewAvailable] = useState(true);
  const [receiptZoneError, setReceiptZoneError] = useState("");
  const [receiptZoneErrorKey, setReceiptZoneErrorKey] = useState(0);
  const [internalError, setInternalError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [savedInvoiceNumber, setSavedInvoiceNumber] = useState(order?.invoice_number || "");
  const [invoiceCodeSaving, setInvoiceCodeSaving] = useState(false);
  const [invoiceCodeEditing, setInvoiceCodeEditing] = useState(false);
  const invoiceNumberInputRef = useRef(null);
  const paidReceiptScrollRequestedRef = useRef(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const versionConflictRef = useRef(false);
  const orderSessionRef = useRef({ open: false, orderId: null });
  const acceptedVersionRef = useRef(order?.updated_at || null);
  const observedVersionRef = useRef(order?.updated_at || null);
  const priorAcknowledgedVersionRef = useRef(null);
  const orderId = order?.id;
  const orderPaymentStatus = order?.payment_status;
  const hasSavedInvoice = Boolean(String(savedInvoiceNumber || "").trim());
  const canEditInvoiceCode = Boolean(canAssignInvoiceCode && canManagePayment && onAssignInvoiceCode);
  const invoiceCodeEditable = canEditInvoiceCode
    && orderPaymentStatus === PAYMENT_STATUS.PENDING
    && !correctionMode;
  const invoiceCodeHasUnsavedChanges = String(invoiceNumber || "").trim()
    !== String(savedInvoiceNumber || "").trim();

  useEffect(() => {
    if (!open || !orderId) {
      orderSessionRef.current = { open: false, orderId: null };
      return;
    }
    if (orderSessionRef.current.open && orderSessionRef.current.orderId === orderId) return;
    orderSessionRef.current = { open: true, orderId };
    acceptedVersionRef.current = order?.updated_at || null;
    observedVersionRef.current = order?.updated_at || null;
    priorAcknowledgedVersionRef.current = null;
    versionConflictRef.current = false;
    setVersionConflict(false);
    setPaymentStatus(correctionMode ? "" : (orderPaymentStatus || "Pending_Payment"));
    setPendingStatusTouched(false);
    paidReceiptScrollRequestedRef.current = false;
    setReceiptFile(null);
    setReceiptPreviewAvailable(true);
    setReceiptZoneError("");
    setReceiptZoneErrorKey(0);
    setInternalError("");
    setInvoiceNumber(order?.invoice_number || "");
    setSavedInvoiceNumber(order?.invoice_number || "");
    setInvoiceCodeSaving(false);
    setInvoiceCodeEditing(false);
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  }, [open, orderId, orderPaymentStatus, order?.invoice_number, order?.updated_at, correctionMode]);

  useEffect(() => {
    if (!open || !orderId || correctionMode || hasSavedInvoice || !invoiceCodeEditable || loading) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      invoiceNumberInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, orderId, correctionMode, hasSavedInvoice, invoiceCodeEditable, loading]);

  useEffect(() => {
    if (!paidReceiptScrollRequestedRef.current || correctionMode || paymentStatus !== PAYMENT_STATUS.PAID) return;
    const modalBody = document.querySelector(".pfm-modal .ps-modal-body");
    const receiptSection = modalBody?.querySelector(".pfm-receipt-section");
    if (!modalBody || !receiptSection || typeof modalBody.scrollTo !== "function") return;

    const bodyTop = modalBody.getBoundingClientRect().top;
    const receiptTop = receiptSection.getBoundingClientRect().top;
    const top = modalBody.scrollTop + receiptTop - bodyTop;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    modalBody.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
    paidReceiptScrollRequestedRef.current = false;
  }, [paymentStatus, correctionMode]);

  useEffect(() => {
    if (!open || !orderId || orderSessionRef.current.orderId !== orderId) return;
    if (remoteOrderMissing) {
      versionConflictRef.current = true;
      setVersionConflict(true);
      return;
    }

    const nextVersion = order?.updated_at || null;
    const observedVersion = observedVersionRef.current;
    if (!nextVersion || !observedVersion || nextVersion === observedVersion) return;

    if (nextVersion === priorAcknowledgedVersionRef.current && nextVersion !== acceptedVersionRef.current) return;
    if (nextVersion === acceptedVersionRef.current) {
      observedVersionRef.current = nextVersion;
      priorAcknowledgedVersionRef.current = null;
      return;
    }

    observedVersionRef.current = nextVersion;
    if (nextVersion !== acceptedVersionRef.current) {
      versionConflictRef.current = true;
      setVersionConflict(true);
    }
  }, [open, orderId, order?.updated_at, remoteOrderMissing]);

  useEffect(() => {
    let active = true;
    const loadReceipt = async () => {
      if (!order?.invoice_payment) {
        if (active) {
          setExistingReceiptUrl("");
          setExistingReceiptLoadState("none");
          setExistingReceiptPreviewFailed(false);
        }
        return;
      }
      setExistingReceiptUrl("");
      setExistingReceiptLoadState("loading");
      setExistingReceiptPreviewFailed(false);
      try {
        const signedUrl = await createSignedOrderAssetUrlFromStoredUrl({
          bucket: "payment-invoice",
          url: order.invoice_payment,
        });
        if (active) {
          setExistingReceiptUrl(signedUrl || "");
          setExistingReceiptLoadState(signedUrl ? "ready" : "error");
        }
      } catch {
        if (active) {
          setExistingReceiptUrl("");
          setExistingReceiptLoadState("error");
        }
      }
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
    () => (correctionMode ? (loading ? "Guardando..." : "Guardar corrección") : getPaymentConfirmButtonLabel(paymentStatus, loading)),
    [correctionMode, paymentStatus, loading],
  );

  const paymentOptions = useMemo(() => {
    if (correctionMode) {
      return [
        { value: "", label: "Selecciona el estado correcto" },
        { value: PAYMENT_STATUS.PENDING, label: "Pendiente" },
        { value: PAYMENT_STATUS.PARTIAL, label: "Pago parcial" },
      ];
    }
    const isInProduction = order?.status === ORDER_STATUS.IN_PRODUCTION || order?.status === ORDER_STATUS.IN_TERMINATION || order?.status === ORDER_STATUS.IN_COMPLETED || order?.status === ORDER_STATUS.IN_DELIVERED;
    return [
      ...(isInProduction ? [] : [{ value: PAYMENT_STATUS.PENDING, label: "Pendiente" }]),
      { value: PAYMENT_STATUS.PARTIAL, label: "Pago parcial" },
      { value: PAYMENT_STATUS.CREDIT, label: "Pago a crédito" },
      { value: PAYMENT_STATUS.PAID, label: "Pagado" },
    ];
  }, [correctionMode, order?.status]);

  const paymentEligibility = useMemo(() => {
    if (loading) return { eligible: false, error: "" };
    if (!canManagePayment) return { eligible: false, error: "Esta orden está en modo lectura para Caja." };

    if (correctionMode) {
      const isCorrectionStatus = [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIAL].includes(paymentStatus);
      return isCorrectionStatus
        ? { eligible: true, error: "" }
        : { eligible: false, error: "Selecciona Pendiente o Pago parcial para corregir el estado." };
    }

    const hasPaymentEvidence = Boolean(receiptFile || hasVerifiedPaymentReceipt);

    if (paymentStatus === PAYMENT_STATUS.PENDING) {
      return { eligible: false, error: "El pago no puede confirmarse como Pendiente." };
    }
    if (paymentStatus === PAYMENT_STATUS.PARTIAL && !hasSavedInvoice) {
      return { eligible: false, error: "Para marcar la orden como pago parcial debes registrar el código de facturación." };
    }
    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      if (!hasSavedInvoice) {
        return { eligible: false, error: "La orden debe tener un número de facturación para vender a crédito." };
      }
      if (!order?.client_id) {
        return { eligible: false, error: "Para vender a crédito debes registrar y vincular este cliente." };
      }
    }
    if (paymentStatus === PAYMENT_STATUS.PAID) {
      if (!hasSavedInvoice) {
        return { eligible: false, error: "Para marcar la orden como pagada debes registrar el código de facturación." };
      }
      if (!hasPaymentEvidence) {
        return { eligible: false, error: "Para marcar la orden como pagada debes adjuntar un comprobante de imagen verificado." };
      }
    }

    if (![PAYMENT_STATUS.PARTIAL, PAYMENT_STATUS.CREDIT, PAYMENT_STATUS.PAID].includes(paymentStatus)) {
      return { eligible: false, error: "Selecciona un estado de pago válido." };
    }

    return { eligible: true, error: "" };
  }, [
    canManagePayment,
    correctionMode,
    hasSavedInvoice,
    hasVerifiedPaymentReceipt,
    loading,
    order?.client_id,
    paymentStatus,
    receiptFile,
  ]);

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
    if (versionConflictRef.current || invoiceCodeSaving || invoiceCodeEditing || invoiceCodeHasUnsavedChanges) return;
    setInternalError("");
    if (!paymentEligibility.eligible) {
      if (paymentEligibility.error) setInternalError(paymentEligibility.error);
      return;
    }

    try {
      const result = await onConfirm({
        paymentStatus,
        receiptFile,
        invoiceNumber: invoiceNumber.trim(),
        isPaymentCorrection: correctionMode,
      });
      if (result?.code === "ORDER_STALE") {
        versionConflictRef.current = true;
        setVersionConflict(true);
        return;
      }
      if (result?.ok === false) return;
    } catch (err) {
      if (err?.code === "ORDER_STALE" || String(err?.message || "").includes("ORDER_STALE")) {
        versionConflictRef.current = true;
        setVersionConflict(true);
        return;
      }
      setInternalError(err?.message || "No se pudo procesar el pago.");
    }
  };

  const handleInvoiceCodeSave = async () => {
    const nextInvoiceNumber = invoiceNumber.trim();
    if (versionConflictRef.current || !nextInvoiceNumber || !invoiceCodeEditable || invoiceCodeSaving) return;

    setInternalError("");
    setInvoiceCodeSaving(true);
    let acknowledgedInvoiceNumber = "";
    try {
      const updated = await onAssignInvoiceCode(order, nextInvoiceNumber, (acknowledgedOrder) => {
        if (acknowledgedOrder?.updated_at) {
          priorAcknowledgedVersionRef.current = observedVersionRef.current;
          acceptedVersionRef.current = acknowledgedOrder.updated_at;
          observedVersionRef.current = acknowledgedOrder.updated_at;
        }
        if (acknowledgedOrder?.invoice_number) {
          acknowledgedInvoiceNumber = String(acknowledgedOrder.invoice_number).trim();
        }
      });
      const persistedInvoiceNumber = String(updated?.invoice_number ?? acknowledgedInvoiceNumber).trim();
      if (persistedInvoiceNumber) {
        setInvoiceNumber(persistedInvoiceNumber);
        setSavedInvoiceNumber(persistedInvoiceNumber);
        setInvoiceCodeEditing(false);
      } else {
        setInternalError("El servidor no confirmó el código de facturación. Verifica el código e intenta guardarlo nuevamente.");
      }
    } catch (err) {
      if (err?.code === "ORDER_STALE" || String(err?.message || "").includes("ORDER_STALE")) {
        versionConflictRef.current = true;
        setVersionConflict(true);
        return;
      }
      setInternalError(err?.message || "No se pudo guardar el código de facturación.");
    } finally {
      setInvoiceCodeSaving(false);
    }
  };

  const handleInvoiceCodeEdit = () => {
    if (!invoiceCodeEditable || versionConflictRef.current || invoiceCodeSaving) return;
    setInvoiceNumber(String(savedInvoiceNumber || ""));
    setInvoiceCodeEditing(true);
    window.requestAnimationFrame(() => invoiceNumberInputRef.current?.focus({ preventScroll: true }));
  };

  if (!open || !order) return null;

  const orderReference = order.id
    ? `ORDEN #${String(order.id).slice(0, 8).toUpperCase()}`
    : "ORDEN";
  const clientName = order.client_name || "Cliente";
  const clientInitials = getAvatarInitials(clientName);
  const clientPhone = order.client_contact || order.client_phone || "Sin teléfono";
  const invoiceNeedsAttention = !correctionMode && !hasSavedInvoice;
  const showPaymentBlockReason = !correctionMode
    && Boolean(paymentEligibility.error)
    && (paymentStatus !== PAYMENT_STATUS.PENDING || pendingStatusTouched);

  const paymentFooter = (
    <div className="pq-dialog-actions pfm-actions">
      <button type="button" className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>
        Cancelar
      </button>
      <button
        type="button"
        className="pq-btn pq-btn-primary"
        onClick={handleSubmit}
        disabled={versionConflict || invoiceCodeSaving || invoiceCodeEditing || invoiceCodeHasUnsavedChanges || !paymentEligibility.eligible}
        aria-describedby={showPaymentBlockReason ? "pfm-payment-block-reason" : undefined}
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

        {versionConflict && (
          <div className="pfm-error" role="alert" aria-live="assertive" aria-atomic="true">
            <Icons.AlertCircle aria-hidden="true" />
            La orden cambió en otro lugar. El borrador de pago, factura y comprobante se conserva solo mientras este modal siga abierto; no se guardará. Cierra y vuelve a abrir la orden para revisar la versión actual. Si cierras este modal, perderás el borrador local.
          </div>
        )}

        {correctionMode && (
          <div className="pfm-readonly-note" role="status">
            Corrige el estado del pago antes de autorizar Producción. El código de factura y el comprobante actual no se modificarán; el comprobante dejará de estar asociado al pago confirmado.
          </div>
        )}

        {showPaymentBlockReason && (
          <div id="pfm-payment-block-reason" className="pfm-error" role="status" aria-live="polite" aria-atomic="true">
            <Icons.AlertCircle aria-hidden="true" />{paymentEligibility.error}
          </div>
        )}

          <div className={`pfm-receipt-number-field${invoiceNeedsAttention ? " pfm-invoice-pending" : ""}${invoiceNeedsAttention && invoiceCodeEditable ? " pfm-invoice-pending--editable" : ""}`}>
              <small id="pfm-invoice-number-hint" className={`pfm-receipt-number-hint pfm-invoice-code-hint${hasSavedInvoice && invoiceCodeEditable && orderPaymentStatus === PAYMENT_STATUS.PENDING && !invoiceCodeEditing && !correctionMode ? " pfm-invoice-code-hint--saved" : ""}`} aria-live="polite">
                {correctionMode
                  ? "El código de facturación se conserva sin cambios durante la corrección."
                  : !invoiceCodeEditable && hasSavedInvoice
                    ? "El código queda bloqueado porque el pago ya fue confirmado."
                  : orderPaymentStatus !== PAYMENT_STATUS.PENDING
                    ? "El código solo puede registrarse mientras la orden siga pendiente."
                  : hasSavedInvoice
                    ? invoiceCodeEditing
                      ? "Guarda los cambios antes de confirmar el pago."
                      : "Código guardado. Puedes elegir el estado del pago o editar el código mientras siga pendiente."
                    : invoiceCodeEditable
                      ? "Paso 1: registra y guarda el código antes de elegir el estado del pago."
                      : canManagePayment
                        ? "Caja no puede asignar este código. Solicita a Ventas que lo registre para continuar con el pago."
                        : "Modo lectura: solicita al responsable de la orden que registre el código de facturación."}
              </small>
              <label className="pfm-label" htmlFor="pfm-invoice-number">Código de facturación</label>
              <input
                id="pfm-invoice-number"
                ref={invoiceNumberInputRef}
                className="pfm-receipt-number-input"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                readOnly={correctionMode || (hasSavedInvoice && !invoiceCodeEditing)}
                disabled={!correctionMode && (loading || !invoiceCodeEditable)}
                placeholder="Código de facturación"
                aria-describedby="pfm-invoice-number-hint"
              />
              {invoiceCodeEditable && (
                hasSavedInvoice && !invoiceCodeEditing
                  ? <button type="button" className="pq-btn pq-btn-secondary pfm-save-invoice-btn" onClick={handleInvoiceCodeEdit} disabled={versionConflict || loading || invoiceCodeSaving}>Editar código</button>
                  : <button
                    type="button"
                    className="pq-btn pq-btn-primary pfm-save-invoice-btn"
                    onClick={handleInvoiceCodeSave}
                    disabled={versionConflict || loading || invoiceCodeSaving || !invoiceNumber.trim() || !invoiceCodeHasUnsavedChanges}
                  >
                    {invoiceCodeSaving ? "Guardando..." : hasSavedInvoice ? "Guardar cambios" : "Guardar código"}
                  </button>
              )}
          </div>

          <div className="pfm-field">
            <span id="pfm-payment-status-label" className="pfm-label">Estado de pago</span>
            <div className="pfm-select-wrap">
              <select
                aria-labelledby="pfm-payment-status-label"
                value={paymentStatus}
                onChange={(event) => {
                  const nextPaymentStatus = event.target.value;
                  setPaymentStatus(nextPaymentStatus);
                  setPendingStatusTouched(nextPaymentStatus === PAYMENT_STATUS.PENDING);
                  setInternalError("");
                  paidReceiptScrollRequestedRef.current = !correctionMode
                    && paymentStatus !== PAYMENT_STATUS.PAID
                    && nextPaymentStatus === PAYMENT_STATUS.PAID;
                }}
                disabled={loading || !canManagePayment || (!correctionMode && !hasSavedInvoice)}
              >
                {paymentOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <Icons.ChevronDown aria-hidden="true" />
            </div>
          </div>

          {paymentStatus === PAYMENT_STATUS.CREDIT && (
            <div className="pfm-credit-info">
              <Icons.AlertCircle />
              <span>Facturación: <strong>{savedInvoiceNumber || "No definido"}</strong></span>
              {!order?.client_id && onCreditClientRequired && (
                <button type="button" className="pq-btn pq-btn-secondary pfm-credit-client-btn" onClick={() => onCreditClientRequired(order)} disabled={loading}>
                  <Icons.User /> Vincular cliente
                </button>
              )}
            </div>
          )}

          {paymentStatus === PAYMENT_STATUS.PAID && !correctionMode && (
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
                  className={loading || !canManagePayment || receiptZoneError ? "" : "pfm-receipt-upload-attention"}
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

          {correctionMode && existingReceiptUrl && (
            <div className="pfm-existing-receipt">
              <span className="pfm-label">Comprobante actual (solo lectura)</span>
              <a href={existingReceiptUrl} target="_blank" rel="noreferrer" aria-label="Abrir comprobante de pago actual">
                {existingReceiptPreviewFailed ? (
                  <div className="pfm-receipt-no-preview">
                    <Icons.Image aria-hidden="true" />
                    <span>Vista previa no disponible</span>
                    <small>El archivo original sigue conservado.</small>
                  </div>
                ) : (
                  <img
                    src={existingReceiptUrl}
                    alt="Comprobante de pago actual"
                    className="pfm-receipt-preview"
                    onError={() => setExistingReceiptPreviewFailed(true)}
                  />
                )}
              </a>
            </div>
          )}

          {correctionMode && order?.invoice_payment && existingReceiptLoadState === "loading" && (
            <div className="pfm-existing-receipt-state" role="status" aria-live="polite">
              Cargando comprobante actual…
            </div>
          )}
          {correctionMode && order?.invoice_payment && existingReceiptLoadState === "error" && (
            <div className="pfm-existing-receipt-state" role="status">
              No se pudo cargar la vista previa del comprobante. Puedes guardar la corrección; el archivo almacenado no se eliminará.
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
