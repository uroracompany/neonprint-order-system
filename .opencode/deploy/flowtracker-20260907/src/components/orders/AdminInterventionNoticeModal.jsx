import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "../../utils/icons";
import "./AdminInterventionNoticeModal.css";

const ACTION_ICONS = {
  assignment_received: Icons.Users,
  assignment_removed: Icons.ArrowLeft,
  work_paused: Icons.AlertCircle,
  work_resumed: Icons.CheckCircle,
  work_cancelled: Icons.AlertCircle,
};

export default function AdminInterventionNoticeModal({ notice, recipientName, onAcknowledge, acknowledging = false, error = "" }) {
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const acknowledgeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const metadata = notice?.metadata || {};
  const Icon = ACTION_ICONS[metadata.template_key] || Icons.Bell;
  const title = notice?.label || "Administración actualizó tu orden";
  const message = notice?.summary || `Hola, ${recipientName || ""}. Administración realizó un cambio que requiere tu atención.`;
  const deepLink = metadata.deep_link;
  const noticeId = notice?.id;

  useEffect(() => {
    if (!noticeId) return undefined;

    previousFocusRef.current = document.activeElement;
    acknowledgeButtonRef.current?.focus();

    const trapFocus = (event) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const elements = Array.from(focusable);
      if (!elements.length) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previousFocusRef.current?.focus?.();
    };
  }, [noticeId]);

  if (!notice) return null;

  const handleViewOrder = async () => {
    const acknowledged = await onAcknowledge();
    if (acknowledged !== false && deepLink) navigate(deepLink);
  };

  return (
    <div className="ainm-overlay" role="presentation">
      <section ref={dialogRef} className="ainm-modal" role="dialog" aria-modal="true" aria-labelledby="ainm-title" aria-describedby="ainm-message">
        <header className="ainm-header">
          <span className="ainm-icon" aria-hidden="true"><Icon /></span>
          <div>
            <span>Actualización de la orden</span>
            <h2 id="ainm-title">{title}</h2>
          </div>
        </header>
        <div className="ainm-body">
          <p id="ainm-message" className="ainm-message">{message}</p>
          <div className="ainm-order" aria-label="Resumen de la orden">
            <span>Orden #{metadata.order_code || notice.order_id?.slice(0, 8).toUpperCase()}</span>
            <strong>{metadata.client_name || "Orden de cliente"}</strong>
          </div>
          {metadata.reason_detail ? <div className="ainm-reason"><strong>Motivo de administración</strong><p>{metadata.reason_detail}</p></div> : null}
          {error ? <p className="ainm-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          {deepLink ? <button type="button" className="secondary" onClick={handleViewOrder} disabled={acknowledging}>Ver orden</button> : null}
          <button ref={acknowledgeButtonRef} type="button" className="primary" onClick={onAcknowledge} disabled={acknowledging}>{acknowledging ? "Confirmando…" : "Entendido"}</button>
        </footer>
      </section>
    </div>
  );
}
