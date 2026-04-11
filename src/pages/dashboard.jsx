import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import "../css-components/page-admin.css";

const Icon = {
  Dashboard: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  Orders: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  Users: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  Search: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  Plus: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  Eye: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  Edit: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>,
  Trash: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>,
  Clock: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  File: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
  Money: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  Menu: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>,
  Close: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
};

const STATUS_OPTIONS = ["Pending", "In_Design", "cotizacion", "en produccion", "terminacion", "en entrega", "completada", "cancelled"];
const PAYMENT_OPTIONS = ["Pending_Payment", "parcial", "pagado"];
const DEFAULT_ORDER_FORM = { client_name: "", client_contact: "", description: "", material: "", order_type: "normal", status: "Pending", payment_status: "Pending_Payment", price: "", seller_id: "", preview_image: "", order_file_url: "" };
const DEFAULT_USER_FORM = { name: "", email: "", password: "", confirmPassword: "", role: "seller", employment_status: true };

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const formatDate = (value) => value ? new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "Sin fecha";
const parseFileUrls = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(value).split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  }
};
const serializeFileUrls = (value) => JSON.stringify(parseFileUrls(value));
// Funciones para obtener información de los perfiles de usuario con lógica de respaldo
// Funcion para obtener el nombre del usuario
const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";
// Funcion para obtener el email del usuario
const getUserEmail = (profile) => profile?.email || "Sin email";
const getUserPassword = (profile) => profile?.password || "Sin contraseña";
// Funcion para obtener el rol del usuario
const getUserRole = (profile) => profile?.role || "Sin rol";
// Normaliza el estado laboral a un booleano real para que la UI y la base hablen el mismo idioma.
const isEmploymentActive = (profile) => {
  const value = profile?.employment_status ?? profile?.employee_status ?? profile?.status;

  if (typeof value === "boolean") return value;

  const normalizedValue = normalizeText(value);
  return ["empleado", "contratado", "activo", "true"].includes(normalizedValue);
};

// Convierte el estado booleano a una etiqueta legible para mostrarla en la interfaz.
const getEmploymentStatus = (profile) => (isEmploymentActive(profile) ? "empleado" : "despedido");
const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Cotizador",
    admin: "Administrador",
    printer: "Producción"
  };
  return map[role] || role;
};

function StatusBadge({ value }) {
  const map = { Pending: ["Pendiente", "warning"], In_Design: ["Diseño", "purple"], cotizacion: ["Cotización", "info"], "en produccion": ["Producción", "orange"], terminacion: ["Terminación", "blue"], "en entrega": ["Entrega", "green"], completada: ["Completada", "green"], cancelled: ["Cancelada", "danger"], admin: ["Administrador", "danger"], seller: ["Vendedor", "info"], designer: ["Diseñador", "purple"], quote: ["Cotizador", "blue"], printer: ["Producción", "orange"] };
  const [label, tone] = map[value] || [value || "Sin estado", "neutral"];
  return <span className={`pa-badge ${tone}`}>{label}</span>;
}

function PaymentBadge({ value }) {
  const map = { Pending_Payment: ["Pago pendiente", "warning"], parcial: ["Parcial", "info"], pagado: ["Pagado", "green"] };
  const [label, tone] = map[value] || [value || "Sin pago", "neutral"];
  return <span className={`pa-badge ${tone}`}>{label}</span>;
}

function ModalShell({ open, title, onClose, children, size = "default" }) {
  if (!open) return null;
  return (
    <div className="pa-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`pa-modal ${size}`}>
        <div className="pa-modal-head">
          <div className="pa-modal-copy"><span className="pa-modal-kicker">Administrador</span><h3>{title}</h3></div>
          <button className="pa-icon-btn pa-modal-close" onClick={onClose} aria-label="Cerrar modal"><Icon.Close /></button>
        </div>
        <div className="pa-modal-body">{children}</div>
      </div>
    </div>
  );
}

