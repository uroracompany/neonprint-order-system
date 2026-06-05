import { useState, useEffect } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";

const ROLE_CONFIG = {
  designer: {
    label: "Diseñador",
    icon: "Edit",
    color: "#8B5CF6",
    gradient: "linear-gradient(135deg, #EDE9FE 0%, #C4B5FD 100%)",
    iconColor: "#7C3AED",
    description: "Selecciona el diseñador responsable",
    filterRole: "designer",
  },
  quote: {
    label: "Caja",
    icon: "Package",
    color: "#0284C7",
    gradient: "linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 100%)",
    iconColor: "#0284C7",
    description: "Selecciona el usuario responsable de caja",
    filterRole: "quote",
  },
  printer: {
    label: "Impresor",
    icon: "Package",
    color: "#F97316",
    gradient: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)",
    iconColor: "#9A3412",
    description: "Selecciona el impresor que recibirá esta orden para producción",
    filterRole: "printer",
  },
  delivery: {
    label: "Entrega",
    icon: "Truck",
    color: "#059669",
    gradient: "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)",
    iconColor: "#059669",
    description: "Selecciona el usuario responsable de entrega",
    filterRole: "delivery",
  },
};

const ICON_MAP = {
  Edit: Icons.Edit,
  Package: Icons.Package,
  Send: Icons.Send,
  Truck: Icons.Truck,
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
  title: customTitle,
  description: customDescription,
}) {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState("");

  const config = ROLE_CONFIG[role] || ROLE_CONFIG.designer;
  const IconComponent = ICON_MAP[config.icon];
  const hasDefaultUser = !!defaultUserId;

  useEffect(() => {
    if (!open) return;
    setLoadingUsers(true);
    setSelectedUserId("");
    setError("");

    let query = supabase
      .from("profiles")
      .select("id, name, role");

    if (filterActive) {
      query = query.eq("role", config.filterRole).eq("employment_status", true);
    } else {
      query = query.eq("role", config.filterRole);
    }

    query.then(({ data, error: fetchError }) => {
      setLoadingUsers(false);
      if (fetchError) {
        setError("Error al cargar usuarios");
        setUsers([]);
        return;
      }
      const mapped = (data || []).map((p) => ({
        ...p,
        displayName: p.name || config.label,
      }));

      if (hasDefaultUser) {
        mapped.sort((a, b) => {
          if (a.id === defaultUserId) return -1;
          if (b.id === defaultUserId) return 1;
          return 0;
        });
      }

      setUsers(mapped);
      if (hasDefaultUser && defaultUserId) {
        setSelectedUserId(defaultUserId);
      }
    });
  }, [open, config.filterRole, config.label, filterActive, hasDefaultUser, defaultUserId]);

  const handleConfirm = () => {
    if (!selectedUserId) {
      setError("Debes seleccionar un usuario.");
      return;
    }
    setError("");
    onConfirm(selectedUserId);
  };

  if (!open || !order) return null;

  const modalTitle = customTitle || (hasDefaultUser ? `Enviar a ${config.label}` : `Asignar ${config.label}`);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,30,64,0.35)", backdropFilter: "blur(6px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, maxWidth: 620, width: "90%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden",
        }}
      >
        <div style={{ height: 3, background: `linear-gradient(135deg, ${config.color} 0%, ${config.iconColor} 100%)` }} />

        <div style={{ display: "flex", alignItems: "center", padding: "16px 26px" }}>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 700, color: "#0f1e40" }}>
            {modalTitle}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6B7280", display: "flex" }}>
            <Icons.Close />
          </button>
        </div>

        <div style={{ padding: "0 26px 28px", textAlign: "center" }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: config.gradient,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
              boxShadow: `0 4px 12px ${config.color}40`,
            }}
          >
            {IconComponent && <IconComponent style={{ color: config.iconColor, width: 28, height: 28 }} />}
          </div>

          <p style={{ margin: "0 0 12px", fontSize: 15, color: "#374151", lineHeight: 1.5, fontWeight: 500 }}>
            {customDescription || config.description}
          </p>

          <div
            style={{
              background: "#F9FAFB", border: "1px solid #E5E7EB",
              borderRadius: 8, padding: "10px 14px", marginBottom: 16,
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: 12, color: "#6B7280" }}>Orden </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f1e40" }}>
              #{order.id?.slice(0, 8).toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "#6B7280" }}> &mdash; </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#0f1e40" }}>
              {order.client_name}
            </span>
          </div>

          {hasDefaultUser && (
            <div
              style={{
                marginBottom: 16, padding: "10px 14px", borderRadius: 8,
                border: "1px solid #FECACA", background: "#FEF2F2",
                color: "#991B1B", fontSize: 13, fontWeight: 500, lineHeight: 1.4, textAlign: "left",
              }}
            >
              Esta orden fue devuelta. Solo se puede reenviar al {config.label.toLowerCase()} que la regres&oacute;.
            </div>
          )}

          {loadingUsers ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#6B7280", fontSize: 14 }}>
              Cargando {config.label.toLowerCase()}s...
            </div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#EF4444", fontSize: 14 }}>
              No hay {config.label.toLowerCase()}s disponibles
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <select
                value={selectedUserId}
                onChange={(e) => { setSelectedUserId(e.target.value); setError(""); }}
                disabled={loading || (hasDefaultUser && users.length <= 1)}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 8,
                  border: `1.5px solid ${error ? "#EF4444" : "#E5E7EB"}`,
                  fontSize: 14, fontFamily: "'Poppins', sans-serif",
                  background: "#fff", color: "#374151",
                  cursor: "pointer", outline: "none",
                }}
              >
                <option value="">-- Seleccionar {config.label} --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}{u.id === defaultUserId ? " (Original)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && !loadingUsers && (
            <div style={{ color: "#EF4444", fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: "12px 0", color: config.color, fontSize: 14 }}>
              Enviando orden...
            </div>
          )}

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={onClose}
              disabled={loading}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "1.5px solid #E5E7EB",
                background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || !selectedUserId}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: !selectedUserId || loading
                  ? `${config.color}60`
                  : `linear-gradient(135deg, ${config.color} 0%, ${config.iconColor} 100%)`,
                color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                boxShadow: !selectedUserId || loading
                  ? "none"
                  : `0 2px 8px ${config.color}40`,
                opacity: (!selectedUserId || loading) ? 0.6 : 1,
              }}
            >
              {loading ? "Asignando..." : "Asignar Orden"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
