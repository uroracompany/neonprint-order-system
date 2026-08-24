import { useEffect, useState } from "react";
import { Icons } from "../../utils/icons";
import "../../css-components/page-quote.css";

export default function ReturnToCashierModal({ open, handoff, order, onClose, onConfirm, loading = false }) {
  const [note, setNote] = useState("");

  useEffect(() => { if (open) setNote(""); }, [open, handoff?.id]);
  if (!open || !handoff) return null;

  return (
    <div className="pq-overlay" onClick={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <div className="pq-dialog">
        <div className="pq-dialog-icon return"><Icons.ArrowLeft /></div>
        <h3 className="pq-dialog-title">Regresar a Caja</h3>
        <p className="pq-dialog-text">Describe exactamente qué corregiste antes de regresar la orden a {handoff.cashier_name || "Caja"}.</p>
        <div className="pq-dialog-order"><span className="pq-dialog-order-id">#{order?.id?.slice(0, 8).toUpperCase()}</span><span className="pq-dialog-order-name">{order?.client_name || order?.description || "Orden"}</span></div>
        <div className="pq-form-group">
          <label className="pq-input-label" htmlFor="return-correction-note">Corrección realizada</label>
          <textarea id="return-correction-note" className="pq-input pq-textarea" value={note} onChange={(event) => setNote(event.target.value)} rows={3} disabled={loading} placeholder="Indica los cambios realizados..." />
        </div>
        <div className="pq-dialog-actions">
          <button className="pq-btn pq-btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="pq-btn pq-btn-primary" onClick={() => onConfirm(note)} disabled={loading || !note.trim()}>{loading ? "Regresando..." : "Regresar a Caja"}</button>
        </div>
      </div>
    </div>
  );
}