function OrderFormModal({ open, mode, orderForm, setOrderForm, users, onClose, onSubmit, saving }) {
  const sellerOptions = users.filter(user => user.role === "seller" || user.role === "admin");
  return (
    <ModalShell open={open} onClose={onClose} title={mode === "create" ? "Crear orden" : "Editar orden"} size="large">
      <div className="pa-form-grid">
        <label className="pa-field"><span>Cliente</span><input value={orderForm.client_name} onChange={(e) => setOrderForm(prev => ({ ...prev, client_name: e.target.value }))} /></label>
        <label className="pa-field"><span>Teléfono</span><input value={orderForm.client_contact} onChange={(e) => setOrderForm(prev => ({ ...prev, client_contact: e.target.value }))} /></label>
        <label className="pa-field full"><span>Descripción</span><textarea rows={3} value={orderForm.description} onChange={(e) => setOrderForm(prev => ({ ...prev, description: e.target.value }))} /></label>
        <label className="pa-field"><span>Material</span><input value={orderForm.material} onChange={(e) => setOrderForm(prev => ({ ...prev, material: e.target.value }))} /></label>
        <label className="pa-field"><span>Tipo de orden</span><select value={orderForm.order_type} onChange={(e) => setOrderForm(prev => ({ ...prev, order_type: e.target.value }))}><option value="normal">Normal</option><option value="orden 911">Orden 911</option></select></label>
        <label className="pa-field"><span>Estado</span><select value={orderForm.status} onChange={(e) => setOrderForm(prev => ({ ...prev, status: e.target.value }))}>{STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
        <label className="pa-field"><span>Pago</span><select value={orderForm.payment_status} onChange={(e) => setOrderForm(prev => ({ ...prev, payment_status: e.target.value }))}>{PAYMENT_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
        <label className="pa-field"><span>Precio</span><input type="number" value={orderForm.price} onChange={(e) => setOrderForm(prev => ({ ...prev, price: e.target.value }))} /></label>
        <label className="pa-field"><span>Responsable / Creador</span><select value={orderForm.seller_id} onChange={(e) => setOrderForm(prev => ({ ...prev, seller_id: e.target.value }))}><option value="">Seleccionar usuario</option>{sellerOptions.map(user => <option key={user.id} value={user.id}>{getUserDisplayName(user)} ({getRoleLabel(user.role)})</option>)}</select></label>
        <label className="pa-field full"><span>Preview / Orden de trabajo</span><input value={orderForm.preview_image} onChange={(e) => setOrderForm(prev => ({ ...prev, preview_image: e.target.value }))} placeholder="https://..." /></label>
        <label className="pa-field full"><span>Archivos de diseño</span><textarea rows={4} value={orderForm.order_file_url} onChange={(e) => setOrderForm(prev => ({ ...prev, order_file_url: e.target.value }))} placeholder="Una URL por línea o separadas por coma" /></label>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving}>{saving ? "Guardando..." : mode === "create" ? "Crear orden" : "Guardar cambios"}</button>
      </div>
    </ModalShell>
  );
}

// Formulario para crea usuarios en el apartado de admin
function UserCreateModal({ open, userForm, setUserForm, onClose, onSubmit, saving }) {
  const isSubmitReady =
    userForm.name.trim() &&
    userForm.email.trim() &&
    userForm.password.trim().length >= 6 &&
    userForm.password === userForm.confirmPassword;

  const roleDescriptions = {
    seller: "Gestiona y da seguimiento comercial a las órdenes.",
    designer: "Recibe y trabaja los archivos asignados para producción.",
    quote: "Cotiza las órdenes y valida la información de pago.",
    admin: "Supervisa módulos, usuarios y el flujo general del sistema.",
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Crear usuario" size="compact">
      <div className="pa-user-modal-intro">
        <div className="pa-user-modal-icon"><Icon.Users /></div>
        <div>
          <h4>Nuevo miembro del sistema</h4>
          <p>Organiza primero la identidad del usuario y luego define su rol y estado inicial dentro del equipo.</p>
        </div>
      </div>
      <div className="pa-user-modal-layout">
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Identidad</span>
            <h5>Información principal</h5>
          </div>
          <div className="pa-form-grid single">
            <label className="pa-field"><span>Nombre</span><input value={userForm.name} onChange={(e) => setUserForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ej. Maria Fernanda" autoComplete="name" /><small className="pa-field-help">Este nombre será visible en el sistema y se guardará también en autenticación.</small></label>
            <label className="pa-field"><span>Email</span><input type="email" value={userForm.email} onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))} placeholder="usuario@empresa.com" autoComplete="email" /><small className="pa-field-help">Usa un correo único para evitar conflictos de acceso.</small></label>
            <label className="pa-field"><span>Contraseña</span><input type="password" value={userForm.password} onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))} placeholder="Mínimo 6 caracteres" /></label>
            <label className="pa-field"><span>Confirmar contraseña</span><input type="password" value={userForm.confirmPassword} onChange={(e) => setUserForm(prev => ({ ...prev, confirmPassword: e.target.value }))} placeholder="Repite la contraseña" /></label>
          </div>
        </section>

        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Acceso</span>
            <h5>Permisos y estado</h5>
          </div>
          <div className="pa-form-grid single">
            <label className="pa-field"><span>Rol</span><select value={userForm.role} onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}><option value="seller">Vendedor</option><option value="designer">Diseñador</option><option value="quote">Cotizador</option><option value="admin">Administrador</option></select></label>
            <div className="pa-static-field">
              <span>Estado laboral</span>
              <div className="pa-static-value">Empleado por defecto</div>
              <small className="pa-field-help">Acceso actual: {roleDescriptions[userForm.role]}</small>
            </div>
          </div>
          <div className="pa-user-modal-pills">
            <span className="pa-user-pill neutral">El rol define el acceso dentro del sistema.</span>
            <span className="pa-user-pill info">Se guardará como empleado activo (`employment_status = true`).</span>
          </div>
        </section>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving || !isSubmitReady}>{saving ? "Creando..." : "Crear usuario"}</button>
      </div>
    </ModalShell>
  );
}

