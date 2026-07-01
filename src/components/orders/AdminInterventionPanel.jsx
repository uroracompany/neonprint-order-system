import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { getProductionAreaLabel, PRODUCTION_FILE_STATUS_LABELS } from "../../utils/constants";
import "./AdminInterventionPanel.css";

const REASONS = [
  ["client_request", "Solicitud del cliente"],
  ["assignment_correction", "Corrección de responsable"],
  ["workflow_correction", "Corrección de flujo"],
  ["quality_rework", "Retrabajo o calidad"],
  ["operational_priority", "Prioridad operativa"],
  ["other", "Otro"],
];

const NEXT_FILE_STATUSES = {
  pending: [["in_production", "Iniciar producción"]],
  in_production: [["in_termination", "Enviar a terminación"]],
  in_termination: [["in_production", "Volver a producción"], ["completed", "Completar"]],
  completed: [["in_termination", "Reabrir en terminación"]],
};

const ACTION_COPY = {
  assign_seller: ["Cambiar vendedor", "Reasigna al vendedor sin mover la orden."],
  route_sales: ["Enviar a Ventas", "Devuelve la orden a Ventas."],
  route_design: ["Enviar a Diseño", "Asigna la orden al equipo de Diseño."],
  route_quote: ["Enviar a Caja", "Deja la orden lista para que Caja gestione el pago."],
  route_production: ["Enviar a Producción", "Asigna responsables e inicia la producción."],
  reassign_production: ["Cambiar responsables", "Reasigna las áreas de producción activas."],
  route_completed: ["Enviar a Entrega", "Asigna Delivery y prepara la entrega."],
};

const getActionCopy = (action) => ACTION_COPY[action?.key] || [action?.label || "Aplicar ajuste", ""];
const getErrorMessage = (error) => error?.message || "No se pudo completar la intervención.";
const isActionRelevantForOrder = (action, order) => {
  const isExternalOrderInSales = order?.status === "Pending"
    && order?.order_design_type === "EXTERNAL_DESING";
  return !isExternalOrderInSales || action.key === "route_quote";
};

