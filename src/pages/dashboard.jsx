import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import { validateImage } from "../utils/imageValidation";
import { uploadOrderAsset, buildPaymentReceiptPath } from "../utils/uploadOrderAsset";
import "../css-components/page-admin.css";
import "../css-components/page-seller.css";

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
  Calendar: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  Phone: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>,
  Package: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>,
  Paintbrush: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>,
  Check: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>,
  Receipt: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 2 2 2-2 2 2 2-2 3 2V4a2 2 0 0 0-2-2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /></svg>,
  FileText: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
  Brush: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 0 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1 1 6.23 1 7 0 .48-.93.49-2.01 0-3.04a3.03 3.03 0 0 0-2-2z" /></svg>,
  Download: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  Archive: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>,
};

const STATUS_OPTIONS = ["Pending", "In_Design", "cotizacion", "en produccion", "terminacion", "en entrega", "completada", "cancelled"];
const PAYMENT_OPTIONS = ["Pending_Payment", "parcial", "pagado"];
const STATUS_LABELS = { Pending: "Pendiente", In_Design: "En diseño", cotizacion: "Cotización", "en produccion": "En producción", terminacion: "Terminación", "en entrega": "En entrega", completada: "Completada", cancelled: "Cancelada" };
const PAYMENT_LABELS = { Pending_Payment: "Pendiente", parcial: "Parcial", pagado: "Pagado" };
const MATERIAL_OPTIONS = ["Vinilo", "Banner", "Lona", "Papel Fotografico", "Carton", "Adhesivo", "PVC", "Acrilico", "Tela", "Foam", "Otro"];
const QUOTE_ASSIGNMENT_FIELDS = ["quote_id", "quotation_id", "quote_user_id"];

// FlowTracker steps
const FLOW_STEPS = [
  { key: "Pending", label: "Pendiente" },
  { key: "In_Design", label: "Diseño" },
  { key: "cotizacion", label: "Cotización" },
  { key: "en produccion", label: "Producción" },
  { key: "terminacion", label: "Terminación" },
  { key: "en entrega", label: "Entrega" },
];

const FLOW_STEPS_EXTERNAL = [
  { key: "Pending", label: "Pendiente" },
  { key: "cotizacion", label: "Cotización" },
  { key: "en produccion", label: "Producción" },
  { key: "terminacion", label: "Terminación" },
  { key: "en entrega", label: "Entrega" },
];
const DEFAULT_ORDER_FORM = {
  id: "",
  client_name: "",
  client_contact: "",
  description: "",
  material: "",
  order_type: "normal",
  design_type: "INTERNAL_DESING",
  termination_type: "",
  delivery_date: "",
  status: "Pending",
  payment_status: "Pending_Payment",
  seller_id: "",
  existingFiles: [],
  newFiles: [],
  removedFiles: [],
  existingPreview: null,
  newPreview: null,
  removePreview: false,
  indefinido: false,
};
const DEFAULT_USER_FORM = { name: "", email: "", password: "", confirmPassword: "", role: "seller", employment_status: true };

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const formatDate = (value) => value ? new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "Sin fecha";
const resolveSellerId = (order) => order?.seller_id || order?.created_by || null;
const resolveQuoteAssignmentId = (order) => QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).find(Boolean) || null;
const isAdminArchivable = (order) => ["cancelada", "cancelled", "completada"].includes(normalizeText(order?.status));
const resolveAssignmentIdsByRole = (order, role) => {
  const normalizedRole = normalizeText(role);

  if (["seller", "admin"].includes(normalizedRole)) {
    return [resolveSellerId(order)].filter(Boolean);
  }

  if (normalizedRole === "designer") {
    return [order?.designer_id].filter(Boolean);
  }

  if (normalizedRole === "quote") {
    return QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).filter(Boolean);
  }

  const fallbackFields = [`${normalizedRole}_id`, `${normalizedRole}_user_id`, `assigned_${normalizedRole}_id`];
  return fallbackFields.map((field) => order?.[field]).filter(Boolean);
};
const orderMatchesProfileFilter = (order, profile) => {
  if (!profile?.id) return false;
  return resolveAssignmentIdsByRole(order, profile.role).includes(profile.id);
};
const getOrderSearchUserIds = (order) => [
  resolveSellerId(order),
  order?.designer_id,
  ...QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]),
  order?.printer_id,
].filter(Boolean);
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
const getFileNameFromUrl = (value) => {
  if (!value) return "Archivo";
  try {
    return decodeURIComponent(String(value).split("/").pop().split("?")[0]);
  } catch {
    return String(value).split("/").pop() || "Archivo";
  }
};

// Genera nombres únicos y legibles para los archivos que sube el administrador.
const buildStorageFileName = (file, prefix = "") => {
  const safeName = String(file?.name || "archivo")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

  return `${prefix}${Date.now()}-${safeName}`;
};