// Detalles de la orden
function OrderDetailModal({ open, order, usersById, onClose, onEdit, onCancel }) {
  if (!open || !order) return null;
  const files = parseFileUrls(order.order_file_url);
  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      <div className="pa-detail-grid">
        <div className="pa-panel">
          <div className="pa-panel-title">Resumen</div>
          <div className="pa-detail-list">
            <div><span>Cliente</span><strong>{order.client_name || "No definido"}</strong></div>
            <div><span>Contacto</span><strong>{order.client_contact || "No definido"}</strong></div>
            <div><span>Responsable</span><strong>{getUserDisplayName(usersById[order.seller_id || order.created_by])}</strong></div>
            <div><span>Tipo</span><strong>{order.order_type || "No definido"}</strong></div>
            <div><span>Material</span><strong>{order.material || "No definido"}</strong></div>
            <div><span>Fecha</span><strong>{formatDate(order.created_at)}</strong></div>
          </div>
          <div className="pa-detail-description">{order.description || "Sin descripción"}</div>
        </div>
        <div className="pa-panel">
          <div className="pa-panel-title">Diseños y cotización</div>
          <div className="pa-detail-list">
            <div><span>Estado</span><strong><StatusBadge value={order.status} /></strong></div>
            <div><span>Pago</span><strong><PaymentBadge value={order.payment_status} /></strong></div>
            <div><span>Precio</span><strong>{order.price ? `RD$${Number(order.price).toLocaleString("es-DO")}` : "Sin cotizar"}</strong></div>
            <div><span>Preview</span><strong>{order.preview_image ? <a href={order.preview_image} target="_blank" rel="noreferrer">Ver preview</a> : "Sin preview"}</strong></div>
          </div>
          {files.length > 0 ? <div className="pa-file-list">{files.map((file, index) => <a key={`${file}-${index}`} href={file} target="_blank" rel="noreferrer" className="pa-file-link"><Icon.File /> Diseño {index + 1}</a>)}</div> : <div className="pa-empty-small">No hay diseños cargados.</div>}
        </div>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cerrar</button>
        <button className="pa-btn ghost" onClick={() => onEdit(order)}>Editar</button>
        {order.status !== "cancelled" && <button className="pa-btn danger" onClick={() => onCancel(order)}>Cancelar orden</button>}
      </div>
    </ModalShell>
  );
}

// Modal reutilizable para confirmar la activación o desactivación de empleados.
function EmploymentStatusConfirmModal({ open, pendingChange, onClose, onConfirm, saving }) {
  if (!open || !pendingChange) return null;

  const willActivate = pendingChange.nextStatus === true;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={willActivate ? "Activar usuario" : "Desactivar usuario"}
      size="compact"
    >
      <div className="pa-confirm-modal-body">
        <div className={`pa-confirm-icon ${willActivate ? "activate" : "deactivate"}`}>
          {willActivate ? <Icon.Users /> : <Icon.Close />}
        </div>

        <div className="pa-confirm-copy">
          <h4>{pendingChange.userName}</h4>
          <p>
            {willActivate
              ? "Si confirmas esta acción, el usuario volverá a estar activo y podrá iniciar sesión."
              : "Si continúas, el usuario quedará inactivo y no podrá iniciar sesión hasta ser activado nuevamente."}
          </p>
        </div>
      </div>

      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button
          className={`pa-btn ${willActivate ? "primary" : "danger"}`}
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? "Guardando..." : willActivate ? "Activar usuario" : "Desactivar usuario"}
        </button>
      </div>
    </ModalShell>
  );
}

