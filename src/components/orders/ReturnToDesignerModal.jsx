import { useEffect, useRef, useState } from "react";
import { Icons } from "../../utils/icons";
import { getReturnPresentation } from "./returnToDesignerPresentation";
import "./ReturnToDesignerModal.css";

export default function ReturnToDesignerModal({
  open,
  onClose,
  onConfirm,
  order,
  loading = false,
  targetOverride,
  minReasonLength = 1,
}) {
  const [reason, setReason] = useState("");
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const lastActiveElementRef = useRef(null);
  const orderId = order?.id;
  const { label: targetLabel, nextStatusLabel } = getReturnPresentation(order, targetOverride);
  const trimmedReason = reason.trim();
  const canConfirm = trimmedReason.length >= minReasonLength;

  useEffect(() => {
    setReason("");
  }, [open, order?.id]);

  useEffect(() => {
    if (!open || !orderId) return undefined;

    lastActiveElementRef.current = document.activeElement;

    return () => {
      lastActiveElementRef.current?.focus?.();
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open || !orderId) return;
    if (loading) {
      dialogRef.current?.focus();
    } else {
      closeButtonRef.current?.focus();
    }
  }, [loading, open, orderId]);

  const handleClose = () => {
    if (loading) return;
    setReason("");
    onClose();
  };

  const handleConfirm = () => {
    if (!canConfirm || loading) return;
    onConfirm(trimmedReason);
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll("button:not([disabled]), textarea:not([disabled])") || [],
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!open || !order) return null;

  return (
    <div className="rtd-overlay" onClick={(event) => event.target === event.currentTarget && handleClose()}>
      <div ref={dialogRef} className="rtd-dialog" role="dialog" aria-modal="true" aria-labelledby="rtd-title" aria-describedby="rtd-description" tabIndex={loading ? 0 : -1} onKeyDown={handleDialogKeyDown}>
        <div className="rtd-icon" aria-hidden="true"><Icons.ArrowLeft /></div>
        <button ref={closeButtonRef} type="button" className="rtd-close" onClick={handleClose} disabled={loading} aria-label="Cerrar"><Icons.Close /></button>
        <h3 className="rtd-title" id="rtd-title">{`Devolver al ${targetLabel}`}</h3>
        <p className="rtd-text" id="rtd-description">
          {`¿Estás seguro de que deseas devolver esta orden al ${targetLabel.toLowerCase()} para correcciones? El estado cambiará a "${nextStatusLabel}".`}
        </p>
        <div className="rtd-form-group">
          <label className="rtd-input-label" htmlFor="return-to-designer-reason">Razón de la devolución</label>
          <textarea
            id="return-to-designer-reason"
            className="rtd-textarea"
            placeholder="Describe los cambios o correcciones necesarias..."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={loading}
            rows={3}
          />
        </div>
        <div className="rtd-actions">
          <button type="button" className="rtd-button rtd-button--secondary" onClick={handleClose} disabled={loading}>Cancelar</button>
          <button type="button" className="rtd-button rtd-button--return" onClick={handleConfirm} disabled={loading || !canConfirm}>
            {loading ? "Devolviendo..." : `Devolver al ${targetLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
