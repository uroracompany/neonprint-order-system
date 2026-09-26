import { Icons } from "../../utils/icons";
import "./ArchiveOrderModal.css";

export default function ArchiveOrderModal({
  open,
  onClose,
  onConfirm,
  order,
  loading,
  title = "Archivar orden",
  confirmText = "Archivar orden",
  cancelText = "Cancelar",
  children,
  className = "",
  variant = "archive",
  loadingText,
  confirmIcon,
}) {
  if (!open || !order) return null;

  const isDanger = variant === "danger";
  const stripeClass = `archive-modal-stripe${isDanger ? " danger" : ""}`;
  const btnClass = `archive-btn ${isDanger ? "archive-btn-danger" : "archive-btn-primary"}`;

  return (
    <div className="archive-modal-overlay" onClick={onClose}>
      <div className={`archive-modal ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        <div className={stripeClass} />
        <div className="archive-modal-header">
          <div className="archive-modal-title">
            <h3>{title}</h3>
          </div>
          <button className="archive-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>
        <div className="archive-modal-body">
          {children || (
            <>
              <p>
                ¿Deseas archivar la orden{" "}
                <strong>
                  #{order.id?.slice(0, 8).toUpperCase()}
                </strong>
                ?
              </p>
              <p className="archive-modal-hint">
                Las órdenes archivadas no se mostrarán en la vista principal.
              </p>
            </>
          )}
        </div>
        <div className="archive-modal-footer">
          <button className="archive-btn archive-btn-secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button className={btnClass} onClick={onConfirm} disabled={loading}>
            {loading ? (
              <>
                <span className="archive-btn-spinner" />
                {loadingText || (isDanger ? "Eliminando..." : "Archivando...")}
              </>
            ) : (
              <>
                {confirmIcon || (isDanger ? <Icons.Trash /> : <Icons.Archive />)}
                {confirmText}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