function ReasonFields({ idPrefix, category, detail, onCategoryChange, onDetailChange }) {
  return (
    <div className="admin-intervention-reason">
      <label htmlFor={`${idPrefix}-reason-category`}>
        Motivo
        <select
          id={`${idPrefix}-reason-category`}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          <option value="">Selecciona un motivo</option>
          {REASONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-reason-detail`}>
        Detalle
        <textarea
          id={`${idPrefix}-reason-detail`}
          value={detail}
          onChange={(event) => onDetailChange(event.target.value)}
          minLength={10}
          maxLength={500}
          placeholder="Explica brevemente por qué se realiza este cambio."
        />
        <small>{detail.trim().length}/500</small>
      </label>
    </div>
  );
}

export default function AdminInterventionPanel({ order, onChanged }) {
  const orderId = order?.id;
  const [availability, setAvailability] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [files, setFiles] = useState([]);
  const [areas, setAreas] = useState([]);
  const [selectedAction, setSelectedAction] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [areaAssignments, setAreaAssignments] = useState({});
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [fileReasonCategory, setFileReasonCategory] = useState("");
  const [fileReasonDetail, setFileReasonDetail] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    const [availabilityResult, profilesResult, filesResult, areasResult] = await Promise.all([
      supabase.rpc("get_admin_order_action_availability", { p_order_id: orderId }),
      supabase.from("profiles").select("id, name, email, role, employment_status").eq("employment_status", true),
      supabase.from("order_production_files")
        .select("id, public_label, status, production_area_code, assigned_to, updated_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      supabase.from("production_areas")
        .select("code, label, producer_role, is_active")
        .eq("is_active", true)
        .order("label"),
    ]);

    if (availabilityResult.error) {
      setError(getErrorMessage(availabilityResult.error));
    } else {
      setAvailability(availabilityResult.data);
    }
    setProfiles(profilesResult.data || []);
    setFiles(filesResult.data || []);
    setAreas(areasResult.data || []);
    setAreaAssignments((filesResult.data || []).reduce((acc, file) => {
      if (file.production_area_code && file.assigned_to && !acc[file.production_area_code]) {
        acc[file.production_area_code] = file.assigned_to;
      }
      return acc;
    }, {}));
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    setSelectedAction("");
    setTargetUserId("");
    setSuccess("");
    void refresh();
  }, [refresh]);

  const allowedActions = useMemo(
    () => (availability?.actions || []).filter(
      (item) => item.allowed && isActionRelevantForOrder(item, order),
    ),
    [availability?.actions, order],
  );
  const action = allowedActions.find((item) => item.key === selectedAction) || null;
  const [actionLabel] = getActionCopy(action);
  const participatingAreas = useMemo(() => {
    const codes = new Set(files.map((file) => file.production_area_code).filter(Boolean));
    return areas.filter((area) => codes.has(area.code));
  }, [areas, files]);
  const targetProfiles = action?.target_role
    ? profiles.filter((profile) => profile.role === action.target_role)
    : [];
  const isOptionalQuoteAssignment = action?.key === "route_quote";

  const validateReason = (category, detail) => {
    if (!category) return "Selecciona un motivo.";
    const length = detail.trim().length;
    if (length < 10 || length > 500) return "El detalle debe tener entre 10 y 500 caracteres.";
    return "";
  };

  const selectAction = (actionKey) => {
    setSelectedAction(actionKey);
    setTargetUserId("");
    setError("");
    setSuccess("");
  };

  const submitAction = async () => {
    const reasonError = validateReason(reasonCategory, reasonDetail);
    if (reasonError) return setError(reasonError);
    if (!action) return setError("Selecciona una acción disponible.");
    if (action.target_role && !targetUserId && !isOptionalQuoteAssignment) {
      return setError("Selecciona un responsable.");
    }
    if (action.requires_area_assignments && participatingAreas.some((area) => !areaAssignments[area.code])) {
      return setError("Asigna un responsable para cada área participante.");
    }

    setSaving(true);
    setError("");
    setSuccess("");
    const { data, error: rpcError } = await supabase.rpc("admin_intervene_order", {
      p_order_id: orderId,
      p_action: action.key,
      p_reason_category: reasonCategory,
      p_reason_detail: reasonDetail.trim(),
      p_expected_updated_at: availability.expected_updated_at,
      p_target_user_id: targetUserId || null,
      p_area_assignments: action.requires_area_assignments ? areaAssignments : {},
    });
    setSaving(false);
    if (rpcError) return setError(getErrorMessage(rpcError));
    setSuccess("Cambio guardado correctamente.");
    setSelectedAction("");
    setTargetUserId("");
    setReasonCategory("");
    setReasonDetail("");
    await onChanged?.(data);
    await refresh();
  };

  const updateFile = async (file, nextStatus) => {
    const reasonError = validateReason(fileReasonCategory, fileReasonDetail);
    if (reasonError) return setError(reasonError);
    if (nextStatus === "completed" && !deliveryId) {
      const otherIncomplete = files.some((item) => item.id !== file.id && item.status !== "completed");
      if (!otherIncomplete) return setError("Selecciona Delivery para completar el último archivo.");
    }
    setSaving(true);
    setError("");
    setSuccess("");
    const { error: rpcError } = await supabase.rpc("admin_update_production_file_status", {
      p_file_id: file.id,
      p_next_status: nextStatus,
      p_reason_category: fileReasonCategory,
      p_reason_detail: fileReasonDetail.trim(),
      p_expected_updated_at: file.updated_at,
      p_delivery_id: deliveryId || null,
    });
    setSaving(false);
    if (rpcError) return setError(getErrorMessage(rpcError));
    setSuccess("Estado del archivo actualizado.");
    setFileReasonCategory("");
    setFileReasonDetail("");
    await onChanged?.();
    await refresh();
  };

  if (loading) {
    return <section className="admin-intervention-panel"><p>Cargando ajustes disponibles...</p></section>;
  }

  return (
    <section className="admin-intervention-panel" aria-label="Ajustes avanzados">
      <div className="admin-intervention-head">
        <div>
          <h3>Ajustes avanzados</h3>
          <p>Elige qué necesitas hacer con esta orden.</p>
        </div>
        {order.last_admin_intervention_at ? <strong>Con ajustes</strong> : null}
      </div>

      <div className="admin-intervention-step-heading">
        <span>1</span>
        <div>
          <strong>Selecciona una acción</strong>
          <p>Solo aparecen las opciones disponibles para el estado actual.</p>
        </div>
      </div>

      {allowedActions.length > 0 ? (
        <div className="admin-intervention-actions">
          {allowedActions.map((item) => {
            const [label, description] = getActionCopy(item);
            return (
              <button
                type="button"
                key={item.key}
                className={selectedAction === item.key ? "selected" : ""}
                aria-pressed={selectedAction === item.key}
                disabled={saving}
                onClick={() => selectAction(item.key)}
              >
                <span className="admin-action-copy">
                  <strong>{label}</strong>
                  <span>{description}</span>
                </span>
                <span className="admin-action-check" aria-hidden="true">✓</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="admin-intervention-empty">No hay ajustes disponibles para esta orden.</p>
      )}

      {action ? (
        <div className="admin-intervention-editor">
          <div className="admin-intervention-step-heading">
            <span>2</span>
            <div>
              <strong>Completa el cambio</strong>
              <p>{actionLabel}</p>
            </div>
          </div>

          <div className="admin-intervention-form">
            {action.target_role ? (
              <label htmlFor="admin-target-user">
                {isOptionalQuoteAssignment ? "Usuario de Caja (opcional)" : "Responsable"}
                <select
                  id="admin-target-user"
                  value={targetUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                >
                  <option value="">
                    {isOptionalQuoteAssignment
                      ? "Sin asignar — lo gestiona Administración"
                      : "Selecciona un usuario activo"}
                  </option>
                  {targetProfiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>{profile.name || profile.email || profile.role}</option>
                  ))}
                </select>
                {isOptionalQuoteAssignment ? (
                  <small>Puedes asignarlo ahora o dejar que Administración gestione la orden.</small>
                ) : null}
              </label>
            ) : null}

            {action.requires_area_assignments ? (
              <div className="admin-area-assignments">
                <strong>Responsables por área</strong>
                {participatingAreas.map((area) => (
                  <label htmlFor={`admin-area-${area.code}`} key={area.code}>
                    {area.label}
                    <select
                      id={`admin-area-${area.code}`}
                      value={areaAssignments[area.code] || ""}
                      onChange={(event) => setAreaAssignments((current) => ({ ...current, [area.code]: event.target.value }))}
                    >
                      <option value="">Selecciona un responsable</option>
                      {profiles.filter((profile) => profile.role === area.producer_role).map((profile) => (
                        <option value={profile.id} key={profile.id}>{profile.name || profile.email || area.label}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <ReasonFields
            idPrefix="order"
            category={reasonCategory}
            detail={reasonDetail}
            onCategoryChange={setReasonCategory}
            onDetailChange={setReasonDetail}
          />

          <button type="button" className="admin-intervention-submit" onClick={submitAction} disabled={saving}>
            {saving ? "Guardando..." : `Confirmar: ${actionLabel}`}
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <details className="admin-production-files">
          <summary>
            <span>
              <strong>Archivos de producción</strong>
              <small>{files.length} {files.length === 1 ? "archivo" : "archivos"}</small>
            </span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="admin-production-files-body">
            <label htmlFor="admin-delivery-user">
              Delivery para completar el último archivo
              <select id="admin-delivery-user" value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)}>
                <option value="">Selecciona Delivery</option>
                {profiles.filter((profile) => profile.role === "delivery").map((profile) => (
                  <option value={profile.id} key={profile.id}>{profile.name || profile.email || "Delivery"}</option>
                ))}
              </select>
            </label>
            <ReasonFields
              idPrefix="file"
              category={fileReasonCategory}
              detail={fileReasonDetail}
              onCategoryChange={setFileReasonCategory}
              onDetailChange={setFileReasonDetail}
            />
            <div className="admin-production-file-list">
              {files.map((file) => (
                <article key={file.id}>
                  <div>
                    <strong>{file.public_label || "Archivo de producción"}</strong>
                    <span>{getProductionAreaLabel(file.production_area_code)} · {PRODUCTION_FILE_STATUS_LABELS[file.status] || file.status}</span>
                  </div>
                  <div>
                    {(NEXT_FILE_STATUSES[file.status] || []).map(([nextStatus, label]) => (
                      <button type="button" key={nextStatus} onClick={() => updateFile(file, nextStatus)} disabled={saving}>
                        {label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      {error ? <p className="admin-intervention-error" role="alert">{error}</p> : null}
      {success ? <p className="admin-intervention-success" role="status">{success}</p> : null}
    </section>
  );
}
