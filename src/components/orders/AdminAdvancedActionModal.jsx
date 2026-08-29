import { useEffect, useMemo, useState } from "react";
import { Icons } from "../../utils/icons";
import { ORDER_STATUS, PAYMENT_COLORS, PAYMENT_STATUS } from "../../utils/constants";
import { getMinimumDeliveryDate, isPastDeliveryDateChange } from "../../utils/deliveryDate";
import { getAdminActionPresentation, getAdminReasonOptions, getAdminTargetSelector } from "../../utils/adminActionPresentation";
import "./AdminAdvancedActionModal.css";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

export default function AdminAdvancedActionModal({
  open,
  actionKey,
  action = null,
  order,
  profiles = [],
  currentUserId = null,
  onConfirm,
  onClose,
  children,
}) {
  const [targetUserId, setTargetUserId] = useState("");
  const [reasonCategory, setReasonCategory] = useState("workflow_correction");
  const [reasonDetail, setReasonDetail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [expectedResolutionAt, setExpectedResolutionAt] = useState("");
  const [orderType, setOrderType] = useState("orden normal");
  const [designType, setDesignType] = useState("INTERNAL_DESING");
  const [impactMode, setImpactMode] = useState("preserve_stage");
  const [requirementChanges, setRequirementChanges] = useState({ description: "", material: "", termination_type: "", delivery_date: "" });

  const quoteUsers = useMemo(() => profiles.filter((p) => p.role === "quote" && p.employment_status !== false && !p.deleted_at), [profiles]);
  const sellerUsers = useMemo(() => profiles.filter((p) => p.role === "seller" && p.employment_status !== false && !p.deleted_at), [profiles]);
  const designUsers = useMemo(() => profiles.filter((p) => p.role === "designer" && p.employment_status !== false && !p.deleted_at), [profiles]);

  useEffect(() => {
    if (!open || !order) return;
    if (actionKey === "set_quote_assignee") setTargetUserId(order.quote_id || "");
    else if (actionKey === "route_sales") setTargetUserId(order.seller_id || "");
    else if (actionKey === "route_design") setTargetUserId(order.designer_id || "");
    else if (actionKey === "set_designer_assignee") setTargetUserId(order.designer_id || "");
    else if (actionKey === "assign_seller") setTargetUserId(order.seller_id || "");
    else setTargetUserId("");
    setReasonCategory("workflow_correction");
    setReasonDetail("");
    setOwnerId(order.blocked_owner_id || currentUserId || "");
    setExpectedResolutionAt(order.blocked_expected_resolution_at?.slice(0, 16) || "");
    setOrderType(order.order_type === "orden 911" ? "orden 911" : "orden normal");
    setDesignType(order.order_design_type || "INTERNAL_DESING");
    setImpactMode("preserve_stage");
    setRequirementChanges({
      description: order.description || "",
      material: order.material || "",
      termination_type: order.termination_type || "",
      delivery_date: order.delivery_date?.slice(0, 10) || "",
    });
    setError("");
    setSubmitting(false);
  }, [open, actionKey, order, currentUserId]);

  if (!open || !actionKey) return null;

  const { title, description, Icon } = getAdminActionPresentation(action || { key: actionKey });
  const selectorConfig = getAdminTargetSelector(action || { key: actionKey });
  const showReason = action?.requires_reason !== false;
  const needsReason = action?.requires_reason !== false;
  const reasonMinLength = action?.reason_min_length || 10;
  const reasonOptions = getAdminReasonOptions(action || { key: actionKey });
  const impactModes = action?.requirements?.impact_modes || ["preserve_stage", "restart_flow"];
  const activeProfiles = profiles.filter((profile) => profile.employment_status !== false && !profile.deleted_at);

  const handleSubmit = async () => {
    setError("");

    if (selectorConfig && !selectorConfig.optional && !targetUserId) {
      return setError(`Selecciona un ${selectorConfig.users === "quote" ? "usuario de Caja" : selectorConfig.users === "seller" ? "vendedor" : "diseñador"}.`);
    }
    if (actionKey === "route_sales" && !targetUserId) {
      return setError("Selecciona un usuario de Ventas.");
    }
    if (actionKey === "assign_seller" && !targetUserId) {
      return setError("Selecciona un vendedor.");
    }
    if (showReason && needsReason) {
      if (!reasonCategory) return setError("Selecciona una categoría del motivo.");
      if (reasonDetail.trim().length < reasonMinLength) return setError(`Explica el motivo con al menos ${reasonMinLength} caracteres.`);
    }
    if (["block_order", "update_block"].includes(actionKey) && !ownerId) {
      return setError("Selecciona un responsable para resolver el bloqueo.");
    }
    if (["block_order", "update_block"].includes(actionKey) && !expectedResolutionAt) {
      return setError("Indica una fecha estimada de resolución.");
    }
    if (actionKey === "update_requirements" && isPastDeliveryDateChange(requirementChanges.delivery_date, order?.delivery_date)) {
      return setError("La fecha de entrega no puede ser anterior a hoy.");
    }

    const payload = { target_user_id: targetUserId || null };
    if (["block_order", "update_block"].includes(actionKey)) {
      payload.owner_id = ownerId;
      payload.expected_resolution_at = new Date(expectedResolutionAt).toISOString();
    }
    if (actionKey === "set_priority") payload.order_type = orderType;
    if (actionKey === "reclassify_design") {
      payload.design_type = designType;
      payload.impact_mode = impactMode;
    }
    if (actionKey === "update_requirements") {
      payload.design_type = designType;
      payload.impact_mode = impactMode;
      payload.changes = requirementChanges;
    }

    setSubmitting(true);
    try {
      await onConfirm({
        action: actionKey,
        targetUserId: targetUserId || null,
        reasonCategory: showReason ? reasonCategory : "workflow_correction",
        reasonDetail: showReason ? reasonDetail.trim() : "Acción desde configuración avanzada.",
        expectedUpdatedAt: order.updated_at,
        payload,
      });
    } catch (err) {
      setError(err?.message || "Error al ejecutar la acción.");
    } finally {
      setSubmitting(false);
    }
  };

  const getUserList = () => {
    if (!selectorConfig) return [];
    switch (selectorConfig.users) {
      case "quote": return quoteUsers;
      case "seller": return sellerUsers;
      case "designer": return designUsers;
      default: return [];
    }
  };

  return (
    <div className="aam-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="aam-modal" role="dialog" aria-modal="true" aria-labelledby="aam-title">
        <header className="aam-header">
          <div>
            <h2 id="aam-title">{title}</h2>
            <p>Orden #{order?.order_number || order?.order_code || order?.id?.slice(0, 8).toUpperCase()}</p>
          </div>
          <button className="aam-close-button" type="button" onClick={onClose} aria-label="Cerrar">
            <Icons.Close />
          </button>
        </header>

        <div className="aam-body">
          <div className="aam-form-title">
            <span className={`aam-action-icon is-${actionKey}`}><Icon /></span>
            <div><h3>{title}</h3><p>{description}</p></div>
          </div>

          {children && <div className="aam-body-section">{children}</div>}

          {["block_order", "update_block"].includes(actionKey) && (
            <div className="aam-reason-grid aam-body-section">
              <label className="aam-field">
                <span>Responsable de resolver</span>
                <div className="aam-select-wrap">
                  <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={submitting}>
                    <option value="">Seleccionar responsable</option>
                    {activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{getUserDisplayName(profile)}</option>)}
                  </select>
                  <Icons.ChevronDown aria-hidden="true" />
                </div>
              </label>
              <label className="aam-field">
                <span>Resolución estimada</span>
                <input type="datetime-local" value={expectedResolutionAt} onChange={(event) => setExpectedResolutionAt(event.target.value)} disabled={submitting} />
              </label>
            </div>
          )}

          {actionKey === "set_priority" && (
            <label className="aam-field aam-body-section">
              <span>Nueva prioridad</span>
              <div className="aam-select-wrap">
                <select value={orderType} onChange={(event) => setOrderType(event.target.value)} disabled={submitting}>
                  <option value="orden normal">Normal</option>
                  <option value="orden 911">911</option>
                </select>
                <Icons.ChevronDown aria-hidden="true" />
              </div>
            </label>
          )}

          {["reclassify_design", "update_requirements"].includes(actionKey) && (
            <div className="aam-reason-grid aam-body-section">
              <label className="aam-field">
                <span>Tipo de diseño</span>
                <div className="aam-select-wrap">
                  <select value={designType} onChange={(event) => setDesignType(event.target.value)} disabled={submitting}>
                    <option value="INTERNAL_DESING">Diseño interno</option>
                    <option value="EXTERNAL_DESING">Diseño externo</option>
                  </select>
                  <Icons.ChevronDown aria-hidden="true" />
                </div>
              </label>
              <label className="aam-field">
                <span>Impacto en el flujo</span>
                <div className="aam-select-wrap">
                  <select value={impactMode} onChange={(event) => setImpactMode(event.target.value)} disabled={submitting}>
                    {impactModes.includes("preserve_stage") && <option value="preserve_stage">Conservar etapa actual</option>}
                    {impactModes.includes("restart_flow") && <option value="restart_flow">Reiniciar en Diseño/Caja</option>}
                  </select>
                  <Icons.ChevronDown aria-hidden="true" />
                </div>
              </label>
              {impactMode === "restart_flow" ? <p className="aam-hint">Se conservarán pagos y archivos, pero se limpiarán responsables posteriores y Producción volverá a Pendiente.</p> : null}
            </div>
          )}

          {actionKey === "update_requirements" && (
            <div className="aam-body-section">
              <label className="aam-field"><span>Descripción</span><textarea rows={3} value={requirementChanges.description} onChange={(event) => setRequirementChanges((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="aam-field"><span>Material</span><input value={requirementChanges.material} onChange={(event) => setRequirementChanges((current) => ({ ...current, material: event.target.value }))} /></label>
              <label className="aam-field"><span>Terminación</span><input value={requirementChanges.termination_type} onChange={(event) => setRequirementChanges((current) => ({ ...current, termination_type: event.target.value }))} /></label>
              <label className="aam-field"><span>Fecha de entrega</span><input type="date" value={requirementChanges.delivery_date} min={getMinimumDeliveryDate()} onChange={(event) => setRequirementChanges((current) => ({ ...current, delivery_date: event.target.value }))} /></label>
            </div>
          )}

          {selectorConfig && (
            <label className="aam-field">
              <span>{selectorConfig.label}</span>
              <div className="aam-select-wrap">
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">{selectorConfig.optional ? "Sin asignar — Administración" : `Seleccionar ${selectorConfig.users === "quote" ? "responsable" : selectorConfig.users === "seller" ? "vendedor" : "diseñador"}`}</option>
                  {getUserList().map((item) => (
                    <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>
                  ))}
                </select>
                <Icons.ChevronDown aria-hidden="true" />
              </div>
              {selectorConfig.hint && <small>{selectorConfig.hint}</small>}
            </label>
          )}

          {["return_to_quote", "return_to_design", "mark_delivered", "return_to_completed", "return_to_design"].includes(actionKey) && (
            <p className="aam-hint">
              {actionKey === "return_to_quote" && "La orden regresará a Caja preservando los archivos y el responsable actual."}
              {actionKey === "return_to_design" && "La orden regresará a Diseño preservando los archivos y el diseñador actual."}
              {actionKey === "mark_delivered" && "La orden pasará a estado Entregado."}
              {actionKey === "return_to_completed" && "La orden regresará a Completado."}
            </p>
          )}

          {showReason && (
            <div className={`aam-reason-grid${children ? "" : " aam-body-section"}`}>
              <label className="aam-field">
                <span>Motivo</span>
                <div className="aam-select-wrap">
                  <select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value)}
                    disabled={submitting}
                  >
                    {reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <Icons.ChevronDown aria-hidden="true" />
                </div>
              </label>
              <label className="aam-field">
                <span>Detalle</span>
                <textarea
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value.slice(0, 500))}
                  placeholder={`Explica brevemente por qué se realiza este cambio (mínimo ${reasonMinLength} caracteres).`}
                  rows={4}
                  disabled={submitting}
                />
                <small className="aam-counter">{reasonDetail.length}/500</small>
              </label>
            </div>
          )}

          {error && <div className="aam-error"><Icons.AlertCircle />{error}</div>}
        </div>

        <footer className="aam-footer">
          <button type="button" className="aam-button" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button type="button" className="aam-button primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Guardando…" : "Confirmar cambio"}
          </button>
        </footer>
      </section>
    </div>
  );
}