// Detalles del usuario
function UserDetailModal({ open, user, onClose, onRequestEmploymentToggle, onShowFeedback }) {
  if (!open || !user) return null;
  const employmentStatus = getEmploymentStatus(user);
  const isActive = isEmploymentActive(user);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Estados de validación
  const [errors, setErrors] = useState({ newPassword: "", confirmPassword: "" });

  useEffect(() => {
    const fetchUserEmail = async () => {
      setUserEmail("");
      try {
        const response = await fetch("/api/get-user-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        const data = await response.json();
        if (data.email) {
          setUserEmail(data.email);
        }
      } catch (err) {
        console.error("Error fetching email:", err);
      }
    };
    if (user.id) {
      fetchUserEmail();
    }
  }, [user.id]);

  const handleChangePassword = async () => {
    // Validar campos
    const newErrors = { newPassword: "", confirmPassword: "" };
    let hasErrors = false;

    if (!newPassword.trim()) {
      newErrors.newPassword = "La contraseña es obligatoria";
      hasErrors = true;
    } else if (newPassword.length < 6) {
      newErrors.newPassword = "Mínimo 6 caracteres";
      hasErrors = true;
    }

    if (!confirmPassword.trim()) {
      newErrors.confirmPassword = "Confirma la contraseña";
      hasErrors = true;
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = "Las contraseñas no coinciden";
      hasErrors = true;
    }

    if (hasErrors) {
      setErrors(newErrors);
      return;
    }

    // Limpiar errores si todo está bien
    setErrors({ newPassword: "", confirmPassword: "" });

    setChangingPassword(true);

    try {
      const response = await fetch("/api/change-user-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, newPassword }),
      });

      const result = await response.json();

      if (!response.ok) {
        onShowFeedback?.("error", `Error al cambiar la contraseña: ${result.error}`);
        setChangingPassword(false);
        return;
      }

      setShowSuccessModal(true);
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
      setErrors({ newPassword: "", confirmPassword: "" });

      setTimeout(() => {
        setShowSuccessModal(false);
      }, 2000);

    } catch (err) {
      onShowFeedback?.("error", "Error al conectar con el servidor");
    }

    setChangingPassword(false);
  };

  return (
    <>
      <ModalShell open={open} onClose={onClose} title={`${getUserDisplayName(user)}`} size="compact">
        <div className="pa-user-detail-container">
          <div className="pa-user-detail-avatar-section">
            <div className="pa-user-avatar">
              <span>{getUserDisplayName(user).charAt(0).toUpperCase()}</span>
            </div>
            <div className="pa-user-detail-badge">
              <StatusBadge value={user.role} />
            </div>
          </div>

          <div className="pa-user-detail-grid">
            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Información Personal</span>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Nombre</span>
                <strong className="pa-detail-item-value">{getUserDisplayName(user)}</strong>
              </div>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Correo</span>
                <strong className="pa-detail-item-value pa-email-value">{userEmail || "Cargando..."}</strong>
              </div>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Rol</span>
                <strong className="pa-detail-item-value">{getRoleLabel(user.role) || "Sin rol"}</strong>
              </div>
            </section>

            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Seguridad</span>
              {!showPasswordForm ? (
                <button
                  className="pa-btn primary pa-btn-sm"
                  onClick={() => setShowPasswordForm(true)}
                  style={{ width: "100%" }}
                >
                  Cambiar contraseña
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="pa-field" style={{ marginBottom: "0" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>Nueva contraseña</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setErrors(prev => ({ ...prev, newPassword: "" })); }}
                      placeholder="Mínimo 6 caracteres"
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        border: errors.newPassword ? "1px solid #ef4444" : "1px solid #dbe3ef",
                        borderRadius: "8px",
                        width: "100%",
                        boxSizing: "border-box",
                        background: errors.newPassword ? "#fef2f2" : "#ffffff"
                      }}
                    />
                    {errors.newPassword && (
                      <span style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px", display: "block" }}>
                        {errors.newPassword}
                      </span>
                    )}
                  </div>
                  <div className="pa-field" style={{ marginBottom: "0" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>Confirmar contraseña</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: "" })); }}
                      placeholder="Repite la contraseña"
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        border: errors.confirmPassword ? "1px solid #ef4444" : "1px solid #dbe3ef",
                        borderRadius: "8px",
                        width: "100%",
                        boxSizing: "border-box",
                        background: errors.confirmPassword ? "#fef2f2" : "#ffffff"
                      }}
                    />
                    {errors.confirmPassword && (
                      <span style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px", display: "block" }}>
                        {errors.confirmPassword}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="pa-btn secondary pa-btn-sm"
                      onClick={() => {
                        setShowPasswordForm(false);
                        setNewPassword("");
                        setConfirmPassword("");
                      }}
                      disabled={changingPassword}
                      style={{ flex: 1 }}
                    >
                      Cancelar
                    </button>
                    <button
                      className="pa-btn primary pa-btn-sm cursor-pointer"
                      onClick={handleChangePassword}
                      disabled={changingPassword}
                      style={{ flex: 1 }}
                    >
                      {changingPassword ? "Actualizando..." : "Actualizar"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="pa-detail-section">
              <span className="pa-detail-section-label">Estado</span>
              <div className="pa-detail-item">
                <span className="pa-detail-item-label">Estado Laboral</span>
                <div className="pa-status-badge-container">
                  <span className={`pa-status-pill ${isActive ? "active" : "inactive"}`}>
                    {employmentStatus === "empleado" ? "✓ Activo" : "✗ Inactivo"}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={onClose}>Cerrar</button>
            <button 
              className={`pa-btn ${isActive ? "danger" : "primary"}`} 
              onClick={() => onRequestEmploymentToggle(user)}
            >
              {isActive ? "Desactivar usuario" : "Activar usuario"}
            </button>
          </div>
        </div>
      </ModalShell>

      {showSuccessModal && (
        <div className="pa-success-modal-overlay">
          <div className="pa-success-modal">
            <div className="pa-success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3>Contraseña cambiada correctamente</h3>
            <p>La contraseña del usuario ha sido actualizada exitosamente.</p>
          </div>
        </div>
      )}
    </>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMode, setOrderModalMode] = useState("create");
  const [orderForm, setOrderForm] = useState(DEFAULT_ORDER_FORM);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userForm, setUserForm] = useState(DEFAULT_USER_FORM);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetailModalOpen, setUserDetailModalOpen] = useState(false);
  // Guarda la intención de cambio hasta que el admin confirme la acción en el modal.
  const [employmentStatusConfirmOpen, setEmploymentStatusConfirmOpen] = useState(false);
  const [pendingEmploymentStatusChange, setPendingEmploymentStatusChange] = useState(null);
  const [savingEmploymentStatus, setSavingEmploymentStatus] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const usersById = useMemo(() => Object.fromEntries(profiles.map(item => [item.id, item])), [profiles]);
  const showFeedback = (type, message) => setFeedback({ type, message, id: Date.now() });

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const loadSession = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return navigate("/");
    const { data: currentProfile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
    if (!currentProfile || currentProfile.role !== "admin") {
      await supabase.auth.signOut();
      navigate("/");
      return;
    }
    setUser(data.user);
    setProfile(currentProfile);
  };

  const loadOrders = async () => {
    setLoadingOrders(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    setOrders(!error && Array.isArray(data) ? data : []);
    setLoadingOrders(false);
  };

  const loadProfiles = async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
    setProfiles(!error && Array.isArray(data) ? data : []);
    setLoadingUsers(false);
  };

  useEffect(() => {
    loadSession();
    loadOrders();
    loadProfiles();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Funcionalidad para  resetea el formulario de ordenes
  const resetOrderForm = (order = null) => {
    if (!order) return setOrderForm(DEFAULT_ORDER_FORM);
    setOrderForm({
      client_name: order.client_name || "",
      client_contact: order.client_contact || "",
      description: order.description || "",
      material: order.material || "",
      order_type: order.order_type || "normal",
      status: order.status || "Pending",
      payment_status: order.payment_status || "Pending_Payment",
      price: order.price || "",
      seller_id: order.seller_id || order.created_by || "",
      preview_image: order.preview_image || "",
      order_file_url: parseFileUrls(order.order_file_url).join("\n"),
    });
  };

  const openCreateOrder = () => {
    setOrderModalMode("create");
    resetOrderForm();
    setOrderModalOpen(true);
  };

  const openEditOrder = (order) => {
    setSelectedOrder(order);
    setOrderModalMode("edit");
    resetOrderForm(order);
    setOrderModalOpen(true);
  };

  const handleSaveOrder = async () => {
    if (!orderForm.client_name.trim() || !orderForm.description.trim()) return showFeedback("error", "Cliente y descripción son obligatorios.");

    const payload = {
      client_name: orderForm.client_name.trim(),
      client_contact: orderForm.client_contact.trim() || null,
      description: orderForm.description.trim(),
      material: orderForm.material.trim() || null,
      order_type: orderForm.order_type,
      status: orderForm.status,
      payment_status: orderForm.payment_status,
      price: orderForm.price ? Number(orderForm.price) : null,
      seller_id: orderForm.seller_id || null,
      created_by: orderForm.seller_id || user?.id || null,
      preview_image: orderForm.preview_image.trim() || null,
      order_file_url: serializeFileUrls(orderForm.order_file_url),
    };

    setSavingOrder(true);
    const query = orderModalMode === "create" ? supabase.from("orders").insert([payload]) : supabase.from("orders").update(payload).eq("id", selectedOrder.id);
    const { error } = await query;
    setSavingOrder(false);
    if (error) return showFeedback("error", `No se pudo guardar la orden: ${error.message}`);
    setOrderModalOpen(false);
    setSelectedOrder(null);
    await loadOrders();
    showFeedback("success", orderModalMode === "create" ? "Orden creada correctamente." : "Orden actualizada correctamente.");
  };

  const handleCancelOrder = async (order) => {
    if (!window.confirm(`¿Cancelar la orden de ${order.client_name || "este cliente"}?`)) return;
    const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    if (error) return showFeedback("error", "No se pudo cancelar la orden.");
    if (selectedOrder?.id === order.id) setSelectedOrder(null);
    await loadOrders();
    showFeedback("success", "La orden fue cancelada correctamente.");
  };

  // Funcionalidad para registrar usuarios
  const handleCreateUser = async () => {
    const trimmedName = userForm.name.trim();
    const trimmedEmail = userForm.email.trim().toLowerCase();
    const trimmedPassword = userForm.password.trim();
    const trimmedConfirmPassword = userForm.confirmPassword.trim();

    if (!trimmedName || !trimmedEmail || !userForm.role) {
      return showFeedback("error", "Nombre, email y rol son obligatorios.");
    }

    if (!trimmedPassword || trimmedPassword.length < 6) {
      return showFeedback("error", "La contraseña debe tener al menos 6 caracteres.");
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      return showFeedback("error", "Las contraseñas no coinciden.");
    }

    setSavingUser(true);
    let response;
    let result;
    try {
      response = await fetch("/api/admin-create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password: trimmedPassword,
          role: userForm.role,
        }),
      });

      result = await response.json();
    } catch (error) {
      setSavingUser(false);
      return showFeedback("error", "No se pudo conectar con el servicio de creación de usuarios.");
    }

    setSavingUser(false);

    if (!response.ok) {
      return showFeedback("error", result?.error || "No se pudo crear el usuario.");
    }

    setUserModalOpen(false);
    setUserForm(DEFAULT_USER_FORM);
    await loadProfiles();
    showFeedback("success", result?.message || "Usuario creado correctamente en autenticación y profiles.");

  };

  // Prepara el cambio de estado, pero no actualiza la base hasta que el admin confirme.
  const openEmploymentStatusConfirm = (profile) => {
    setPendingEmploymentStatusChange({
      userId: profile.id,
      userName: getUserDisplayName(profile),
      nextStatus: !isEmploymentActive(profile),
    });
    setEmploymentStatusConfirmOpen(true);
  };

  // Cierra el modal y limpia el estado temporal para evitar cambios accidentales.
  const closeEmploymentStatusConfirm = () => {
    setEmploymentStatusConfirmOpen(false);
    setPendingEmploymentStatusChange(null);
  };

  // Aplica el cambio real en la base usando el campo booleano employment_status.
  const handleEmploymentStatusChange = async (profileId, nextStatus) => {
    setSavingEmploymentStatus(true);

    const { error } = await supabase
      .from("profiles")
      .update({ employment_status: nextStatus })
      .eq("id", profileId);

    setSavingEmploymentStatus(false);

    if (error) {
      return showFeedback("error", "No se pudo actualizar el estado del usuario.");
    }

    await loadProfiles();
    showFeedback(
      "success",
      nextStatus ? "Usuario activado correctamente." : "Usuario desactivado correctamente."
    );
  };

  // Si el admin confirma, recién aquí se persiste el cambio.
  const confirmEmploymentStatusChange = async () => {
    if (!pendingEmploymentStatusChange) return;

    await handleEmploymentStatusChange(
      pendingEmploymentStatusChange.userId,
      pendingEmploymentStatusChange.nextStatus
    );

    closeEmploymentStatusConfirm();
  };

  // Funcionalidad de filtros 
  const filteredOrders = useMemo(() => {
    const q = normalizeText(search);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    return orders.filter(order => {
      const ownerId = order.seller_id || order.created_by || "";
      const matchesSearch = !q || [order.client_name, order.description, order.material, order.id, getUserDisplayName(usersById[ownerId])].some(value => normalizeText(value).includes(q));
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesOwner = ownerFilter === "all" || ownerId === ownerFilter;
      const createdAt = new Date(order.created_at);
      const matchesDate = dateFilter === "all" || (dateFilter === "today" && createdAt >= startOfToday) || (dateFilter === "week" && createdAt >= startOfWeek);
      return matchesSearch && matchesStatus && matchesOwner && matchesDate;
    });
  }, [orders, search, statusFilter, ownerFilter, dateFilter, usersById]);

  const filteredProfiles = useMemo(() => {
    const q = normalizeText(userSearch);
    return profiles.filter(item => {
      const matchesSearch = !q || [getUserDisplayName(item), item.email, item.role, getEmploymentStatus(item)].some(value => normalizeText(value).includes(q));
      const matchesRole = roleFilter === "all" || item.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [profiles, userSearch, roleFilter]);

  const metrics = [
    { label: "Órdenes totales", value: orders.length, icon: <Icon.Orders /> },
    { label: "Cotización", value: orders.filter(order => order.status === "cotizacion").length, icon: <Icon.Money /> },
    { label: "En diseño", value: orders.filter(order => order.status === "In_Design").length, icon: <Icon.File /> },
    { label: "Usuarios", value: profiles.length, icon: <Icon.Users /> },
  ];

  const typeMetrics = [
    { label: "Órdenes normales", value: orders.filter(order => order.order_type !== "orden 911").length },
    { label: "Órdenes 911", value: orders.filter(order => order.order_type === "orden 911").length },
    { label: "Canceladas", value: orders.filter(order => order.status === "cancelled").length },
    { label: "Completadas", value: orders.filter(order => order.status === "completada").length },
  ];

  const menuItems = [
    { id: "overview", label: "Resumen", icon: <Icon.Dashboard /> },
    { id: "orders", label: "Órdenes", icon: <Icon.Orders />, badge: orders.length },
    { id: "users", label: "Usuarios", icon: <Icon.Users />, badge: profiles.length },
  ];

  return (
    // Apartado principal totalmente flexible
    <div className="pa-root">
      <Sidebar isOpen={sidebarOpen} activeTab={activeTab} onTabChange={setActiveTab} role="Admin" userName={getUserDisplayName(profile)} menuItems={menuItems} onLogout={handleLogout} onCreateNew={openCreateOrder} showCreateButton />
      <main className="pa-main">
        <header className="pa-header">
          <div className="pa-header-left">
            <button className="pa-mobile-toggle" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Abrir menú"><Icon.Menu /></button>
            <div><span className="pa-kicker">Administrador</span><h1>{activeTab === "overview" ? "Panel General" : activeTab === "orders" ? "Gestión de órdenes" : "Gestión de usuarios"}</h1></div>
          </div>
          {feedback && <div className={`pa-feedback ${feedback.type}`}>{feedback.message}</div>}
        </header>

        {activeTab === "overview" && <section className="pa-section"><div className="pa-metrics-grid">{metrics.map(metric => <article key={metric.label} className="pa-metric-card"><div className="pa-metric-icon">{metric.icon}</div><div><span>{metric.label}</span><strong>{metric.value}</strong></div></article>)}</div><div className="pa-two-col"><div className="pa-panel"><div className="pa-panel-head"><div><span className="pa-section-kicker">Monitoreo</span><h2>Estado del sistema</h2></div></div><div className="pa-stats-list">{typeMetrics.map(item => <div key={item.label} className="pa-stat-row"><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></div><div className="pa-panel"><div className="pa-panel-head"><div><span className="pa-section-kicker">Actividad reciente</span><h2>Órdenes más recientes</h2></div></div><div className="pa-recent-list">{orders.slice(0, 5).map(order => <button key={order.id} className="pa-recent-item" onClick={() => setSelectedOrder(order)}><div><strong>{order.client_name || "Cliente sin nombre"}</strong><span>{getUserDisplayName(usersById[order.seller_id || order.created_by])}</span></div><div className="pa-recent-meta"><StatusBadge value={order.status} /><span>{formatDate(order.created_at)}</span></div></button>)}</div></div></div></section>}

        {activeTab === "orders" && <section className="pa-section"><div className="pa-toolbar"><div className="pa-search-box"><Icon.Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente, descripción, material o usuario..." /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option>{STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}</select><select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}><option value="all">Todas las fechas</option><option value="today">Hoy</option><option value="week">Últimos 7 días</option></select><select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}><option value="all">Todos los usuarios</option>{profiles.map(item => <option key={item.id} value={item.id}>{getUserDisplayName(item)}</option>)}</select><button className="pa-btn primary" onClick={openCreateOrder}><Icon.Plus /> Nueva orden</button></div><div className="pa-panel"><div className="pa-panel-head"><div><span className="pa-section-kicker">Supervisión</span><h2>Órdenes del sistema</h2></div><span className="pa-results-count">{filteredOrders.length} resultados</span></div><div className="pa-table-wrap"><table className="pa-table"><thead><tr><th>Cliente</th><th>Responsable</th><th>Estado</th><th>Pago</th><th>Tipo</th><th>Fecha</th><th /></tr></thead><tbody>{loadingOrders ? <tr><td colSpan={7} className="pa-empty-row">Cargando órdenes...</td></tr> : filteredOrders.length === 0 ? <tr><td colSpan={7} className="pa-empty-row">No hay órdenes para mostrar.</td></tr> : filteredOrders.map(order => <tr key={order.id}><td><strong>{order.client_name || "Sin cliente"}</strong><span>{order.description || "Sin descripción"}</span></td><td>{getUserDisplayName(usersById[order.seller_id || order.created_by])}</td><td><StatusBadge value={order.status} /></td><td><PaymentBadge value={order.payment_status} /></td><td>{order.order_type || "Normal"}</td><td>{formatDate(order.created_at)}</td><td><div className="pa-row-actions"><button className="pa-icon-btn" onClick={() => setSelectedOrder(order)}><Icon.Eye /></button><button className="pa-icon-btn" onClick={() => openEditOrder(order)}><Icon.Edit /></button>{order.status !== "cancelled" && <button className="pa-icon-btn danger" onClick={() => handleCancelOrder(order)}><Icon.Trash /></button>}</div></td></tr>)}</tbody></table></div></div></section>}

        {activeTab === "users" &&
          <section className="pa-section">
            <div className="pa-toolbar">
              <div className="pa-search-box"><Icon.Search />
                <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Buscar por nombre, correo o rol..." />
              </div>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">Todos los roles</option>
                <option value="admin">Administrador</option>
                <option value="seller">Vendedor</option>
                <option value="designer">Diseñador</option>
                <option value="quote">Cotizador</option>
                <option value="printer">Producción</option>
              </select>
              <button className="pa-btn primary" onClick={() => setUserModalOpen(true)}><Icon.Plus />
                Crear usuario
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-head">
                <div>
                  <span className="pa-section-kicker">Supervisión</span>
                  <h2>Usuarios del sistema</h2>
                </div>
                <span className="pa-results-count">{filteredProfiles.length} usuarios</span>
              </div>
              <div className="pa-users-grid">
                {loadingUsers ?
                  <div className="pa-empty-card">
                    Cargando usuarios...
                  </div>
                  : filteredProfiles.length === 0 ?
                    <div className="pa-empty-card">
                      No hay usuarios para mostrar.
                    </div>
                    : filteredProfiles.map(item => {
                      const isActive = isEmploymentActive(item);

                      return <article key={item.id} className="pa-user-card" onClick={() => { setSelectedUser(item); setUserDetailModalOpen(true); }}>
                      <div className="pa-user-card-content">
                        <div className="pa-user-card-header">
                          <div className="pa-user-info">
                            <strong className="pa-user-name">
                              {getUserDisplayName(item)}
                            </strong>
                            <span className="pa-user-email">
                              {item.email || "Sin correo"}
                            </span>
                          </div>
                          <div className="pa-user-role-badge">
                            <StatusBadge value={item.role} />
                          </div>
                        </div>
                        <div className="pa-user-card-divider"></div>
                        <div className="pa-user-card-body">
                          <div className="pa-user-meta-item">
                            <span className="pa-meta-label">
                              Rol
                            </span>
                            <span className="pa-meta-value">
                              {getRoleLabel(item.role) || "sin rol"}
                            </span>
                          </div>
                          <div className="pa-user-meta-item">
                            <span className="pa-meta-label">
                              Estado
                            </span>
                            <span className={`pa-meta-badge ${isActive ? "active" : "inactive"}`}>
                              {getEmploymentStatus(item)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="pa-user-card-actions">
                        <button className="pa-btn secondary pa-btn-sm detail" onClick={(event) => {
                          // Evita que el click del botón dispare también el click general de la tarjeta.
                          event.stopPropagation();
                          setSelectedUser(item);
                          setUserDetailModalOpen(true);
                        }}>
                          Ver detalles
                        </button>
                        <button className={`pa-btn pa-btn-sm ${isActive ? "deactivate" : "primary"}`} onClick={(event) => {
                          // La activación y desactivación siempre pasa primero por un modal de confirmación.
                          event.stopPropagation();
                          openEmploymentStatusConfirm(item);
                        }}>
                          {isActive ? "Desactivar usuario" : "Activar usuario"}
                        </button>
                      </div>
                    </article>;
                  })}
                  </div>
              </div>
          </section>
        }
      </main>

      <OrderFormModal open={orderModalOpen} mode={orderModalMode} orderForm={orderForm} setOrderForm={setOrderForm} users={profiles} onClose={() => { setOrderModalOpen(false); setSelectedOrder(null); }} onSubmit={handleSaveOrder} saving={savingOrder} />
      <OrderDetailModal open={!!selectedOrder} order={selectedOrder} usersById={usersById} onClose={() => setSelectedOrder(null)} onEdit={openEditOrder} onCancel={handleCancelOrder} />
      <UserCreateModal open={userModalOpen} userForm={userForm} setUserForm={setUserForm} onClose={() => setUserModalOpen(false)} onSubmit={handleCreateUser} saving={savingUser} />
      <UserDetailModal open={userDetailModalOpen} user={selectedUser} onClose={() => setUserDetailModalOpen(false)} onRequestEmploymentToggle={openEmploymentStatusConfirm} onShowFeedback={showFeedback} />
      <EmploymentStatusConfirmModal open={employmentStatusConfirmOpen} pendingChange={pendingEmploymentStatusChange} onClose={closeEmploymentStatusConfirm} onConfirm={confirmEmploymentStatusChange} saving={savingEmploymentStatus} />
    </div>
  );
}
