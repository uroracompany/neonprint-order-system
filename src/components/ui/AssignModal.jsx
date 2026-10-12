import { useState, useEffect } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import AssignmentModalShell from "./AssignmentModalShell";
import "./AssignModal.css";

const ROLE_CONFIG = {
  designer: {
    label: "Diseñador",
    color: "#8B5CF6",
    iconColor: "#7C3AED",
    description: "Selecciona el diseñador responsable",
    filterRole: "designer",
  },
  quote: {
    label: "Caja",
    color: "#0284C7",
    iconColor: "#0284C7",
    description: "Selecciona el usuario responsable de caja",
    filterRole: "quote",
  },
  printer: {
    label: "Impresor",
    color: "#F97316",
    iconColor: "#9A3412",
    description: "Selecciona el impresor que recibirá esta orden para producción",
    filterRole: "printer",
  },
  delivery: {
    label: "Entrega",
    color: "#059669",
    iconColor: "#059669",
    description: "Selecciona el usuario responsable de entrega",
    filterRole: "delivery",
  },
};

export function AssignModal({
  open,
  onClose,
  onConfirm,
  order,
  loading,
  role,
  filterActive = false,
  defaultUserId = "",
  lockedDeliveryId = "",
  allowSelfAssignment = false,
  currentUserId = "",
  currentResponsibleId = "",
  allowUnassigned = false,
  title: customTitle,
  description: customDescription,
}) {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState("");

  const config = ROLE_CONFIG[role] || ROLE_CONFIG.designer;
  const hasLockedDelivery = role === "delivery" && !!lockedDeliveryId;
  const effectiveDefaultUserId = hasLockedDelivery ? lockedDeliveryId : defaultUserId;
  const hasDefaultUser = !!effectiveDefaultUserId;
  const isCurrentUserResponsible = Boolean(allowSelfAssignment && currentUserId && currentResponsibleId === currentUserId);

  useEffect(() => {
    if (!open) return;
    setLoadingUsers(true);
    setSelectedUserId("");
    setError("");

    let query = supabase
      .from("profiles")
      .select("id, name, role")
      .eq("role", config.filterRole);

    if (filterActive) {
      query = query
        .or("employment_status.eq.true,employment_status.is.null")
        .is("deleted_at", null);
    } else if (hasLockedDelivery) {
      query = query.eq("employment_status", true);
    }
    if (hasLockedDelivery) {
      query = query.eq("id", lockedDeliveryId);
    }

    const semiAdminQuery = allowSelfAssignment && role !== "quote"
      ? supabase
        .from("profiles")
        .select("id, name, role")
        .eq("role", "semi_admin")
        .eq("employment_status", true)
        .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null });

    Promise.all([query, semiAdminQuery]).then(([{ data, error: fetchError }, { data: semiAdmins, error: semiAdminError }]) => {
      setLoadingUsers(false);
      if (fetchError || semiAdminError) {
        setError("Error al cargar usuarios");
        setUsers([]);
        return;
      }
      const candidates = [...(data || [])];
      (semiAdmins || []).forEach((profile) => {
        if (!candidates.some((candidate) => candidate.id === profile.id)) candidates.push(profile);
      });
      const mapped = candidates.map((p) => ({
        ...p,
        displayName: p.id === currentUserId && p.role === "semi_admin"
          ? "Yo (Semi-Administrador)"
          : (p.name || config.label),
      }));

      if (hasDefaultUser) {
        mapped.sort((a, b) => {
          if (a.id === effectiveDefaultUserId) return -1;
          if (b.id === effectiveDefaultUserId) return 1;
          return 0;
        });
      }

      setUsers(mapped);
      if (hasDefaultUser && effectiveDefaultUserId && mapped.some((profile) => profile.id === effectiveDefaultUserId)) {
        setSelectedUserId(effectiveDefaultUserId);
      }
    });
  }, [open, config.filterRole, config.label, filterActive, hasDefaultUser, effectiveDefaultUserId, hasLockedDelivery, lockedDeliveryId, allowSelfAssignment, currentUserId, role]);

  const handleConfirm = () => {
    if (!selectedUserId && !allowUnassigned) {
      setError("Debes seleccionar un usuario.");
      return;
    }
    setError("");
    onConfirm(selectedUserId);
  };

  if (!open || !order) return null;

  const modalTitle = customTitle || (hasDefaultUser ? `Enviar a ${config.label}` : `Asignar ${config.label}`);

  return (
    <AssignmentModalShell
      open={open}
      onRequestClose={onClose}
      loading={loading}
      order={order}
      title={modalTitle}
      description={customDescription || config.description}
      variant={role}
      dialogClassName="ams-assign-modal"
      footer={(
        <div className="ams-assign-actions">
          <button type="button" className="ams-assign-button ams-assign-button--secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="button" className="ams-assign-button ams-assign-button--primary" onClick={handleConfirm} disabled={loading || (!selectedUserId && !allowUnassigned)}>
            {role === "delivery"
              ? <Icons.Truck aria-hidden="true" />
              : <Icons.Send aria-hidden="true" />}
            {loading ? "Asignando..." : "Asignar Orden"}
          </button>
        </div>
      )}
    >
      <div className="ams-assign-content">
        {hasLockedDelivery && (
          <div className="ams-assign-warning" role="note">
            Esta orden fue devuelta. Solo se puede reenviar al {config.label.toLowerCase()} que la devolvi&oacute;.
          </div>
        )}

        {loadingUsers ? (
          <div className="ams-assign-state" role="status">Cargando {config.label.toLowerCase()}s...</div>
        ) : users.length === 0 && error ? (
          <div className="ams-assign-state ams-assign-state--empty" role="alert">{error}</div>
        ) : users.length === 0 ? (
          <div className="ams-assign-state ams-assign-state--empty" role="status">
            {hasLockedDelivery ? (
              `El ${config.label.toLowerCase()} original ya no está activo; la orden no puede reenviarse.`
            ) : (
              `No hay ${config.label.toLowerCase()}s disponibles`
            )}
          </div>
        ) : (
          <div className="ams-assign-fields">
            {allowSelfAssignment && !isCurrentUserResponsible && users.some((user) => user.id === currentUserId) && (
              <button
                type="button"
                className="ams-assign-self"
                onClick={() => { setSelectedUserId(currentUserId); setError(""); }}
                disabled={loading || hasLockedDelivery}
                style={{ "--assign-accent": config.color, "--assign-accent-ink": config.iconColor }}
              >
                Asignarme a mí como responsable de {config.label}
              </button>
            )}
            <label className="ams-assign-select-label" htmlFor={`ams-assign-user-${role}`}>
              Responsable de {config.label.toLowerCase()}
            </label>
            <div className="ams-assign-select-wrap">
              <select
                id={`ams-assign-user-${role}`}
                className={`ams-assign-select${error ? " is-invalid" : ""}`}
                value={selectedUserId}
                onChange={(e) => { setSelectedUserId(e.target.value); setError(""); }}
                disabled={loading || hasLockedDelivery || (hasDefaultUser && users.length <= 1 && users.some((user) => user.id === effectiveDefaultUserId))}
              >
                <option value="">{allowUnassigned ? "Sin seleccionar — asignarme a mí al enviar" : `-- Seleccionar ${config.label} --`}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}{u.id === effectiveDefaultUserId ? " (Original)" : ""}
                  </option>
                ))}
              </select>
              <Icons.ChevronDown aria-hidden="true" focusable="false" />
            </div>
            {error && <div className="ams-assign-error" role="alert">{error}</div>}
          </div>
        )}

        {loading && <div className="ams-assign-loading" role="status">Enviando orden...</div>}
      </div>
    </AssignmentModalShell>
  );
}
