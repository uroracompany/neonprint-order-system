import { useEffect, useRef } from "react";
import { Icons } from "../../utils/icons";
import "./AssignmentModalShell.css";

export default function AssignmentModalShell({ open, onRequestClose, title, description, order, loading = false, children, footer, variant = "default", dialogClassName = "", titleId = "ams-title", descriptionId = "ams-description" }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      (firstFocusable || dialogRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [open]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      if (!loading) onRequestClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  if (!open) return null;
  return (
    <div className="ams-overlay" onClick={(event) => event.target === event.currentTarget && !loading && onRequestClose?.()}>
      <section ref={dialogRef} className={`ams-dialog ams-dialog--${variant} ${dialogClassName}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex="-1" onKeyDown={handleKeyDown}>
        <header className="ams-header"><div><h3 id={titleId}>{title}</h3>{order?.id && <div className="ams-order-summary"><span className="ams-order-id">#{order.id.slice(0, 8).toUpperCase()}</span><span className="ams-order-separator" aria-hidden="true">·</span><span className="ams-order-client">{order.client_name || "Orden"}</span></div>}</div><button type="button" onClick={onRequestClose} disabled={loading} aria-label="Cerrar"><Icons.Close /></button></header>
        <div className="ams-body"><p id={descriptionId}>{description}</p>{children}</div>
        {footer && <footer className="ams-footer">{footer}</footer>}
      </section>
    </div>
  );
}