// Función uploadOrderAsset importada desde ../utils/uploadOrderAsset.js
// Para usar: uploadOrderAsset({ bucket, path, file })

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
  const map = { Pending_Payment: ["Pendiente", "warning"], parcial: ["Parcial", "info"], pagado: ["Pagado", "green"] };
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
        <label className="pa-field"><span>Material</span><select value={orderForm.material} onChange={(e) => setOrderForm(prev => ({ ...prev, material: e.target.value }))}><option value="">Seleccionar material</option>{MATERIAL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="pa-field"><span>Tipo de orden</span><select value={orderForm.order_type} onChange={(e) => setOrderForm(prev => ({ ...prev, order_type: e.target.value }))}><option value="normal">Normal</option><option value="orden 911">Orden 911</option></select></label>
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

// FlowTracker (copiado de pages-seller.jsx)
function FlowTracker({ status }) {
  const idx = FLOW_STEPS.findIndex(s => s.key === status);

  return (
    <div className="ps-flow">
      {FLOW_STEPS.map((step, i) => {
        const isCompleted = idx >= 0 && i < idx;
        const isActive = i === idx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={`ps-flow-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>{step.label}</span>
            </div>
            {i < FLOW_STEPS.length - 1 && <div className={`ps-flow-line ${isCompleted ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

// FlowTracker para órdenes de Diseño Externo
function FlowTrackerExternal({ status }) {
  const statusToIndex = {
    "Pending": 0,
    "in_Quotation": 1,
    "cotizacion": 1,
    "en produccion": 2,
    "terminacion": 3,
    "en entrega": 4,
    "completada": 4,
    "cancelada": -1,
    "cancelled": -1,
  };
  const idx = statusToIndex[status] ?? -1;

  return (
    <div className="ps-flow">
      {FLOW_STEPS_EXTERNAL.map((step, i) => {
        const isCompleted = idx >= 0 && i < idx;
        const isActive = i === idx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS_EXTERNAL.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={`ps-flow-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>{step.label}</span>
            </div>
            {i < FLOW_STEPS_EXTERNAL.length - 1 && <div className={`ps-flow-line ${isCompleted ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

// Modal de detalles de orden para admin
function AdminOrderDetailModal({ open, order, usersById, onClose, onEdit, onCancel, onAssign, onArchive }) {
  if (!open || !order) return null;

  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const sellerId = resolveSellerId(order);
  const userName = getUserDisplayName(usersById[sellerId]);
  const designerName = order?.designer_id ? getUserDisplayName(usersById[order.designer_id]) : "";
  const quoteAssignedId = resolveQuoteAssignmentId(order);
  const quoteUserName = quoteAssignedId ? getUserDisplayName(usersById[quoteAssignedId]) : "";
  const rawFiles = parseFileUrls(order.order_file_url);
  const existingFiles = rawFiles.map(f => typeof f === "string" ? { url: f, name: getFileNameFromUrl(f) } : { url: f.url || f, name: f.name || getFileNameFromUrl(f.url || f) });
  const preview = order.preview_image;
  const paymentInvoice = order.invoice_payment;

  return (
    <ModalShell open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} size="large">
      {order.order_design_type === "EXTERNAL_DESING" ? (
        <FlowTrackerExternal status={order.status} />
      ) : (
        <FlowTracker status={order.status} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 22 }}>
        <div>
          <div style={{
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18,
            position: "relative",
            overflow: "hidden"
          }}>
            <div style={{
              position: "absolute",
              top: 0, right: 0,
              width: 100, height: 100,
              background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, transparent 100%)",
              borderRadius: "0 0 0 100px",
              pointerEvents: "none"
            }} />

            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 50, height: 50,
                borderRadius: "var(--radius-md)",
                background: "linear-gradient(135deg, #06B6D4, #0f1e40)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 22, fontWeight: 700,
                flexShrink: 0
              }}>
                {order.client_name?.charAt(0)?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0, marginBottom: 5 }}>
                  {order.client_name}
                </p>
                {order.client_contact && (
                  <p style={{ fontSize: 12, color: "var(--text-sub)", margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon.Phone />{order.client_contact}
                  </p>
                )}
              </div>
            </div>

            <div style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6, margin: 0 }}>
                {order.description}
              </p>
            </div>
          </div>

          <div style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 14, margin: "0 0 14px 0"
            }}>Especificaciones</p>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Material:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.material}</span>
              </div>
              {order.termination_type && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Terminación:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.termination_type}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Tipo de orden:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{order.order_design_type === "EXTERNAL_DESING" ? "Diseño Externo" : "Diseño Interno"}</span>
              </div>
            </div>
          </div>

          {(preview || existingFiles.length > 0) && (
            <>
              {preview && (
                <div style={{
                  background: "var(--surface)",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: 20,
                  marginBottom: 18
                }}>
                  <p style={{
                    fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.07em",
                    marginBottom: 14, margin: "0 0 14px 0"
                  }}>Vista previa</p>
                  <img
                    src={preview}
                    alt="Preview"
                    style={{
                      width: "100%",
                      maxHeight: 200,
                      objectFit: "contain",
                      borderRadius: "var(--radius-md)",
                      background: "var(--surface-alt)"
                    }}
                  />
                </div>
              )}
              {existingFiles.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.Brush /> Diseño del cliente
                  </p>
                  {(() => {
                    if (existingFiles.length === 1) {
                      const url = existingFiles[0].url;
                      const fileName = existingFiles[0].name || "archivo";
                      const downloadUrl = url.includes("?") ? `${url}&download=${fileName}` : `${url}?download=${fileName}`;
                      return url.toLowerCase().endsWith(".pdf") ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex", flexDirection: "column",
                              alignItems: "center", justifyContent: "center",
                              gap: 10, padding: "24px 16px",
                              borderRadius: "var(--radius-md)",
                              background: "linear-gradient(135deg, var(--primary-light) 0%, rgba(6,182,212,0.05) 100%)",
                              border: "1.5px dashed var(--primary)",
                              color: "var(--primary)", fontSize: 13,
                              textDecoration: "none",
                              fontWeight: 600,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              flex: 1
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = "linear-gradient(135deg, var(--primary) 0%, rgba(6,182,212,0.8) 100%)";
                              e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = "linear-gradient(135deg, var(--primary-light) 0%, rgba(6,182,212,0.05) 100%)";
                              e.currentTarget.style.color = "var(--primary)";
                            }}
                          >
                            <Icon.Receipt style={{ fontSize: 24 }} />
                            Ver PDF
                          </a>
                          <a
                            href={downloadUrl}
                            download={fileName}
                            style={{
                              display: "flex", flexDirection: "column",
                              alignItems: "center", justifyContent: "center",
                              gap: 10, padding: "24px 16px",
                              borderRadius: "var(--radius-md)",
                              background: "var(--surface-alt)",
                              border: "1.5px solid var(--border)",
                              color: "var(--text)", fontSize: 13,
                              textDecoration: "none",
                              fontWeight: 500,
                              cursor: "pointer",
                              transition: "all 0.2s",
                              flex: 1
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = "var(--primary-light)";
                              e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = "var(--surface-alt)";
                              e.currentTarget.style.color = "var(--text)";
                            }}
                          >
                            <Icon.Download style={{ fontSize: 24 }} />
                            Descargar
                          </a>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                            <img 
                              src={url} 
                              alt="diseno" 
                              style={{
                                width: "100%",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border)",
                                cursor: "pointer",
                                transition: "transform 0.2s, box-shadow 0.2s",
                              }}
                              onMouseEnter={e => { e.target.style.transform = "scale(1.02)"; e.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                              onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = "none"; }}
                            />
                          </a>
                          <a
                            href={downloadUrl}
                            download={fileName}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                              padding: "12px 16px",
                              borderRadius: "var(--radius-md)",
                              background: "var(--surface-alt)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                              textDecoration: "none",
                              fontSize: 13,
                              fontWeight: 500,
                              transition: "all 0.2s"
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = "var(--primary)";
                              e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = "var(--surface-alt)";
                              e.currentTarget.style.color = "var(--text)";
                            }}
                          >
                            <Icon.Download />
                            Descargar imagen
                          </a>
                        </div>
                      );
                    } else {
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {existingFiles.map((file, index) => {
                            const url = file.url;
                            const fileName = file.name || `archivo-${index + 1}`;
                            const downloadUrl = url.includes("?") ? `${url}&download=${fileName}` : `${url}?download=${fileName}`;
                            return (
                              <div key={index} style={{ display: "flex", gap: 8 }}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "12px 16px",
                                    borderRadius: "var(--radius-md)",
                                    background: "var(--surface-alt)",
                                    border: "1px solid var(--border)",
                                    color: "var(--primary)",
                                    textDecoration: "none",
                                    fontSize: 13,
                                    fontWeight: 500,
                                    transition: "all 0.2s",
                                    flex: 1
                                  }}
onMouseEnter={e => {
                                    e.currentTarget.style.background = "var(--primary)";
                                    e.currentTarget.style.color = "#fff";
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = "var(--surface-alt)";
                                    e.currentTarget.style.color = "var(--primary)";
                                  }}
                                >
                                  <Icon.FileText />
                                  Ver archivo {index + 1}
                                </a>
                                <a
                                  href={downloadUrl}
                                  download={fileName}
                                  style={{
                                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                                    padding: "12px 16px",
                                    borderRadius: "var(--radius-md)",
                                    background: "var(--surface)",
                                    border: "1px solid var(--border)",
                                    color: "var(--text)",
                                    textDecoration: "none",
                                    fontSize: 13,
                                    fontWeight: 500,
                                    transition: "all 0.2s"
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = "var(--primary-light)";
                                    e.currentTarget.style.color = "#fff";
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = "var(--surface)";
                                    e.currentTarget.style.color = "var(--text)";
                                  }}
                                >
                                  <Icon.Download />
                                  Descargar
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <div style={{
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 14, margin: "0 0 14px 0"
            }}>Información de la Orden</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Vendedor:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{userName}</span>
              </div>
              {order.designer_id && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Diseñador asignado:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{designerName}</span>
                </div>
              )}
              {quoteAssignedId && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Cotizador asignado:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{quoteUserName}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Creada:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{created}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Estado:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>{STATUS_LABELS[order.status] || order.status}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Pago:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{PAYMENT_LABELS[order.payment_status] || order.payment_status}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Archivada en admin:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: order.is_archived_admin ? "#B45309" : "var(--text)" }}>
                  {order.is_archived_admin ? "Si" : "No"}
                </span>
              </div>
              {order.price && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Precio:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--success)" }}>RD$ {parseFloat(order.price).toLocaleString("es-DO", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {order.delivery_date && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>Entrega:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{formatDate(order.delivery_date)}</span>
                </div>
              )}
            </div>
          </div>

          {order.payment_status === "pagado" && paymentInvoice && (
            <div style={{
              background: "var(--surface)",
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 20,
              marginBottom: 18
            }}>
              <p style={{
                fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.07em",
                marginBottom: 14, margin: "0 0 14px 0"
              }}>Factura de pago</p>

              <a href={paymentInvoice} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none" }}>
                <img
                  src={paymentInvoice}
                  alt="Factura de pago"
                  style={{
                    width: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "var(--surface-alt)",
                    cursor: "pointer",
                  }}
                />
              </a>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="pa-btn primary" style={{ flex: 1 }} onClick={() => { onClose(); onEdit(order); }}>
              <Icon.Edit />Editar
            </button>
          </div>
          {isAdminArchivable(order) && !order.is_archived_admin && (
            <button className="pa-btn" style={{ width: "100%", marginTop: 8, background: "#F59E0B", color: "#fff", border: "none" }} onClick={() => onArchive(order)}>
              <Icon.Archive />Archivar orden
            </button>
          )}
          {order.status !== "cancelled" && order.status !== "completada" && order.status !== "In_Design" && (
            <div style={{ marginTop: 8 }}>
              {order.order_design_type === "EXTERNAL_DESING" ? (
                <button className="pa-btn" style={{ width: "100%", background: "#06B6D4", color: "#fff", border: "none" }} onClick={() => onAssign(order, "quote")}>
                  Enviar a Cotización
                </button>
              ) : (
                <button className="pa-btn" style={{ width: "100%", background: "#8B5CF6", color: "#fff", border: "none" }} onClick={() => onAssign(order, "designer")}>
                  Asignar a Diseñador
                </button>
              )}
            </div>
          )}
          {order.status !== "cancelled" && order.status !== "completada" && (
            <button className="pa-btn danger" style={{ width: "100%", marginTop: 8 }} onClick={() => onCancel(order)}>
              <Icon.Trash />Cancelar Orden
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// Modal de asignación de orden a usuario
function AssignOrderModal({ open, onClose, order, role, onConfirm, loading }) {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (open && role) {
      setLoadingUsers(true);
      setSelectedUserId("");
      supabase
        .from("profiles")
        .select("id, name, role")
        .then(({ data, error }) => {
          setLoadingUsers(false);
          if (!error && data) {
            const filtered = data
              .filter(p => p.role && p.role.toLowerCase().includes(role.toLowerCase()))
              .map(p => ({ ...p, displayName: p.name || p.role }));
            setUsers(filtered);
          }
        });
    }
  }, [open, role]);

  const handleConfirm = () => {
    if (!selectedUserId) return;
    onConfirm(selectedUserId);
  };

  const roleLabel = role === "designer" ? "Diseñador" : "Cotizador";
  const roleColor = role === "designer" ? "#8B5CF6" : "#06B6D4";
  const isExternal = order?.order_design_type === "EXTERNAL_DESING";

  return (
    <ModalShell open={open} onClose={onClose} title={isExternal ? "Enviar a Cotización" : "Asignar Diseñador"} size="compact">
      <div style={{ minWidth: 320 }}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          {order?.client_name}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          {order?.description?.slice(0, 60)}{order?.description?.length > 60 ? "..." : ""}
        </p>

        <label className="ps-label" style={{ marginBottom: 8, display: "block" }}>
          Seleccionar {roleLabel}
        </label>
        {loadingUsers ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: 12, textAlign: "center", background: "var(--surface-alt)", borderRadius: "var(--radius-md)" }}>Cargando...</p>
        ) : users.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: 12, textAlign: "center", background: "var(--surface-alt)", borderRadius: "var(--radius-md)" }}>No hay {roleLabel.toLowerCase()}s disponibles</p>
        ) : (
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              border: "1.5px solid var(--border)",
              background: "var(--surface)",
              fontSize: 13,
              cursor: "pointer",
              marginBottom: 20,
              outline: "none"
            }}
          >
            <option value="">-- Seleccionar {roleLabel} --</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.displayName}</option>
            ))}
          </select>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="pa-btn secondary" style={{ flex: 1 }} onClick={onClose}>Cancelar</button>
          <button
            className="pa-btn primary"
            style={{ flex: 1, background: roleColor, borderColor: roleColor }}
            onClick={handleConfirm}
            disabled={!selectedUserId || loading}
          >
            {loading ? "Asignando..." : isExternal ? "Enviar a Cotización" : `Asignar a ${roleLabel}`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Versión enriquecida del formulario de órdenes para admin, con la misma capacidad de carga
// de archivos y preview que hoy utiliza seller.
function AdminOrderFormModal({ open, mode, orderForm, setOrderForm, onClose, onSubmit, saving }) {
  const filesInputRef = useRef(null);
  const previewInputRef = useRef(null);

  const previewSource = useMemo(() => {
    if (orderForm.newPreview) {
      return URL.createObjectURL(orderForm.newPreview);
    }

    return orderForm.existingPreview || "";
  }, [orderForm.existingPreview, orderForm.newPreview]);

  useEffect(() => {
    return () => {
      if (previewSource?.startsWith("blob:")) {
        URL.revokeObjectURL(previewSource);
      }
    };
  }, [previewSource]);

  const setField = (field, value) => {
    setOrderForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setOrderForm((prev) => ({
      ...prev,
      newFiles: [...prev.newFiles, ...files],
    }));

    event.target.value = "";
  };

  const handleRemoveExistingFile = (fileUrl) => {
    setOrderForm((prev) => ({
      ...prev,
      existingFiles: prev.existingFiles.filter((currentFile) => currentFile !== fileUrl),
      removedFiles: prev.removedFiles.includes(fileUrl) ? prev.removedFiles : [...prev.removedFiles, fileUrl],
    }));
  };

  const handleRemoveNewFile = (index) => {
    setOrderForm((prev) => ({
      ...prev,
      newFiles: prev.newFiles.filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  const handlePreviewChange = (event) => {
    const nextPreview = event.target.files?.[0];
    if (!nextPreview) return;

    setOrderForm((prev) => ({
      ...prev,
      newPreview: nextPreview,
      removePreview: false,
    }));

    event.target.value = "";
  };

  const handleRemovePreview = () => {
    setOrderForm((prev) => ({
      ...prev,
      newPreview: null,
      existingPreview: null,
      removePreview: Boolean(prev.existingPreview) || prev.removePreview,
    }));
  };

  return (
    <ModalShell open={open} onClose={onClose} title={mode === "create" ? "Crear orden" : "Editar orden"} size="large">
      <div className="pa-order-form-layout">
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Datos base</span>
            <h5>Información del cliente</h5>
          </div>

          <div className="pa-form-grid">
            <label className="pa-field">
              <span>Cliente</span>
              <input value={orderForm.client_name} onChange={(event) => setField("client_name", event.target.value)} placeholder="Nombre del cliente" />
            </label>
            <label className="pa-field">
              <span>Teléfono</span>
              <input value={orderForm.client_contact} onChange={(event) => setField("client_contact", event.target.value)} placeholder="Contacto principal" />
            </label>
            <label className="pa-field full">
              <span>Descripción</span>
              <textarea rows={3} value={orderForm.description} onChange={(event) => setField("description", event.target.value)} placeholder="Describe la orden con suficiente contexto para diseño y producción." />
            </label>
            <label className="pa-field">
              <span>Material</span>
              <select value={orderForm.material} onChange={(event) => setField("material", event.target.value)}>
                <option value="">Seleccionar material</option>
                <option value="Vinilo">Vinilo</option>
                <option value="Banner">Banner</option>
                <option value="Lona">Lona</option>
                <option value="Papel Fotografico">Papel Fotográfico</option>
                <option value="Carton">Cartón</option>
                <option value="Adhesivo">Adhesivo</option>
                <option value="PVC">PVC</option>
                <option value="Acrilico">Acrílico</option>
                <option value="Tela">Tela</option>
                <option value="Foam">Foam</option>
                <option value="Otro">Otro</option>
              </select>
            </label>
            <label className="pa-field">
              <span>Tipo de terminación</span>
              <input value={orderForm.termination_type} onChange={(event) => setField("termination_type", event.target.value)} placeholder="Ej. Brillante, Mate, Con marco..." />
            </label>
            <label className="pa-field">
              <span>Fecha de entrega</span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <input
                  type="date"
                  value={orderForm.delivery_date}
                  onChange={(event) => setField("delivery_date", event.target.value)}
                  disabled={orderForm.indefinido}
                  style={{ opacity: orderForm.indefinido ? 0.5 : 1 }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={orderForm.indefinido}
                    onChange={(event) => setField("indefinido", event.target.checked)}
                    style={{ width: "16px", height: "16px", margin: 0, cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "13px", color: "#64748b" }}>Por definir</span>
                </label>
              </div>
            </label>
            <label className="pa-field">
              <span>Tipo de orden</span>
              <select value={orderForm.order_type} onChange={(event) => setField("order_type", event.target.value)}>
                <option value="normal">Normal</option>
                <option value="orden 911">Orden 911</option>
              </select>
            </label>
            <label className="pa-field">
              <span>Tipo de diseño</span>
              <select value={orderForm.design_type} onChange={(event) => setField("design_type", event.target.value)}>
                <option value="INTERNAL_DESING">Diseño Interno</option>
                <option value="EXTERNAL_DESING">Diseño Externo</option>
              </select>
            </label>
          </div>
        </section>

        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Archivos</span>
            <h5>Diseños y orden de trabajo</h5>
          </div>

          <div className="pa-form-grid">
            <div className="pa-field full">
              <span>Archivos de diseño</span>
              <div className="pa-upload-stack">
                {[...orderForm.existingFiles, ...orderForm.newFiles].length > 0 ? (
                  <div className="pa-upload-files">
                    {orderForm.existingFiles.map((fileUrl) => (
                      <div key={fileUrl} className="pa-upload-file-chip">
                        <div>
                          <strong>{getFileNameFromUrl(fileUrl)}</strong>
                          <small>Archivo guardado</small>
                        </div>
                        <div className="pa-upload-chip-actions">
                          <a href={fileUrl} target="_blank" rel="noreferrer" className="pa-inline-link">Ver</a>
                          <button type="button" className="pa-chip-remove" onClick={() => handleRemoveExistingFile(fileUrl)}>Quitar</button>
                        </div>
                      </div>
                    ))}

                    {orderForm.newFiles.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="pa-upload-file-chip is-new">
                        <div>
                          <strong>{file.name}</strong>
                          <small>Se subirá al guardar</small>
                        </div>
                        <button type="button" className="pa-chip-remove" onClick={() => handleRemoveNewFile(index)}>Quitar</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pa-empty-small">Todavía no se han agregado archivos de diseño.</div>
                )}

                <div className="pa-upload-dropzone" onClick={() => filesInputRef.current?.click()}>
                  <input ref={filesInputRef} type="file" multiple style={{ display: "none" }} onChange={handleAddFiles} />
                  <div className="pa-upload-dropzone-copy">
                    <strong>Agregar archivos</strong>
                    <span>PDF, AI, PNG, JPG y otros documentos de diseño.</span>
                  </div>
                  <button type="button" className="pa-btn ghost pa-btn-sm">Seleccionar</button>
                </div>
              </div>
            </div>

            <div className="pa-field full">
              <span>Preview / Orden de trabajo</span>
              {previewSource ? (
                <div className="pa-preview-card">
                  <img src={previewSource} alt="Preview de la orden" className="pa-preview-image" />
                  <div className="pa-preview-card-footer">
                    <div>
                      <strong>{orderForm.newPreview ? orderForm.newPreview.name : "Preview actual"}</strong>
                      <small>{orderForm.newPreview ? "Se reemplazará al guardar" : "Archivo guardado"}</small>
                    </div>
                    <div className="pa-upload-chip-actions">
                      <button type="button" className="pa-btn ghost pa-btn-sm" onClick={() => previewInputRef.current?.click()}>Cambiar</button>
                      <button type="button" className="pa-btn danger pa-btn-sm" onClick={handleRemovePreview}>Quitar</button>
                    </div>
                  </div>
                  <input ref={previewInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePreviewChange} />
                </div>
              ) : (
                <div className="pa-upload-dropzone is-preview" onClick={() => previewInputRef.current?.click()}>
                  <input ref={previewInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePreviewChange} />
                  <div className="pa-upload-dropzone-copy">
                    <strong>Subir preview</strong>
                    <span>Imagen opcional para mostrar la orden de trabajo dentro del detalle.</span>
                  </div>
                  <button type="button" className="pa-btn ghost pa-btn-sm">Seleccionar</button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="pa-btn primary" onClick={onSubmit} disabled={saving}>
          {saving ? "Guardando..." : mode === "create" ? "Crear orden" : "Guardar cambios"}
        </button>
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
  const [assigningOrder, setAssigningOrder] = useState(null);
  const [assigningRole, setAssigningRole] = useState(null);
  const [assigningLoading, setAssigningLoading] = useState(false);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [quotationOrder, setQuotationOrder] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelOrderData, setCancelOrderData] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [quotationPaymentStatus, setQuotationPaymentStatus] = useState("Pending_Payment");
  const [quotationInvoice, setQuotationInvoice] = useState(null);
  const [quotationLoading, setQuotationLoading] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("active");
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

    // Realtime subscription para órdenes
    const ordersChannel = supabase
      .channel('admin-orders-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Funcionalidad para  resetea el formulario de ordenes
  const resetOrderForm = (order = null) => {
    if (!order) {
      setOrderForm({ ...DEFAULT_ORDER_FORM, id: "" });
      return;
    }
    setOrderForm({
      id: order.id || "",
      client_name: order.client_name || "",
      client_contact: order.client_contact || "",
      description: order.description || "",
      material: order.material || "",
      order_type: order.order_type || "normal",
      design_type: order.order_design_type || "INTERNAL_DESING",
      termination_type: order.termination_type || "",
      delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
      indefinido: !order.delivery_date,
      status: order.status || "Pending",
      payment_status: order.payment_status || "Pending_Payment",
      seller_id: order.seller_id || order.created_by || "",
      existingFiles: parseFileUrls(order.order_file_url),
      newFiles: [],
      removedFiles: [],
      existingPreview: order.preview_image || null,
      newPreview: null,
      removePreview: false,
    });
  };

  const openCreateOrder = () => {
    setOrderModalMode("create");
    resetOrderForm();
    setOrderModalOpen(true);
  };

  const openEditOrder = (order) => {
    setSelectedOrder(null); // Cerrar detail modal primero
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
      termination_type: orderForm.termination_type.trim() || null,
      order_type: orderForm.order_type,
      order_design_type: orderForm.design_type,
      delivery_date: orderForm.indefinido ? null : (orderForm.delivery_date || null),
      status: "Pending",
      payment_status: orderForm.payment_status,
      seller_id: user?.id || null,
      created_by: user?.id || null,
    };

    setSavingOrder(true);

    let finalPreviewUrl = orderForm.existingPreview;
    let finalFileUrls = [...orderForm.existingFiles];

    // Subir nuevos archivos de diseño
    for (const file of orderForm.newFiles) {
      const fileName = buildStorageFileName(file, "design-");
      const publicUrl = await uploadOrderAsset({
        bucket: "order-docs",
        path: `orders/${selectedOrder?.id || "new"}/files/${fileName}`,
        file,
      });
      if (publicUrl) finalFileUrls.push(publicUrl);
    }

    // Subir nuevo preview
    if (orderForm.newPreview) {
      const fileName = buildStorageFileName(orderForm.newPreview, "preview-");
      finalPreviewUrl = await uploadOrderAsset({
        bucket: "order-previews",
        path: `orders/${selectedOrder?.id || "new"}/preview/${fileName}`,
        file: orderForm.newPreview,
      });
    }

    // Si se eliminó el preview existente
    if (orderForm.removePreview || (!orderForm.newPreview && orderForm.existingPreview && orderForm.removePreview)) {
      finalPreviewUrl = null;
    }

    // Eliminar archivos removidos
    const remainingFiles = finalFileUrls.filter(url => !orderForm.removedFiles.includes(url));

    payload.preview_image = finalPreviewUrl;
    payload.order_file_url = remainingFiles.length > 0 ? serializeFileUrls(remainingFiles) : null;

    // Determinar si es create o edit
    const isCreate = orderModalMode === "create";
    const orderId = orderForm.id;

    let error;
    if (isCreate) {
      const { data: newOrder, error: insertError } = await supabase.from("orders").insert([payload]).select().single();
      error = insertError;
    } else {
      const { error: updateError } = await supabase.from("orders").update(payload).eq("id", orderId);
      error = updateError;
    }

    setSavingOrder(false);

    if (error) return showFeedback("error", `No se pudo guardar la orden: ${error.message}`);

    setOrderModalOpen(false);
    setSelectedOrder(null);
    resetOrderForm();
    await loadOrders();
    showFeedback("success", orderModalMode === "create" ? "Orden creada correctamente." : "Orden actualizada correctamente.");
  };

  const openCancelModal = (order) => {
    if (["pagado", "cancelled", "completada"].includes(order.payment_status)) {
      showFeedback("error", "No se puede cancelar una orden pagada o cancelada.");
      return;
    }
    setCancelOrderData(order);
    setCancelModalOpen(true);
  };

  const handleConfirmCancelOrder = async () => {
    if (!cancelOrderData) return;
    setCancelLoading(true);

    const { error } = await supabase
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", cancelOrderData.id);

    setCancelLoading(false);

    if (error) {
      return showFeedback("error", "No se pudo cancelar la orden.");
    }

    setCancelModalOpen(false);
    setCancelOrderData(null);
    if (selectedOrder?.id === cancelOrderData.id) setSelectedOrder(null);
    await loadOrders();
    showFeedback("success", "La orden fue cancelada correctamente.");
  };

  const openAssignModal = (order, role) => {
    setAssigningOrder(order);
    setAssigningRole(role);
  };

  const openArchiveModal = (order) => {
    if (order?.is_archived_admin) {
      showFeedback("error", "La orden ya está archivada en administración.");
      return;
    }

    if (!isAdminArchivable(order)) {
      showFeedback("error", "Solo se pueden archivar órdenes canceladas o completadas.");
      return;
    }

    setArchivingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;

    setArchiveLoading(true);
    const { error } = await supabase
      .from("orders")
      .update({ is_archived_admin: true })
      .eq("id", archivingOrder.id);
    setArchiveLoading(false);

    if (error) {
      return showFeedback("error", "No se pudo archivar la orden.");
    }

    if (selectedOrder?.id === archivingOrder.id) {
      setSelectedOrder((prev) => prev ? { ...prev, is_archived_admin: true } : prev);
    }

    setArchivingOrder(null);
    await loadOrders();
    showFeedback("success", "La orden fue archivada correctamente.");
  };

  const handleAssignOrder = async (userId) => {
    if (!assigningOrder || !assigningRole) return;
    setAssigningLoading(true);

    const isDesigner = assigningRole === "designer";
    const payload = isDesigner
      ? { status: "In_Design", designer_id: userId }
      : { status: "cotizacion", quote_id: userId, quotation_id: userId };

    const { error } = await supabase.from("orders").update(payload).eq("id", assigningOrder.id);

    setAssigningLoading(false);

    if (error) {
      showFeedback("error", "No se pudo asignar la orden.");
      return;
    }

    setAssigningOrder(null);
    setAssigningRole(null);
    await loadOrders();
    showFeedback("success", `Orden asignada a ${isDesigner ? "diseñador" : "cotizador"} correctamente.`);
  };

  const openQuotationModal = (order) => {
    setQuotationOrder(order);
    setQuotationPaymentStatus(order.payment_status || "Pending_Payment");
    setQuotationInvoice(null);
    setQuotationModalOpen(true);
  };

  const handleQuotationOrder = async () => {
    if (!quotationOrder) return;

    if (quotationPaymentStatus === "pagado" && !quotationInvoice) {
      return showFeedback("error", "Debe subir la imagen de pago para marcar como pagado.");
    }

    setQuotationLoading(true);

    let paymentInvoiceUrl = null;

    if (quotationInvoice) {
      // Validar imagen antes de subir
      const validation = await validateImage(quotationInvoice);
      
      if (!validation.isValid) {
        setQuotationLoading(false);
        return showFeedback("error", validation.error || "La imagen no es válida.");
      }

      try {
        const filePath = buildPaymentReceiptPath(quotationOrder.id, quotationInvoice.name);
        const publicUrl = await uploadOrderAsset({
          bucket: "payment-invoice",
          path: filePath,
          file: quotationInvoice,
        });
        if (publicUrl) {
          paymentInvoiceUrl = publicUrl;
        } else {
          setQuotationLoading(false);
          return showFeedback("error", "Error al subir la imagen de pago.");
        }
      } catch (uploadError) {
        setQuotationLoading(false);
        return showFeedback("error", uploadError?.message || "Error al subir la imagen de pago.");
      }
    }

    const { error } = await supabase
      .from("orders")
      .update({
        payment_status: quotationPaymentStatus,
        invoice_payment: paymentInvoiceUrl,
      })
      .eq("id", quotationOrder.id);

    setQuotationLoading(false);

    if (error) {
      return showFeedback("error", "Error al actualizar la orden.");
    }

    setQuotationModalOpen(false);
    setQuotationOrder(null);
    await loadOrders();
    showFeedback("success", "Orden cotizada correctamente.");
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
    const selectedProfile = ownerFilter === "all" ? null : usersById[ownerFilter];

    return orders.filter(order => {
      const relatedUserNames = [...new Set(getOrderSearchUserIds(order))]
        .map((userId) => getUserDisplayName(usersById[userId]));
      const matchesSearch = !q || [order.client_name, order.description, order.material, order.id, ...relatedUserNames].some(value => normalizeText(value).includes(q));
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesOwner = ownerFilter === "all" || orderMatchesProfileFilter(order, selectedProfile);
      const matchesArchive = archiveFilter === "all"
        || (archiveFilter === "active" && !order.is_archived_admin)
        || (archiveFilter === "archived" && order.is_archived_admin);
      const createdAt = new Date(order.created_at);
      const matchesDate = dateFilter === "all" || (dateFilter === "today" && createdAt >= startOfToday) || (dateFilter === "week" && createdAt >= startOfWeek);
      return matchesSearch && matchesStatus && matchesOwner && matchesArchive && matchesDate;
    });
  }, [orders, search, statusFilter, ownerFilter, archiveFilter, dateFilter, usersById]);

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
    { label: "Archivadas", value: orders.filter(order => order.is_archived_admin).length },
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

        {activeTab === "overview" &&
          <section className="pa-section">
            <div className="pa-metrics-grid">
              {metrics.map(metric =>
                <article key={metric.label} className="pa-metric-card">
                  <div className="pa-metric-icon">{
                    metric.icon}
                  </div>
                  <div>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                </article>)}
            </div>
            <div className="pa-two-col">
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-head">
                  <div>
                    <span className="pa-section-kicker">
                      Monitoreo
                    </span>
                    <h2>
                      Estado del sistema
                    </h2>
                  </div>
                </div>
                <div className="pa-stats-list">
                  {typeMetrics.map(item => <div key={item.label} className="pa-stat-row">
                    <span>
                      {item.label}
                    </span>
                    <strong>
                      {item.value}
                    </strong></div>)
                  }
                </div>
              </div>
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-head">
                  <div>
                    <span className="pa-section-kicker">
                      Actividad reciente
                    </span>
                    <h2>
                      Órdenes más recientes
                    </h2>
                  </div>
                </div>
                <div className="pa-recent-list">
                  {orders.slice(0, 5).map(order =>
                    <button key={order.id} className="pa-recent-item" onClick={() => setSelectedOrder(order)}>
                      <div>
                        <strong>
                          {order.client_name || "Cliente sin nombre"}
                        </strong>
                        <span>
                          {getUserDisplayName(usersById[order.seller_id || order.created_by])}
                        </span>
                      </div>
                      <div className="pa-recent-meta">
                        <StatusBadge value={order.status} />
                        <span>
                          {formatDate(order.created_at)}
                        </span>
                      </div>
                    </button>)}
                </div>
              </div>
            </div>
          </section>
        }

        {activeTab === "orders" &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-orders">
              <div className="pa-search-box pa-toolbar-search">
                <Icon.Search />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente, descripción, material o usuario..." />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Todos los estados</option>
                {STATUS_OPTIONS.map(status => <option key={status} value={status}>{STATUS_LABELS[status] || status}</option>)}
              </select>
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                <option value="all">Todas las fechas</option>
                <option value="today">Hoy</option>
                <option value="week">Últimos 7 días</option>
              </select>
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="all">Todos los usuarios</option>
                {profiles.map(item =>
                  <option key={item.id} value={item.id}>
                    {getUserDisplayName(item)}
                  </option>
                )}
              </select>
              <select value={archiveFilter} onChange={(e) => setArchiveFilter(e.target.value)}>
                <option value="active">Activas</option>
                <option value="all">Todas</option>
                <option value="archived">Archivadas</option>
              </select>
              <button className="pa-btn primary pa-toolbar-create" onClick={openCreateOrder}><Icon.Plus />
                Nueva orden
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-head pa-panel-head-results">
                <div>
                  <span className="pa-section-kicker">
                    Supervisión
                  </span>
                  <h2>
                    Órdenes del sistema
                  </h2>
                </div>
                <span className="pa-results-count">
                  {filteredOrders.length} resultados
                </span>
              </div>
              <div className="ps-table-wrap">
                <table className="ps-table">
                  <thead>
                    <tr>
                      {["ID", "Cliente", "Descripción", "Material", "Estado", "Pago", "Tipo", "Fecha", ""].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingOrders ? <tr><td colSpan={9} className="ps-table-empty">Cargando órdenes...</td></tr> : filteredOrders.length === 0 ? <tr><td colSpan={9} className="ps-table-empty">No hay órdenes disponibles.</td></tr> : filteredOrders.map(order =>
                          <tr key={order.id} className="row-hover">
                            <td className="td-pad td-id">{order.id?.slice(0, 8) || "---"}</td>
                            <td className="td-pad td-name">{order.client_name || "Sin cliente"}</td>
                            <td className="td-pad td-desc">{order.description || "Sin descripción"}</td>
                            <td className="td-pad td-mat">{order.material || "---"}</td>
                            <td className="td-pad"><StatusBadge value={order.status} /></td>
                            <td className="td-pad"><PaymentBadge value={order.payment_status} /></td>
                            <td className="td-pad">
                              {order.order_type === "orden 911" ? (
                                <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #EF444420" }}>911</span>
                              ) : (
                                <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>Normal</span>
                              )}
                            </td>
                            <td className="td-pad td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                            <td className="td-pad td-actions">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={() => setSelectedOrder(order)} title="Ver detalles">
                                  <Icon.Eye />
                                </button>
                                <button className="table-action-btn edit" onClick={() => openEditOrder(order)} title="Editar orden">
                                  <Icon.Edit />
                                </button>
                                {order.status !== "cancelled" && order.status !== "completada" && (
                                  <button className="table-action-btn" style={{ background: "#06B6D4", color: "#fff", border: "none" }} onClick={() => openQuotationModal(order)} title="Cotizar">
                                    <Icon.Money />
                                  </button>
                                )}
                                {order.status !== "cancelled" &&
                                  <button className="table-action-btn cancel" onClick={() => openCancelModal(order)} title="Cancelar orden">
                                    <Icon.Trash />
                                  </button>}
                                {isAdminArchivable(order) && (
                                  order.is_archived_admin ? (
                                    <button className="table-action-btn archive" title="Orden archivada" disabled>
                                      <Icon.Archive />
                                    </button>
                                  ) : (
                                    <button className="table-action-btn archive" onClick={() => openArchiveModal(order)} title="Archivar orden">
                                      <Icon.Archive />
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        }

        {activeTab === "users" &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-users">
              <div className="pa-search-box pa-toolbar-search"><Icon.Search />
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
              <button className="pa-btn primary pa-toolbar-create" onClick={() => setUserModalOpen(true)}><Icon.Plus />
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
                            <div className="pa-user-header-main">
                              <div className="pa-user-avatar-mini">
                                {getUserDisplayName(item).charAt(0).toUpperCase()}
                              </div>
                              <div className="pa-user-info">
                                <strong className="pa-user-name">
                                  {getUserDisplayName(item)}
                                </strong>
                                <span className="pa-user-email">
                                  {item.email || "Sin correo"}
                                </span>
                              </div>
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

      <AdminOrderFormModal
        open={orderModalOpen}
        mode={orderModalMode}
        orderForm={orderForm}
        setOrderForm={setOrderForm}
        onClose={() => { setOrderModalOpen(false); setSelectedOrder(null); resetOrderForm(); }}
        onSubmit={handleSaveOrder}
        saving={savingOrder}
      />
      <AdminOrderDetailModal
        open={!!selectedOrder}
        order={selectedOrder}
        usersById={usersById}
        onClose={() => setSelectedOrder(null)}
        onEdit={openEditOrder}
        onCancel={openCancelModal}
        onAssign={openAssignModal}
        onArchive={openArchiveModal}
      />
      <AssignOrderModal
        open={!!assigningOrder}
        order={assigningOrder}
        role={assigningRole}
        onClose={() => { setAssigningOrder(null); setAssigningRole(null); }}
        onConfirm={handleAssignOrder}
        loading={assigningLoading}
      />
      <ModalShell open={quotationModalOpen} onClose={() => setQuotationModalOpen(false)} title="Cotizar Orden" size="compact">
        <div style={{ minWidth: 320 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            {quotationOrder?.client_name}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            {quotationOrder?.description?.slice(0, 60)}{quotationOrder?.description?.length > 60 ? "..." : ""}
          </p>

          <label className="ps-label" style={{ marginBottom: 8, display: "block" }}>
            Estado de Pago
          </label>
          <select
            value={quotationPaymentStatus}
            onChange={(e) => setQuotationPaymentStatus(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              border: "1.5px solid var(--border)",
              background: "var(--surface)",
              fontSize: 13,
              cursor: "pointer",
              marginBottom: 16,
              outline: "none"
            }}
          >
            <option value="Pending_Payment">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
          </select>

          {quotationPaymentStatus === "pagado" && (
            <div style={{ marginBottom: 20 }}>
              <label className="ps-label" style={{ marginBottom: 8, display: "block" }}>
                Imagen de Recibo/Factura <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setQuotationInvoice(e.target.files?.[0] || null)}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  border: "1.5px solid var(--border)",
                  background: "var(--surface)",
                  fontSize: 13,
                }}
              />
              {quotationInvoice && (
                <p style={{ fontSize: 12, color: "var(--success)", marginTop: 8 }}>
                  ✓ {quotationInvoice.name}
                </p>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="pa-btn secondary" style={{ flex: 1 }} onClick={() => setQuotationModalOpen(false)}>
              Cancelar
            </button>
            <button
              className="pa-btn primary"
              style={{ flex: 1, background: "#06B6D4", borderColor: "#06B6D4" }}
              onClick={handleQuotationOrder}
              disabled={quotationLoading || (quotationPaymentStatus === "pagado" && !quotationInvoice)}
            >
              {quotationLoading ? "Guardando..." : "Confirmar"}
            </button>
          </div>
        </div>
      </ModalShell>
      <ModalShell open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="Confirmar Cancelación" size="compact">
        <div style={{ minWidth: 320, textAlign: "center" }}>
          <div style={{ 
            width: 64, height: 64, borderRadius: "50%", 
            background: "#FEE2E2", color: "#EF4444",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px"
          }}>
            <Icon.Trash />
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            ¿Estás seguro de que deseas cancelar esta orden?
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            <strong>{cancelOrderData?.client_name}</strong>
            <br />
            <span style={{ fontSize: 12 }}>{cancelOrderData?.description?.slice(0, 50)}{cancelOrderData?.description?.length > 50 ? "..." : ""}</span>
          </p>
          <p style={{ fontSize: 12, color: "#EF4444", marginBottom: 20 }}>
            ⚠️ Esta acción no se puede deshacer
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="pa-btn secondary" style={{ flex: 1 }} onClick={() => setCancelModalOpen(false)}>
              Cerrar
            </button>
            <button
              className="pa-btn"
              style={{ flex: 1, background: "#EF4444", color: "#fff", border: "none" }}
              onClick={handleConfirmCancelOrder}
              disabled={cancelLoading}
            >
              {cancelLoading ? "Cancelando..." : "Sí, cancelar orden"}
            </button>
          </div>
        </div>
      </ModalShell>
      <ModalShell open={!!archivingOrder} onClose={() => setArchivingOrder(null)} title="Archivar Orden" size="compact">
        <div style={{ minWidth: 320, textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "#FEF3C7", color: "#D97706",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px"
          }}>
            <Icon.Archive />
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            Deseas archivar esta orden?
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            <strong>{archivingOrder?.client_name}</strong>
            <br />
            <span style={{ fontSize: 12 }}>La orden se ocultara de la vista activa, pero seguira disponible en el filtro de archivadas.</span>
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="pa-btn secondary" style={{ flex: 1 }} onClick={() => setArchivingOrder(null)} disabled={archiveLoading}>
              Cancelar
            </button>
            <button
              className="pa-btn"
              style={{ flex: 1, background: "#F59E0B", color: "#fff", border: "none" }}
              onClick={handleConfirmArchiveOrder}
              disabled={archiveLoading}
            >
              {archiveLoading ? "Archivando..." : "Archivar"}
            </button>
          </div>
        </div>
      </ModalShell>
      <UserCreateModal open={userModalOpen} userForm={userForm} setUserForm={setUserForm} onClose={() => setUserModalOpen(false)} onSubmit={handleCreateUser} saving={savingUser} />
      <UserDetailModal open={userDetailModalOpen} user={selectedUser} onClose={() => setUserDetailModalOpen(false)} onRequestEmploymentToggle={openEmploymentStatusConfirm} onShowFeedback={showFeedback} />
      <EmploymentStatusConfirmModal open={employmentStatusConfirmOpen} pendingChange={pendingEmploymentStatusChange} onClose={closeEmploymentStatusConfirm} onConfirm={confirmEmploymentStatusChange} saving={savingEmploymentStatus} />
    </div>
  );
}
