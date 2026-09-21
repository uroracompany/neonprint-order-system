import { useEffect, useMemo, useState } from "react";
import { getOrderFiles, getPreviewImage, getReferenceImages } from "../../utils/orderAssets";
import { Icons } from "../../utils/icons";
import "./SemiAdminOperationalPanel.css";

const STATUS_LABELS = { Pending: "Pendiente", pending: "Pendiente", in_Design: "Diseño", In_Design: "Diseño", in_Quote: "Caja", in_Production: "Producción", in_Termination: "Terminación", in_Completed: "Completada", in_Delivered: "Entregada", cancelled: "Cancelada" };
const STAGE_FIELDS = { design: "designer_id", quote: "quote_id", delivery: "delivery_id" };
const STAGE_LABELS = { design: "Diseño", quote: "Caja / Cotización", delivery: "Entrega" };
export default function SemiAdminOperationalPanel({ order, onAction, onLoadCatalog, onOpenDesignEditor, onOpenDesignReassignment, onOpenQuoteAssignment, onOpenQuoteResponsibilityReassignment, onOpenQuoteReturn, onOpenProductionAssignment, onOpenPayment, currentUserId, busy = false }) {
  const [catalog, setCatalog] = useState({ actions: [], unavailable_actions: [] });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const designFileCount = useMemo(() => getOrderFiles(order).length, [order]);
  const hasWorkOrder = Boolean(getPreviewImage(order));
  const referenceImageCount = useMemo(() => getReferenceImages(order).length, [order]);
  const attachedFileCount = designFileCount + referenceImageCount + (hasWorkOrder ? 1 : 0);
  const hasDesignAssets = useMemo(() => (
    designFileCount > 0
    || hasWorkOrder
    || referenceImageCount > 0
    || (Array.isArray(order?.order_production_files) && order.order_production_files.length > 0)
  ), [designFileCount, hasWorkOrder, order, referenceImageCount]);
  const assetRevision = useMemo(() => JSON.stringify({
    files: getOrderFiles(order),
    preview: getPreviewImage(order),
    references: getReferenceImages(order),
    productionFiles: Array.isArray(order?.order_production_files)
      ? order.order_production_files.map((file) => ({
        id: file?.id || null,
        url: file?.url || null,
        public_label: file?.public_label || null,
        status: file?.status || null,
        production_area_code: file?.production_area_code || null,
        material_names: Array.isArray(file?.material_names) ? file.material_names : [],
        termination_name: file?.termination_name || null,
        assigned_to: file?.assigned_to || null,
      }))
      : [],
  }), [order]);

  useEffect(() => {
    if (!order?.id || !onLoadCatalog) return undefined;
    let active = true;
    setCatalogLoading(true); setCatalogError("");
    Promise.resolve(onLoadCatalog(order.id))
      .then((next) => { if (active) setCatalog(next || { actions: [], unavailable_actions: [] }); })
      .catch((error) => { if (active) setCatalogError(error?.message || "No se pudo consultar las acciones disponibles."); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [assetRevision, onLoadCatalog, order?.id, order?.updated_at]);

  if (!order) return null;
  const actionKeys = new Set((catalog.actions || []).map((item) => item.key));
  const hasAction = (key) => actionKeys.has(key);
  const stage = order.status === "in_Design" || order.status === "In_Design" ? "design" : order.status === "in_Quote" ? "quote" : order.status === "in_Completed" ? "delivery" : null;
  const isProductionStage = order.status === "in_Production" || order.status === "in_Termination";
  const isQuoteStage = stage === "quote";
  const hasPendingPayment = order.payment_status === "Pending_Payment";
  const canManageQuoteResponsibility = isQuoteStage && hasPendingPayment && hasAction("stage_responsibility");
  const operationalHistory = Array.isArray(order.semi_admin_operational_history) ? order.semi_admin_operational_history : [];
  const candidates = catalog?.candidates || {};
  const stageCandidates = (stageKey) => Array.isArray(candidates[stageKey]) ? candidates[stageKey] : [];
  const run = (action, payload = {}) => onAction(action, { order_id: order.id, ...payload });
  const history = Array.isArray(catalog?.responsibility_history) ? catalog.responsibility_history : [];
  const canContinueToQuote = designFileCount > 0 && hasWorkOrder;

  return <div className="sa-op-workspace" aria-busy={busy || catalogLoading}>
    <div className="sa-op-intro"><div><span className="sa-op-eyebrow">Configuración operativa avanzada</span><p>Solo se muestran acciones válidas para la etapa actual. Pago, crédito y Producción permanecen a cargo de sus áreas autorizadas.</p></div><span className="sa-op-order-state">{STATUS_LABELS[order.status] || "Estado desconocido"}</span></div>
    {catalogLoading && <div className="sa-op-notice">Calculando las acciones disponibles…</div>}
    {catalogError && <div className="sa-op-notice sa-op-notice--error">{catalogError}</div>}
    {(catalog.unavailable_actions || []).map((item) => <div className="sa-op-notice" key={item.key}><strong>{item.title}:</strong> {item.next_safe_step}</div>)}

    {stage && <section className="sa-op-production sa-op-responsibility" aria-labelledby="sa-op-responsibility-title"><div className="sa-op-production-heading"><div><span className="sa-op-eyebrow">Responsabilidad por etapa</span><h4 id="sa-op-responsibility-title">{STAGE_LABELS[stage]}</h4></div></div>{(() => {
      const responsibleId = order[STAGE_FIELDS[stage]] || null;
      const responsible = stageCandidates(stage).find((item) => item.id === responsibleId);
      const isResponsible = Boolean(currentUserId && responsibleId === currentUserId);
      const responsibleLabel = isResponsible ? "Yo" : responsible?.name || "Sin asignar";
      if (stage === "design") return <div className="sa-op-responsibility-row"><span>Responsable actual: <strong>{responsibleLabel}</strong>{hasDesignAssets && <small className="sa-op-responsibility-lock">Para reasignar Diseño, elimina primero todos los archivos y la Orden de Trabajo.</small>}</span><div><button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy || hasDesignAssets || !onOpenDesignReassignment} onClick={onOpenDesignReassignment}>Reasignar Diseño <Icons.ArrowRight aria-hidden="true" /></button></div></div>;
      if (isQuoteStage) return canManageQuoteResponsibility ? <div className="sa-op-responsibility-row"><span>Responsable actual: <strong>{responsibleLabel}</strong></span><div><button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy || !onOpenQuoteResponsibilityReassignment} onClick={onOpenQuoteResponsibilityReassignment}>Cambiar responsable <Icons.ArrowRight aria-hidden="true" /></button></div></div> : null;
      return <div className="sa-op-responsibility-row"><span>Responsable actual: <strong>{responsibleLabel}</strong></span><div>{!isResponsible && <button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy || !currentUserId} onClick={() => run("stage_responsibility", { stage, assignee_id: currentUserId })}>Asignarme a mí <Icons.ArrowRight aria-hidden="true" /></button>}<select aria-label={`Reasignar responsable de ${STAGE_LABELS[stage]}`} value={responsibleId || ""} disabled={busy} onChange={(event) => event.target.value && run("stage_responsibility", { stage, assignee_id: event.target.value })}><option value="">Cambiar responsable…</option>{stageCandidates(stage).map((person) => <option key={person.id} value={person.id}>{person.name || "Usuario"}</option>)}</select></div></div>;
    })()}{history.length > 0 && <details className="sa-op-history"><summary>Historial de responsables ({history.length})</summary>{history.map((event, index) => <div key={event.id || `${event.created_at || "history"}-${index}`}>{event.changes?.stage || "Etapa"} · {event.created_at ? new Date(event.created_at).toLocaleString("es-DO") : "—"}</div>)}</details>}</section>}

    {hasAction("manage_design_assets") && <section className="sa-op-card sa-op-card--design" aria-labelledby="sa-op-design-title"><div className="sa-op-card-heading"><span className="sa-op-card-kicker">Diseño</span><h4 id="sa-op-design-title">Trabajo de Diseño</h4></div><div className="sa-op-design-actions"><div className="sa-op-design-action"><div><div className="sa-op-design-file-heading"><h5>Archivos de la orden</h5><span className="sa-op-file-count" aria-live="polite" aria-label={`${attachedFileCount} ${attachedFileCount === 1 ? "archivo adjunto" : "archivos adjuntos"}`}>{attachedFileCount}</span></div><p>Sube y revisa los archivos antes de continuar con la orden.</p><p className="sa-op-notice sa-op-notice--info">Para enviar la orden a Caja debes adjuntar al menos un archivo de diseño y una Orden de Trabajo.</p></div><button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy} onClick={onOpenDesignEditor}>Gestionar diseños y archivos <Icons.ArrowRight aria-hidden="true" /></button></div>{hasAction("send_design_to_quote") && canContinueToQuote && <div className="sa-op-design-action sa-op-design-action--forward"><div><h5>Continuar a Caja</h5><p>Selecciona el responsable dentro del modal de envío.</p></div><button className="sa-op-button sa-op-button--primary sa-op-button--advanced" type="button" disabled={busy || !onOpenQuoteAssignment} onClick={onOpenQuoteAssignment}>Enviar a Caja <Icons.ArrowRight aria-hidden="true" /></button></div>}</div>{hasAction("return_design_to_sales") && <div className="sa-op-design-return"><div><h5>Devolver a Ventas</h5><p>Indica el motivo para que el vendedor pueda retomar la orden.</p></div><label className="sa-op-field"><span>Motivo para regresar a Ventas</span><input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Describe el motivo de la devolución" disabled={busy} /></label><button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy || returnReason.trim().length < 10} onClick={() => run("return_design_to_sales", { reason: returnReason })}>Regresar a Ventas <Icons.ArrowRight aria-hidden="true" /></button></div>}</section>}

    {isQuoteStage && hasAction("register_payment") && <section className="sa-op-card" aria-labelledby="sa-op-payment-title"><div className="sa-op-card-heading"><span className="sa-op-card-kicker">Pago</span><h4 id="sa-op-payment-title">Gestionar estado de pago</h4></div><div className="sa-op-design-action"><div><p>Para confirmar un pago adjunta un comprobante o registra su número.</p></div><button className="sa-op-button sa-op-button--payment sa-op-button--advanced" type="button" disabled={busy || !onOpenPayment} onClick={onOpenPayment}>Gestionar pago <Icons.ArrowRight aria-hidden="true" /></button></div></section>}

    {isQuoteStage && hasPendingPayment && <section className="sa-op-card sa-op-card--pending-payment"><p className="sa-op-notice sa-op-notice--info">El pago está pendiente. Regístralo antes de preparar el envío a Producción.</p>{hasAction("return_quote_to_design") && <div className="sa-op-action-line"><button className="sa-op-button sa-op-button--soft sa-op-button--advanced" type="button" disabled={busy || !onOpenQuoteReturn} onClick={onOpenQuoteReturn}>Regresar a Diseño <Icons.ArrowRight aria-hidden="true" /></button></div>}</section>}

    {isQuoteStage && !hasPendingPayment && hasAction("route_production") && <section className="sa-op-card" aria-labelledby="sa-op-production-preparation-title"><div className="sa-op-card-heading"><span className="sa-op-card-kicker">Caja</span><h4 id="sa-op-production-preparation-title">Preparación para Producción</h4></div><div className="sa-op-design-action"><div><h5>Archivos listos</h5><p>Los archivos válidos pueden prepararse para Producción.</p></div><button className="sa-op-button sa-op-button--primary sa-op-button--advanced" type="button" disabled={busy || !onOpenProductionAssignment} onClick={onOpenProductionAssignment}>Preparar envío a Producción <Icons.ArrowRight aria-hidden="true" /></button></div></section>}

    {operationalHistory.length > 0 && <section className="sa-op-card sa-op-audit-history" aria-labelledby="sa-op-audit-title"><div className="sa-op-card-heading"><span className="sa-op-card-kicker">Auditoría interna</span><h4 id="sa-op-audit-title">Actividad operativa</h4></div><ol>{operationalHistory.map((event) => <li key={event.id}><strong>{event.label || event.event_type}</strong><span>{event.actor?.name || "Actor no disponible"} · {event.created_at ? new Date(event.created_at).toLocaleString("es-DO") : "—"}</span><small>{event.old_value || "—"} → {event.new_value || "—"}</small></li>)}</ol></section>}

    {isProductionStage && <section className="sa-op-boundary" aria-labelledby="sa-op-production-boundary-title"><span className="sa-op-card-kicker">Producción</span><h4 id="sa-op-production-boundary-title">Etapa de solo lectura</h4><p>La ejecución, reasignación y estado de los archivos corresponden exclusivamente al operador de Producción asignado.</p></section>}

    {hasAction("mark_delivered") && <section className="sa-op-card"><div className="sa-op-card-heading"><span className="sa-op-card-kicker">Entrega</span><h4>Confirmar entrega</h4></div><div className="sa-op-action-line"><button className="sa-op-button sa-op-button--primary" type="button" disabled={busy} onClick={() => run("mark_delivered")}>Marcar como entregada</button></div></section>}
  </div>;
}
