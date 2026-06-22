import { Icons } from "../../utils/icons";
import "./SettleCreditModal.css";

export default function SettleCreditModal({
  open,
  onClose,
  onConfirm,
  clientName,
  invoiceCount,
  invoices = [],
  loading,
  notes,
  onNotesChange,
}) {
  if (!open) return null;

  return (
    <div className="settle-modal-overlay" onClick={onClose}>
      <div className="settle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settle-modal-stripe" />
        <div className="settle-modal-header">
          <div className="settle-modal-title">
            <h3>Marcar crédito saldado</h3>
          </div>
          <button className="settle-modal-close" onClick={onClose}>
            <Icons.Close />
          </button>
        </div>
        <div className="settle-modal-body">
          <p>
            ¿Deseas marcar las facturas pendientes de{" "}
            <strong>{clientName || "este cliente"}</strong> como saldadas?
          </p>
          {invoiceCount > 0 && (
            <p className="settle-modal-count">
              <Icons.Receipt /> {invoiceCount} factura{invoiceCount === 1 ? "" : "s"} a cerrar
            </p>
          )}
          {invoices.length > 0 && (
            <div className="settle-modal-invoices">
              {invoices.map((inv) => (
                <span key={inv} className="settle-modal-invoice-badge">
                  {inv}
                </span>
              ))}
            </div>
          )}
          <label className="settle-modal-field">
            <span>Nota de cierre <small>(opcional)</small></span>
            <textarea
              value={notes || ""}
              onChange={(e) => onNotesChange?.(e.target.value)}
              rows={3}
              placeholder="Ej: Factura saldada en el sistema financiero externo"
            />
          </label>
        </div>
        <div className="settle-modal-footer">
          <button className="settle-btn settle-btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button className="settle-btn settle-btn-primary" onClick={onConfirm} disabled={loading}>
            {loading ? (
              <>
                <span className="settle-btn-spinner" />
                Cerrando...
              </>
            ) : (
              <>
                <Icons.Check />
                Marcar saldado{invoiceCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
