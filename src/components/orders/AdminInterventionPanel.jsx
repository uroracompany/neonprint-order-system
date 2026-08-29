import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { executeAdminOrderCommand } from "../../utils/adminOrderCommands";
import { getAdminActionPresentation, getAdminReasonOptions, getAdminTargetSelector } from "../../utils/adminActionPresentation";
import "./AdminInterventionPanel.css";

const getErrorMessage = (error) => error?.message || "No se pudo completar la intervención.";
const isActiveAssignableProfile = (profile) => profile?.employment_status === true && !profile?.deleted_at;

function ReasonFields({ idPrefix, options, category, detail, onCategoryChange, onDetailChange }) {
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
          {options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    const [availabilityResult, profilesResult, filesResult, areasResult] = await Promise.all([
      supabase.rpc("admin_get_order_command_catalog", { p_order_id: orderId }),
      supabase.from("profiles").select("id, name, email, role, employment_status, deleted_at").eq("employment_status", true).is("deleted_at", null),
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

  // File management has one canonical surface: AdminAdvancedSettings mounts
  // AdminManageFilesModal. This legacy panel never opens that modal, so it
  // must not present a selectable dead-end card for the capability.
  const allowedActions = (availability?.actions || []).filter((item) => item.key !== "manage_files");
  const action = allowedActions.find((item) => item.key === selectedAction) || null;
  const actionPresentation = getAdminActionPresentation(action || {});
  const actionLabel = actionPresentation.title;
  const actionTarget = getAdminTargetSelector(action || {});
  const actionReasonOptions = getAdminReasonOptions(action || {});
  const participatingAreas = useMemo(() => {
    const codes = new Set(files.map((file) => file.production_area_code).filter(Boolean));
    return areas.filter((area) => codes.has(area.code));
  }, [areas, files]);
  const targetRole = action?.requirements?.target_role;
  const targetProfiles = targetRole
    ? profiles.filter((profile) => profile.role === targetRole && isActiveAssignableProfile(profile))
    : [];
  const isOptionalQuoteAssignment = actionTarget?.optional === true;
  const requiresAreaAssignments = action?.requirements?.requires_area_assignments === true;

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
    if (targetRole && !targetUserId && !isOptionalQuoteAssignment) {
      return setError("Selecciona un responsable.");
    }
    if (requiresAreaAssignments && participatingAreas.some((area) => !areaAssignments[area.code])) {
      return setError("Asigna un responsable para cada área participante.");
    }

    setSaving(true);
    setError("");
    setSuccess("");
    let data;
    let rpcError;
    try {
      data = await executeAdminOrderCommand(supabase, {
        orderId,
        action: action.key,
        payload: {
          target_user_id: targetUserId || null,
          area_assignments: requiresAreaAssignments ? areaAssignments : {},
        },
        reasonCategory,
        reasonDetail: reasonDetail.trim(),
        expectedUpdatedAt: availability.expected_updated_at,
      });
    } catch (requestError) {
      rpcError = requestError;
    }
    setSaving(false);
    if (rpcError) return setError(getErrorMessage(rpcError));
    setSuccess("Cambio guardado correctamente.");
    setSelectedAction("");
    setTargetUserId("");
    setReasonCategory("");
    setReasonDetail("");
    await onChanged?.(data?.order || data);
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
            const { title, description } = getAdminActionPresentation(item);
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
                  <strong>{title}</strong>
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
            {targetRole ? (
              <label htmlFor="admin-target-user">
                {actionTarget?.label || "Responsable"}{isOptionalQuoteAssignment ? " (opcional)" : ""}
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
                  <small>{actionTarget?.hint || "Puedes asignarlo ahora o dejar que Administración gestione la orden."}</small>
                ) : null}
              </label>
            ) : null}

            {requiresAreaAssignments ? (
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
                      {profiles.filter((profile) => profile.role === area.producer_role && isActiveAssignableProfile(profile)).map((profile) => (
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
            options={actionReasonOptions}
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

      {error ? <p className="admin-intervention-error" role="alert">{error}</p> : null}
      {success ? <p className="admin-intervention-success" role="status">{success}</p> : null}
    </section>
  );
}
