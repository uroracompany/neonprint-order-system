import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-seller.css";
import Sidebar from "../components/Sidebar";
import { Icons } from "../utils/icons";
import { StatusBadge as SharedStatusBadge, PaymentBadge } from "../components/ui/Badge";
import { AssignModal } from "../components/ui/AssignModal";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect, ClientSelect } from "../components/ui/ClientCombobox";
import {
  ORDER_STATUS,
  PAYMENT_COLORS,
  QUOTE_ASSIGNMENT_FIELDS,
  STATUS_OPTIONS,
  MATERIAL_OPTIONS,
  getOrderStatusConfig,
  isOrderStatus,
  isOrderStatusIn,
  parseFileUrls,
} from "../utils/constants";
import { FlowTracker, FlowTrackerExternal } from "../components/FlowTracker";
import useNotifications from "../hooks/useNotifications";
import NotificationCenter from "../components/NotificationCenter";
import { buildStorageSafeFileName, removeOrderAssetByPublicUrl, uploadOrderAsset } from "../utils/uploadOrderAsset";
import { formatDominicanPhone, getManualClientEditFields, getSelectedClientOrderFields, loadClients, orderMatchesClientFilter, searchClients } from "../utils/clients";

const isReturnedOrder = (order) => {
  if (!order || !order.return_reason) return false;
  const validStatuses = order.order_design_type === "EXTERNAL_DESING"
    ? [ORDER_STATUS.PENDING]
    : [ORDER_STATUS.IN_DESIGN];
  return isOrderStatusIn(order.status, validStatuses);
};

const SELLER_HIDDEN_NOTIFICATION_EVENTS = new Set([
  "designer_assigned",
  "quote_assigned",
]);

const ACTIVE_WORKFLOW_STATUSES_FOR_SELLER = [
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.CANCELLED,
];

const isSellerVisibleNotification = (notification) => {
  const eventKind = notification?.metadata?.event_kind;
  return !SELLER_HIDDEN_NOTIFICATION_EVENTS.has(eventKind);
};

const PHONE_PLACEHOLDER = "Ej: 809-555-1234";

const isValidDominicanPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalized.length !== 10) return false;

  const areaCode = normalized.slice(0, 3);
  return ["809", "829", "849"].includes(areaCode);
};

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
];






function StatusBadge({ status, type = "status" }) {
  if (type === "payment") {
    return <PaymentBadge status={status} className="ps-badge" bordered />;
  }
  return <SharedStatusBadge status={status} className="ps-badge" showDot bordered />;
}

// CARTA DE METRICA PARA DASHBOARD
function MetricCard({ icon, label, value, sub, accentIdx = 0, trend }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="ps-card"
      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
      <div className="ps-card-glow" style={{ background: acc.glow }} />
      {trend !== undefined && <span className="ps-trend-badge"><Icons.TrendUp /> +{trend}%</span>}
      <div className="ps-card-icon" style={{ background: acc.bg, color: acc.color }}>{icon}</div>
      <div className="ps-card-value">{value}</div>
      <div className="ps-card-label">{label}</div>
      {sub && <div className="ps-card-sub" style={{ color: acc.color }}>{sub}</div>}
    </div>
  );
}

//OVERLAY DE LOS MODALES, RECIBE PROPS DE CONTROL Y CONTENIDO
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    // onClick={e => e.target === e.currentTarget && onClose()}
    // Overlay del modal de crear video 
    <div className="ps-modal-overlay">
      <div className={`ps-modal ${wide ? "wide" : "narrow"}`}>
        <div className="ps-modal-stripe" />
        <div className="ps-modal-header">
          <span className="ps-modal-title">{title}</span>
          <button className="ps-modal-close" onClick={onClose}><Icons.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}

// CAMPO DE FORMULARIO QUE RECIBE VALORES
function Field({ label, required, optional, hint, error, children }) {
  return (
    <div className={`ps-field ${error ? "ps-field-error" : ""}`}>
      <label className="ps-label">
        {label}
        {required && <span className="ps-label-req">*</span>}
        {optional && <span className="ps-label-opt">(opcional)</span>}
      </label>
      {hint && <p className="ps-field-hint">{hint}</p>}
      <div className={`ps-field-input-wrapper ${error ? "has-error" : ""}`}>
        {children}
      </div>
      {error && <p className="ps-field-error-message">{error}</p>}
    </div>
  );
}





// ─── Selector de diferentes materiales ──────────────────────────────────────────────────
export function MultiMaterialSelector({ selected = [], onChange, options = [] }) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const ref = useRef(null);
  const customInputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setCustomMode(false); setCustomValue(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (mat) => {
    onChange(selected.includes(mat) ? selected.filter(m => m !== mat) : [...selected, mat]);
  };
  const remove = (mat) => onChange(selected.filter(m => m !== mat));

  const handleAddCustom = () => {
    const val = customValue.trim();
    if (val && !selected.includes(val)) {
      onChange([...selected, val]);
    }
    setCustomValue("");
    setCustomMode(false);
  };

  const handleCustomKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleAddCustom(); }
    if (e.key === "Escape") { setCustomMode(false); setCustomValue(""); }
  };

  useEffect(() => {
    if (customMode && customInputRef.current) customInputRef.current.focus();
  }, [customMode]);

  const isCustomMaterial = (mat) => !options.includes(mat);

  return (
    <div className="ps-multimat" ref={ref}>
      {/* Chips + trigger */}
      <div className={`ps-multimat-box ${open ? "focused" : ""}`} onClick={() => setOpen(p => !p)}>
        {selected.length === 0
          ? <span className="ps-multimat-placeholder">Seleccionar materiales...</span>
          : selected.map(m => (
            <span key={m} className={`ps-chip ${isCustomMaterial(m) ? "ps-chip--custom" : ""}`}>
              {isCustomMaterial(m) && <span className="ps-chip-custom-icon"><Icons.Plus /></span>}
              {m}
              <button className="ps-chip-remove" onClick={e => { e.stopPropagation(); remove(m); }}><Icons.X /></button>
            </span>
          ))
        }
        <span className="ps-multimat-arrow"><Icons.ChevronDown /></span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="ps-multimat-dropdown">
          {/* Agregar personalizado (primero) */}
          {!customMode ? (
            <div className="ps-multimat-option ps-multimat-add" onClick={() => setCustomMode(true)}>
              <span className="ps-multimat-add-icon"><Icons.Plus /></span>
              Agregar material personalizado
            </div>
          ) : (
            <div className="ps-multimat-custom-form">
              <input
                ref={customInputRef}
                className="ps-multimat-custom-input"
                placeholder="Escribe el nombre del material..."
                value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                onKeyDown={handleCustomKeyDown}
              />
              <button className="ps-multimat-custom-btn" onClick={handleAddCustom} disabled={!customValue.trim()}>
                Agregar
              </button>
            </div>
          )}

          {/* Separador */}
          <div className="ps-multimat-divider" />

          {options.map(mat => (
            <div key={mat} className={`ps-multimat-option ${selected.includes(mat) ? "selected" : ""}`} onClick={() => toggle(mat)}>
              <span className="ps-multimat-check">{selected.includes(mat) ? "✓" : ""}</span>
              {mat}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── UPLOAD FIELD ─────────────────────────────────────────────────────────────
function UploadField({ fileRef, previewUrl, fileName, onFileChange, onRemove, onChangeClick, accept = "image/*", maxMB = 5 }) {
  return !previewUrl ? (
    <div className="ps-upload-zone" onClick={() => fileRef.current?.click()}>
      <div className="ps-upload-icon"><Icons.Upload /></div>
      <p className="ps-upload-title">Haz clic para seleccionar un archivo</p>
      <p className="ps-upload-sub">{accept === "image/*" ? "PNG, JPG, WEBP" : "PDF, PNG, JPG"} &mdash; max. {maxMB} MB</p>
      <input ref={fileRef} type="file" accept={accept} style={{ display: "none" }} onChange={onFileChange} />
    </div>
  ) : (
    <div className="ps-preview-wrap">
      {accept === "image/*"
        ? <img src={previewUrl} alt="preview" className="ps-preview-img" />
        : (
          <div className="ps-file-preview-box">
            <Icons.Receipt />
            <span className="ps-file-preview-name">{fileName}</span>
          </div>
        )
      }
      <div className="ps-preview-overlay">
        <div>
          <p className="ps-preview-file-label">Archivo seleccionado</p>
          <p className="ps-preview-file-name">{fileName}</p>
        </div>
        <div className="ps-preview-actions">
          <button className="ps-preview-change-btn" onClick={onChangeClick}>Cambiar</button>
          <button className="ps-preview-del-btn" onClick={onRemove}><Icons.Trash /></button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={accept} style={{ display: "none" }} onChange={onFileChange} />
    </div>
  );
}

// ─── CREATE ORDER MODAL ───────────────────────────────────────────────────────
const EMPTY_FORM = {
  client_id: null,
  client_name: "",
  client_phone: "",
  description: "",
  materials: [],       // array — multi-select
  termination_type: "", // tipo de terminación
  order_type: "",       // "orden normal" | "orden 911"
  design_type: "",       // "INTERNAL_DESING" | "EXTERNAL_DESING"
  delivery_date: "",       // ISO date string o "" (indefinido)
  indefinido: false,    // si true, fecha queda como indefinida
  design_files: [],     // archivos de diseño externo
  design_preview: null, // imagen preview de diseño externo
};

function CreateOrderModal({ open, onClose, onCreated, userId, materialOptions, clients = [], onClientSearch }) {
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    // Limpiar error del campo cuando se edita
    if (fieldErrors[k]) {
      setFieldErrors(p => {
        const next = { ...p };
        delete next[k];
        return next;
      });
    }
  };

  const setClientField = (k, v) => {
    setForm(p => ({ ...p, ...getManualClientEditFields(k, v) }));
    if (fieldErrors[k]) {
      setFieldErrors(p => {
        const next = { ...p };
        delete next[k];
        return next;
      });
    }
  };

  const applySelectedClient = (client) => {
    if (!client) {
      setForm(p => ({ ...p, ...getSelectedClientOrderFields(null) }));
      return;
    }

    const fields = getSelectedClientOrderFields(client, "client_phone");
    if (fields.client_phone) fields.client_phone = formatDominicanPhone(fields.client_phone);

    setForm(p => ({ ...p, ...fields }));
    setFieldErrors(p => {
      const next = { ...p };
      delete next.client_name;
      delete next.client_phone;
      return next;
    });
  };

  // Función de validación que retorna objeto de errores por campo
  const validateForm = () => {
    const errors = {};
    
    if (!form.client_name.trim()) {
      errors.client_name = "El nombre del cliente es requerido.";
    }
    if (!form.description.trim()) {
      errors.description = "La descripción del trabajo es requerida.";
    }
    if (form.materials.length === 0) {
      errors.materials = "Selecciona al menos un material.";
    }
    if (!form.order_type) {
      errors.order_type = "Selecciona el tipo de orden.";
    }
    if (!form.design_type) {
      errors.design_type = "Indica si el diseño es interno o externo.";
    }
    if (form.client_phone.trim() && !isValidDominicanPhone(form.client_phone)) {
      errors.client_phone = "El teléfono debe ser un número válido de República Dominicana (809, 829 o 849).";
    }
    if (!form.indefinido && !form.delivery_date) {
      errors.delivery_date = "Selecciona una fecha de entrega o marca 'Por definir'.";
    }
    if (form.design_type === "EXTERNAL_DESING" && form.design_files.length === 0) {
      errors.design_files = "Debe subir al menos un archivo de diseño.";
    }
    if (form.design_type === "EXTERNAL_DESING" && !form.design_preview) {
      errors.design_preview = "Debe agregar una imagen de la orden de trabajo.";
    }
    
    return errors;
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const withTimeout = (promise, ms) => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    );
    return Promise.race([promise, timeout]);
  };

  const handleSubmit = async () => {
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Por favor, corrige los errores en el formulario.");
      requestAnimationFrame(() => {
        const el = document.querySelector(".ps-field-error");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setLoading(true);
    setError("");
    setFieldErrors({});

    try {
      await withTimeout((async () => {
        // Auto-asignar como indefinido si no hay fecha ni marcación
        if (!form.delivery_date) {
          form.indefinido = true;
        }

        const payload = {
          client_id: form.client_id || null,
          client_name: form.client_name.trim(),
          client_contact: form.client_phone.trim() || null,
          description: form.description.trim(),
          material: form.materials.join(", "),
          termination_type: form.termination_type.trim() || null,
          order_type: form.order_type,
          order_design_type: form.design_type,
          delivery_date: form.indefinido ? null : (form.delivery_date || null),
          status: ORDER_STATUS.PENDING,
          payment_status: "Pending_Payment",
          seller_id: userId,
          created_by: userId,
        };

        // ── Subir archivos ANTES de insertar (solo Diseño Externo) ──
        let fileUrls = [];
        let previewUrl = null;

        if (form.design_files.length > 0 || form.design_preview) {
          const orderId = crypto.randomUUID();

          try {
            for (let i = 0; i < form.design_files.length; i++) {
              const file = form.design_files[i];
              const fileName = buildStorageSafeFileName(file, `${i}-`);
              const publicUrl = await uploadOrderAsset({
                bucket: "order-docs",
                path: `orders/${orderId}/files/${fileName}`,
                file,
              });

              if (publicUrl) fileUrls.push(publicUrl);
            }
          } catch {
            throw new Error("Error al subir los archivos. Verifica que no sean demasiado grandes y que tu conexión esté estable.");
          }

          if (form.design_preview) {
            try {
              const fileName = buildStorageSafeFileName(form.design_preview, "preview-");
              previewUrl = await uploadOrderAsset({
                bucket: "order-previews",
                path: `orders/${orderId}/preview/${fileName}`,
                file: form.design_preview,
              });
            } catch {
              throw new Error("Error al subir la imagen de previsualización. Intenta con un archivo más pequeño.");
            }
          }

          if (fileUrls.length > 0) payload.order_file_url = JSON.stringify(fileUrls);
          if (previewUrl) payload.preview_image = previewUrl;
          payload.id = orderId;
        }

        const { error: err } = await supabase.from("orders").insert([payload]).select().single();
        if (err) throw new Error("No se pudo crear la orden. Intenta nuevamente.");
      })(), 60000);

      handleClose(); onCreated?.();
    } catch (err) {
      if (err.message === "timeout") {
        setError("La orden está tardando más de lo normal. Verifica tu conexión a internet e intenta de nuevo.");
      } else {
        setError(err.message || "No se pudo crear la orden. Intenta nuevamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setError("");
    setFieldErrors({});
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Nueva Orden">
      {error && <div className="ps-form-error">{error}</div>}

      {/* ─ Sección 1: Datos del cliente ─ */}
      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Cliente registrado" optional hint="Busca y selecciona un cliente registrado.">
            <ClientSelect
              clients={clients}
              value={form.client_id}
              onSelect={applySelectedClient}
              onSearch={onClientSearch}
              placeholder="Seleccionar cliente registrado"
            />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Nombre del cliente" required error={fieldErrors.client_name}>
            <input className="ps-form-input" placeholder="Ej: Empresa ABC"
              value={form.client_name} onChange={e => setClientField("client_name", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Telefono / Contacto" optional hint="WhatsApp o numero de contacto del cliente" error={fieldErrors.client_phone}>
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icons.Phone /></span>
              <input className="ps-form-input with-icon" placeholder={PHONE_PLACEHOLDER}
                value={form.client_phone} onChange={e => setClientField("client_phone", formatDominicanPhone(e.target.value))} maxLength="12" />
            </div>
          </Field>
        </div>
      </div>

      {/* ─ Sección 2: Detalles del trabajo ─ */}
      <div className="ps-form-section-title">
        <span className="ps-form-section-num">2</span> Detalles del trabajo
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Descripcion del trabajo" required error={fieldErrors.description}>
            <textarea className="ps-form-input textarea" placeholder="Describe el trabajo solicitado por el cliente..."
              value={form.description} onChange={e => set("description", e.target.value)} />
          </Field>
        </div>

        {/* Multi-material */}
        <div className="col-full">
          <Field label="Materiales" required hint="Puedes seleccionar más de un material" error={fieldErrors.materials}>
            <MultiMaterialSelector selected={form.materials} onChange={v => set("materials", v)} options={materialOptions} />
          </Field>
        </div>

        {/* Tipo de terminación */}
        <div className="col-full">
          <Field label="Tipo de terminación" optional hint="Describe el tipo de terminación del trabajo">
            <input className="ps-form-input" placeholder="Ej: Brillante, Mate, Con marco..."
              value={form.termination_type} onChange={e => set("termination_type", e.target.value)} />
          </Field>
        </div>

        {/* Tipo de orden */}
        <div className="col-full">
          <Field label="Tipo de orden" required error={fieldErrors.order_type}>
            <div className="ps-order-type-group">
              {[
                { val: "orden normal", label: "Orden Normal", desc: "Flujo estándar de produccion" },
                { val: "orden 911", label: "Orden 911", desc: "Urgente — prioridad maxima", urgent: true },
              ].map(opt => (
                <label key={opt.val} className={`ps-order-type-card ${form.order_type === opt.val ? "selected" : ""} ${opt.urgent ? "urgent" : ""}`}>
                  <input type="radio" name="order_type" value={opt.val}
                    checked={form.order_type === opt.val}
                    onChange={() => set("order_type", opt.val)}
                    style={{ display: "none" }} />
                  <div className="ps-order-type-label">{opt.label}</div>
                  <div className="ps-order-type-desc">{opt.desc}</div>
                </label>
              ))}
            </div>
          </Field>
        </div>

        {/* Tipo de diseño */}
        <div className="col-full">
          <Field label="Tipo de diseno" required error={fieldErrors.design_type}>
            <div className="ps-order-type-group">
              {[
                { val: "INTERNAL_DESING", label: "Diseño Interno", desc: "El diseno lo realiza NeonPrint" },
                { val: "EXTERNAL_DESING", label: "Diseño Externo", desc: "El cliente entrega su diseno" },
              ].map(opt => (
                <label key={opt.val} className={`ps-order-type-card ${form.design_type === opt.val ? "selected" : ""}`}>
                  <input type="radio" name="design_type" value={opt.val}
                    checked={form.design_type === opt.val}
                    onChange={() => set("design_type", opt.val)}
                    style={{ display: "none" }} />
                  <div className="ps-order-type-label">{opt.label}</div>
                  <div className="ps-order-type-desc">{opt.desc}</div>
                </label>
              ))}
            </div>
          </Field>
        </div>

        {/* Campos para DISEÑO EXTERNO */}
        {form.design_type === "EXTERNAL_DESING" && (
          <>
            <div className="col-full">
              <Field label="Archivos de diseño" required error={fieldErrors.design_files} hint="Sube los archivos de diseño del cliente (obligatorio)">
                <div className="ps-upload-zone" onClick={() => fileInputRef.current?.click()}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={e => {
                      const files = Array.from(e.target.files);
                      set("design_files", [...form.design_files, ...files]);
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                  <div className="ps-upload-icon"><Icons.Upload /></div>
                  <div className="ps-upload-btn-wrapper">
                    <span className="ps-upload-btn-text">Subir archivos</span>
                  </div>
                  <span className="ps-upload-hint">Archivos del diseño (PDF, AI, PNG, JPG...)</span>
                </div>
                {form.design_files.length > 0 && (
                  <div className="ps-files-list">
                    {form.design_files.map((file, i) => (
                      <div key={i} className="ps-file-item">
                        <Icons.File />
                        <span className="ps-file-name">{file.name}</span>
                        <button className="ps-file-remove" onClick={(e) => { e.stopPropagation(); set("design_files", form.design_files.filter((_, idx) => idx !== i)); }}>
                          <Icons.X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="col-full">
              <Field label="Imagen de la orden de trabajo" required error={fieldErrors.design_preview} hint="Vista previa del diseño (obligatorio)">
                {!form.design_preview ? (
                  <div className="ps-upload-zone" onClick={() => previewInputRef.current?.click()}>
                    <input
                      ref={previewInputRef}
                      type="file"
                      accept="image/*"
                      onChange={e => {
                        if (e.target.files && e.target.files[0]) {
                          set("design_preview", e.target.files[0]);
                        }
                      }}
                      style={{ display: "none" }}
                    />
                    <div className="ps-upload-icon"><Icons.Image /></div>
                    <div className="ps-upload-btn-wrapper">
                      <span className="ps-upload-btn-text">Subir imagen de preview</span>
                    </div>
                    <span className="ps-upload-hint">Imagen de la orden de trabajo (PNG, JPG...)</span>
                  </div>
                ) : (
                  <div className="ps-preview-showcase">
                    <div className="ps-preview-card">
                      <img src={URL.createObjectURL(form.design_preview)} alt="Preview" className="ps-preview-img-main" />
                      <div className="ps-preview-card-overlay">
                        <span className="ps-preview-card-label">Vista previa del diseño</span>
                        <div className="ps-preview-card-actions">
                          <button className="ps-preview-change-btn" onClick={() => previewInputRef.current?.click()}>Cambiar</button>
                          <button className="ps-preview-del-btn" onClick={() => set("design_preview", null)}><Icons.Trash /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Field>
            </div>
          </>
        )}

        {/* Fecha de entrega */}
        <div className="col-full">
          <Field label="Fecha de entrega" optional error={fieldErrors.delivery_date}>
            <div className="ps-date-row">
              <div className="ps-input-icon-wrap" style={{ flex: 1 }}>
                <span className="ps-input-icon"><Icons.Calendar /></span>
                <input
                  className="ps-form-input with-icon"
                  type="date"
                  value={form.delivery_date}
                  disabled={form.indefinido}
                  onChange={e => set("delivery_date", e.target.value)}
                  style={{ opacity: form.indefinido ? 0.4 : 1 }}
                />
              </div>
              <label className="ps-indefinido-check" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                <input 
                  type="checkbox" 
                  checked={form.indefinido} 
                  onChange={e => set("indefinido", e.target.checked)}
                  style={{ width: "16px", height: "16px", margin: 0, cursor: "pointer" }}
                />
                <span style={{ fontSize: "13px", color: "#64748b" }}>Por definir</span>
              </label>
            </div>
          </Field>
        </div>
      </div>

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={handleClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Guardando..." : "Crear Orden →"}
        </button>
      </div>
    </Modal>
  );
}

// ─── EDIT ORDER MODAL ─────────────────────────────────────────────────────────
function EditOrderModal({ open, onClose, order, onUpdated, materialOptions = [] }) {
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);

  const [form, setForm] = useState({
    client_name: "",
    client_contact: "",
    description: "",
    materials: [],
    termination_type: "",
    delivery_date: "",
  });
  const [existingFiles, setExistingFiles] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [existingPreview, setExistingPreview] = useState(null);
  const [newPreview, setNewPreview] = useState(null);
  const [removedFileUrls, setRemovedFileUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (order) {
      setForm({
        client_name: order.client_name || "",
        client_contact: order.client_contact || "",
        description: order.description || "",
        materials: order.material ? order.material.split(", ").filter(Boolean) : [],
        termination_type: order.termination_type || "",
        delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
      });

      const parseFiles = (fileUrl) => {
        if (!fileUrl) return [];
        try {
          const parsed = JSON.parse(fileUrl);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [fileUrl];
        }
      };

      setExistingFiles(parseFiles(order.order_file_url));
      setExistingPreview(order.preview_image || null);
      setNewFiles([]);
      setNewPreview(null);
      setRemovedFileUrls([]);
      setFieldErrors({});
      setError("");
    }
  }, [order]);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    // Limpiar error del campo cuando se edita
    if (fieldErrors[k]) {
      setFieldErrors(p => {
        const next = { ...p };
        delete next[k];
        return next;
      });
    }
  };

  // Función de validación que retorna objeto de errores por campo
  const validateForm = () => {
    const errors = {};
    
    if (!form.client_name.trim()) {
      errors.client_name = "El nombre del cliente es requerido.";
    }
    if (!form.description.trim()) {
      errors.description = "La descripción es requerida.";
    }
    if (form.client_contact.trim() && !isValidDominicanPhone(form.client_contact)) {
      errors.client_contact = "El teléfono debe ser un número válido de República Dominicana (809, 829 o 849).";
    }
    
    return errors;
  };

  const handleRemoveExistingFile = (url) => {
    setRemovedFileUrls(prev => [...prev, url]);
    setExistingFiles(prev => prev.filter(f => f !== url));
  };

  const handleAddNewFiles = (e) => {
    const files = Array.from(e.target.files);
    setNewFiles(prev => [...prev, ...files]);
    e.target.value = "";
  };

  const handleRemoveNewFile = (index) => {
    setNewFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExistingPreview = () => {
    if (existingPreview) {
      setRemovedFileUrls(prev => [...prev, existingPreview]);
    }
    setExistingPreview(null);
  };

  const handleAddNewPreview = (e) => {
    if (e.target.files && e.target.files[0]) {
      setNewPreview(e.target.files[0]);
      e.target.value = "";
    }
  };

  const handleRemoveNewPreview = () => {
    setNewPreview(null);
  };

  const handleSubmit = async () => {
    const errors = validateForm();
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Por favor, corrige los errores en el formulario.");
      requestAnimationFrame(() => {
        const el = document.querySelector(".ps-field-error");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setLoading(true);
    setError("");
    setFieldErrors({});

    // 1. Upload files first (no disparan el trigger de orders)
    let fileUrls = [...existingFiles];
    try {
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const fileName = buildStorageSafeFileName(file, `${i}-`);
        const publicUrl = await uploadOrderAsset({
          bucket: "order-docs",
          path: `orders/${order.id}/files/${fileName}`,
          file,
        });

        if (publicUrl) fileUrls.push(publicUrl);
      }
    } catch (uploadError) {
      setLoading(false);
      setError(uploadError?.message || "Error al subir los archivos de diseño.");
      return;
    }

    let previewUrl = existingPreview;
    if (newPreview) {
      try {
        const fileName = buildStorageSafeFileName(newPreview, "preview-");
        previewUrl = await uploadOrderAsset({
          bucket: "order-previews",
          path: `orders/${order.id}/preview/${fileName}`,
          file: newPreview,
        });
      } catch (uploadError) {
        setLoading(false);
        setError(uploadError?.message || "Error al subir el preview de la orden.");
        return;
      }
    } else if (!existingPreview) {
      previewUrl = null;
    }

    // 2. ÚNICO update a orders → 1 sola ejecución del trigger
    const { error: err } = await supabase
      .from("orders")
      .update({
        client_name: form.client_name.trim(),
        client_contact: form.client_contact.trim() || null,
        description: form.description.trim(),
        material: form.materials.join(", "),
        termination_type: form.termination_type.trim() || null,
        delivery_date: form.delivery_date || null,
        order_file_url: JSON.stringify(fileUrls),
        preview_image: previewUrl,
      })
      .eq("id", order.id);

    if (err) {
      setLoading(false);
      setError("Error al actualizar: " + err.message);
      return;
    }

    await Promise.all([
      ...removedFileUrls.flatMap((url) => [
        removeOrderAssetByPublicUrl({ bucket: "order-docs", url }),
        removeOrderAssetByPublicUrl({ bucket: "order-previews", url }),
      ]),
      !previewUrl && existingPreview
        ? removeOrderAssetByPublicUrl({ bucket: "order-previews", url: existingPreview })
        : Promise.resolve({ removed: false, error: null }),
    ]);

    setLoading(false);
    onUpdated?.();
    onClose();
  };

  const parseFileName = (url) => {
    if (!url) return "Archivo";
    const parts = url.split("/");
    const fileName = parts[parts.length - 1];
    const nameParts = fileName.split("-");
    nameParts.shift();
    nameParts.shift();
    nameParts.shift();
    return nameParts.join("-") || fileName;
  };

  return (
    <Modal open={open} onClose={onClose} title={`Editar Orden #${order?.id?.slice(0, 8).toUpperCase()}`}>
      {error && <div className="ps-form-error">{error}</div>}

      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Nombre del cliente" required error={fieldErrors.client_name}>
            <input className="ps-form-input" value={form.client_name} onChange={e => set("client_name", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Contacto" optional hint="Telefono opcional. Si lo completas, debe ser un numero de Republica Dominicana." error={fieldErrors.client_contact}>
            <input className="ps-form-input" placeholder={PHONE_PLACEHOLDER} value={form.client_contact} onChange={e => set("client_contact", formatDominicanPhone(e.target.value))} maxLength="12" />
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title" style={{ marginTop: 20 }}>
        <span className="ps-form-section-num">2</span> Detalles de la orden
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Descripción" required error={fieldErrors.description}>
            <textarea className="ps-form-input textarea" value={form.description} onChange={e => set("description", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Material" optional>
            <MultiMaterialSelector selected={form.materials} onChange={v => set("materials", v)} options={materialOptions} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Tipo de terminación" optional>
            <input className="ps-form-input" value={form.termination_type} onChange={e => set("termination_type", e.target.value)} placeholder="Ej: Brillante, Mate, Con marco..." />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Fecha de entrega" optional>
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icons.Calendar /></span>
              <input className="ps-form-input with-icon" type="date" value={form.delivery_date} onChange={e => set("delivery_date", e.target.value)} />
            </div>
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title" style={{ marginTop: 20 }}>
        <span className="ps-form-section-num">3</span> Archivos y Preview
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Archivos adjuntos" hint="Archivos de diseño existentes y nuevos">
            {existingFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {existingFiles.map((url, i) => (
                  <div key={i} className="ps-file-item">
                    <Icons.File />
                    <span className="ps-file-name">{parseFileName(url)}</span>
                    <button className="ps-file-remove" onClick={() => handleRemoveExistingFile(url)}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {newFiles.length > 0 && (
              <div className="ps-files-list" style={{ marginBottom: 12 }}>
                {newFiles.map((file, i) => (
                  <div key={i} className="ps-file-item" style={{ borderColor: "var(--cyan)", background: "rgba(6, 182, 212, 0.04)" }}>
                    <Icons.File />
                    <span className="ps-file-name">{file.name}</span>
                    <button className="ps-file-remove" onClick={() => handleRemoveNewFile(i)}>
                      <Icons.X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="ps-upload-zone" onClick={() => fileInputRef.current?.click()}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleAddNewFiles}
                style={{ display: "none" }}
              />
              <div className="ps-upload-icon"><Icons.Upload /></div>
              <div className="ps-upload-btn-wrapper">
                <span className="ps-upload-btn-text">Agregar archivos</span>
              </div>
              <span className="ps-upload-hint">PDF, AI, PNG, JPG...</span>
            </div>
          </Field>
        </div>

        <div className="col-full">
          <Field label="Imagen de preview" hint="Vista previa del diseño">
            {(existingPreview || newPreview) ? (
              <div className="ps-preview-showcase">
                <div className="ps-preview-card">
                  <img
                    src={newPreview ? URL.createObjectURL(newPreview) : existingPreview}
                    alt="Preview"
                    className="ps-preview-img-main"
                  />
                  <div className="ps-preview-card-overlay">
                    <span className="ps-preview-card-label">
                      {newPreview ? "Nueva preview" : "Preview actual"}
                    </span>
                    <div className="ps-preview-card-actions">
                      <button className="ps-preview-change-btn" onClick={() => previewInputRef.current?.click()}>
                        {newPreview ? "Cancelar" : "Cambiar"}
                      </button>
                      <button className="ps-preview-del-btn" onClick={newPreview ? handleRemoveNewPreview : handleRemoveExistingPreview}>
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="ps-upload-zone" onClick={() => previewInputRef.current?.click()}>
                <input
                  ref={previewInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAddNewPreview}
                  style={{ display: "none" }}
                />
                <div className="ps-upload-icon"><Icons.Image /></div>
                <div className="ps-upload-btn-wrapper">
                  <span className="ps-upload-btn-text">Subir imagen de preview</span>
                </div>
                <span className="ps-upload-hint">Imagen de la orden de trabajo (PNG, JPG...)</span>
              </div>
            )}
          </Field>
        </div>
      </div>

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={onClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Guardando..." : "Guardar Cambios →"}
        </button>
      </div>
    </Modal>
  );
}

// ─── ORDER DETAIL MODAL ───────────────────────────────────────────────────────
function OrderDetailModal({ open, onClose, order, user, onSendToDesigner, onSendToQuotation }) {
  const hasOrder = Boolean(order);
  const created = hasOrder ? new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "";
  const statusConfig = hasOrder ? getOrderStatusConfig(order.status) : getOrderStatusConfig(ORDER_STATUS.PENDING);
  const [designerName, setDesignerName] = useState("");
  
  useEffect(() => {
    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }

    if (order?.designer_id) {
      supabase
        .from("profiles")
        .select("name")
        .eq("id", order.designer_id)
        .single()
        .then(({ data }) => {
          if (data?.name) {
            setDesignerName(data.name);
          } else {
            setDesignerName("Diseñador");
          }
        });
    }
  }, [order?.designer_id]);

  if (!hasOrder) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} wide>
      {/* Flow Tracker - Diferente según tipo de orden */}
      {order.order_design_type === "EXTERNAL_DESING" ? (
        <FlowTrackerExternal status={order.status} />
      ) : (
        <FlowTracker status={order.status} />
      )}

      {/* Grid Principal */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 22 }}>
        
        {/* COLUMNA IZQUIERDA — Cliente & Trabajo */}
        <div>
          {/* Card: Información del Cliente */}
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
                    <Icons.Phone />{order.client_contact}
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

          {/* Card: Especificaciones del Trabajo */}
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

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Material", value: order.material, icon: <Icons.Paintbrush /> },
                { label: "Tipo de terminación", value: order.termination_type || "---", icon: <Icons.Check /> },
                { label: "Tipo de orden", value: order.order_type, icon: <Icons.Package /> },
                { label: "Diseño", 
                  value: order.order_design_type === "INTERNAL_DESING" ? "Diseño interno" :
                         order.order_design_type === "EXTERNAL_DESING" ? "Diseño externo" : "---", 
                  icon: <Icons.Edit /> },
                { label: "Fecha entrega", value: order.delivery_date || "Indefinida", icon: <Icons.Calendar /> },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr auto",
                  gap: 10, alignItems: "center", paddingBottom: 11,
                  borderBottom: i < 4 ? "1px solid var(--border)" : "none"
                }}>
                  <div style={{ color: "var(--text-muted)" }}>{item.icon}</div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 3px 0", fontWeight: 600 }}>
                      {item.label}
                    </p>
                    <p style={{ fontSize: 13, color: "var(--text)", margin: 0, fontWeight: 600 }}>
                      {item.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA — Estado & Pago */}
        <div>
          {/* Card: Estado Actual */}
          <div style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 20,
            marginBottom: 18,
            position: "relative",
            overflow: "hidden"
          }}>
            <div style={{
              position: "absolute", top: 0, right: -30,
              width: 100, height: 100,
              background: statusConfig?.bg || "rgba(0,0,0,0.02)",
              borderRadius: "50%",
              pointerEvents: "none"
            }} />

            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 14
            }}>📊 Estado & Pago</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 7px 0", fontWeight: 600 }}>
                  ESTADO ACTUAL
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <StatusBadge status={order.status} />
                  {isReturnedOrder(order) && <ReturnedBadge />}
                </div>
              </div>

              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 7px 0", fontWeight: 600 }}>
                  ESTADO DE PAGO
                </p>
                <StatusBadge status={order.payment_status} type="payment" />
              </div>

              <div style={{
                background: "var(--primary-light)",
                border: `1.5px solid ${statusConfig?.color || "var(--primary)"}20`,
                borderRadius: "var(--radius-md)",
                padding: 14,
              }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 5px 0", fontWeight: 600 }}>
                  PRECIO
                </p>
                <p style={{
                  fontSize: 22, fontWeight: 800, color: "var(--primary)", margin: 0
                }}>
                  {order.price ? "RD$" + order.price.toLocaleString("es-DO") : "Sin cotizar"}
                </p>
              </div>

              {isReturnedOrder(order) && (
                <div style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: "var(--radius-md)",
                  padding: 14,
                }}>
                  <p style={{ fontSize: 11, color: "#991B1B", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Orden devuelta
                  </p>
                  <p style={{ fontSize: 13, color: "#7F1D1D", margin: 0, lineHeight: 1.55 }}>
                    {order.return_reason}
                  </p>
                </div>
              )}
            </div>

            {/* Botón Enviar a Diseño / Cotización */}
            {!isOrderStatusIn(order.status, ACTIVE_WORKFLOW_STATUSES_FOR_SELLER) && (
              <div style={{ marginTop: 16 }}>
                {order.order_design_type === "EXTERNAL_DESING" ? (
                  <button
                    onClick={() => onSendToQuotation(order)}
                    style={{
                      width: "100%",
                      padding: "14px 20px",
                      background: "linear-gradient(135deg, #0369A1 0%, #0284C7 100%)",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'Poppins', sans-serif",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
                      transition: "all 0.2s"
                    }}
                  >
                    <Icons.Edit style={{ width: 18, height: 18 }} />
                    Enviar a Cotización
                  </button>
                ) : (
                  <button
                    onClick={() => onSendToDesigner(order)}
                    style={{
                      width: "100%",
                      padding: "14px 20px",
                      background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      fontFamily: "'Poppins', sans-serif",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)",
                      transition: "all 0.2s"
                    }}
                  >
                    <Icons.Edit style={{ width: 18, height: 18 }} />
                    Enviar a Diseño
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Card: Información Sistema */}
          <div style={{
            background: "var(--surface-alt)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 12
            }}>Información del Sistema</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "ID Orden", value: order.id?.slice(0, 8), icon: <Icons.Key /> },
                { label: "Creada", value: created, icon: <Icons.Clock /> },
                { label: "Responsable", value: user?.displayName || "---", icon: <Icons.User /> },
                ...(order.designer_id ? [{ label: "Diseñador", value: designerName || "Asignado", icon: <Icons.Edit style={{ color: "#8B5CF6" }} /> }] : []),
              ].map((item, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "20px 1fr auto",
                  gap: 8, alignItems: "center"
                }}>
                  <span style={{ color: "var(--text-muted)" }}>{item.icon}</span>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    {item.label}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, margin: 0, textAlign: "right" }}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Card: Link de Seguimiento */}
          <div style={{
            background: "var(--surface)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 12
            }}>🔗 Link de Seguimiento</p>

            <TrackingLinkField orderId={order.id} />
          </div>
        </div>
      </div>

      {/* Archivos Adjuntos — Full Width */}
      {(order.preview_image || order.order_file_url) && (
        <div style={{
          marginTop: 24,
          background: "var(--surface)",
          border: "1.5px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 20
        }}>
          <p style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.07em",
            marginBottom: 16
          }}>Archivos Adjuntos</p>

          <div style={{ display: "grid", gridTemplateColumns: order.preview_image && order.order_file_url ? "1fr 1fr" : "1fr", gap: 16 }}>
            {order.preview_image && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icons.Eye /> Orden de Trabajo
                </p>
                <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  <img 
                    src={order.preview_image} 
                    alt="preview" 
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
              </div>
            )}

            {order.order_file_url && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icons.Brush /> Diseño del cliente
                </p>
                {(() => {
                  const fileUrls = parseFileUrls(order.order_file_url);
                  if (fileUrls.length === 1) {
                    const url = fileUrls[0];
                    return url.toLowerCase().endsWith(".pdf") ? (
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
                          transition: "all 0.2s"
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
                        <Icons.Receipt style={{ fontSize: 24 }} />
                        Ver archivo PDF
                      </a>
                    ) : (
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
                    );
                  } else {
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {fileUrls.map((url, index) => (
                          <a
                            key={index}
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
                              transition: "all 0.2s"
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
                            <Icons.FileText />
                            Ver archivo {index + 1}
                          </a>
                        ))}
                      </div>
                    );
                  }
                })()}
              </div>
            )}
          </div>
          </div>
        )}
    </Modal>
  );
}

// ─── ENVIAR A DISEÑO MODAL ───────────────────────────────────────────
function ReturnedBadge({ compact = false }) {
  return (
    <span className={`ps-returned-badge${compact ? " compact" : ""}`} title="Orden devuelta desde cotización">
      Devuelta
    </span>
  );
}

function CancelOrderModal({ open, onClose, onConfirm, order, loading }) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);
  
  // Validación: No permitir cancelar órdenes pagadas
  const isPaid = order?.payment_status === "pagado";

  return (
    <Modal open={open} onClose={onClose} title="Cancelar Orden">
      <div style={{ minWidth: 350, paddingTop: 8 }}>
        {isPaid ? (
          <>
            <p style={{ fontSize: 14, color: "#991B1B", marginBottom: 16, lineHeight: 1.5, fontWeight: 500 }}>
              ⚠️ No se puede cancelar esta orden
            </p>
            <p style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 20, lineHeight: 1.5 }}>
              Esta orden ya ha sido pagada. No se permite cancelar órdenes con pago confirmado. Si necesitas anular esta orden, contacta con el administrador.
            </p>
            {order && (
              <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                Orden #{order.id?.slice(0, 8)} - {order.client_name}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button 
                className="ps-btn-cancel" 
                onClick={onClose}
              >
                Entendido
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "#4A5E80", marginBottom: 16, lineHeight: 1.5 }}>
              ¿Estás seguro de que deseas cancelar esta orden?{order && (
                <span style={{ display: "block", marginTop: 8, fontWeight: 500, color: "#0f1e40" }}>
                  Orden #{order.id?.slice(0, 8)} - {order.client_name}
                </span>
              )}
            </p>
            <p style={{ fontSize: 13, color: "#8899B5", marginBottom: 20, lineHeight: 1.5 }}>
              El estado de la orden cambiará a "Cancelada" y esta acción no podra ser revertida fácilmente.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f1e40", marginBottom: 8 }}>
                Motivo de cancelacion
              </label>
              <textarea
                className="ps-form-input textarea"
                placeholder="Describe por que se cancela esta orden..."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={loading}
                rows={4}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button 
                className="ps-btn-cancel" 
                onClick={onClose}
                disabled={loading}
              >
                Mantener orden
              </button>
              <button 
                className="ps-btn-submit" 
                onClick={() => onConfirm(reason)}
                disabled={loading || !reason.trim()}
                style={{ background: "#EF4444", border: "1px solid #DC2626" }}
              >
                {loading ? "Cancelando..." : "Si, cancelar orden"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── ARCHIVAR ORDEN VENTANA DE CONFIRMACION ───────────────────────────────────────────
function ArchivedOrderModal({ open, onClose, onConfirm, order, loading }) {
  return (
    <Modal open={open} onClose={onClose} title="Archivar Orden">
      <div style={{ minWidth: 380, paddingTop: 8 }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          marginBottom: 20 
        }}>
          <div style={{
            width: 64, height: 64,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(245, 158, 11, 0.25)"
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </div>
        </div>
        
        <p style={{ fontSize: 15, color: "#374151", marginBottom: 12, lineHeight: 1.5, textAlign: "center", fontWeight: 500 }}>
          ¿Estás seguro de que deseas archivar esta orden?
        </p>
        
        {order && (
          <div style={{ 
            background: "#F9FAFB", 
            border: "1px solid #E5E7EB", 
            borderRadius: 8, 
            padding: 12, 
            marginBottom: 16,
            textAlign: "center"
          }}>
            <span style={{ fontSize: 13, color: "#6B7280" }}>Orden </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f1e40" }}>#{order.id?.slice(0, 8).toUpperCase()}</span>
            <span style={{ fontSize: 13, color: "#6B7280" }}> - </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#0f1e40" }}>{order.client_name}</span>
          </div>
        )}
        
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 24, lineHeight: 1.5, textAlign: "center" }}>
          La orden se ocultará de la vista principal pero permanecerá archivada en el sistema.
        </p>
        
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button 
            className="ps-btn-cancel" 
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button 
            className="ps-btn-submit" 
            onClick={onConfirm}
            disabled={loading}
            style={{ 
              background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", 
              border: "1px solid #B45309",
              boxShadow: "0 2px 8px rgba(245, 158, 11, 0.3)"
            }}
          >
            {loading ? "Archivando..." : "Si, archivar orden"}
          </button>
        </div>
      </div>
    </Modal>
  );
}



// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function PageSeller() {
  const navigate = useNavigate();
  const RELEVANT_COLUMNS = "id,client_id,client_name,description,material,size,quantity,price,status,payment_status,created_at,created_by,designer_id,production_id,delivery_id,order_type,seller_id,quote_id,preview_image,client_contact,delivery_date,order_file_url,order_design_type,order_code,is_archived,is_archived_designer,is_archived_quote,is_archived_admin,termination_type,invoice_payment,return_reason,returned_to_designer_at,cancellation_reason,tracking_token";
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;
  const [viewMode, setViewMode] = useState("table");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cancelingOrder, setCancelingOrder] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [archivedingOrder , setArchivedingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [sendingToDesigner, setSendingToDesigner] = useState(null);
  const [sendingToQuotation, setSendingToQuotation] = useState(null);
  const [sendingLoading, setSendingLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const notif = useNotifications(user?.id);
  const showToast = (message, type = "success") => {
    setToastMsg({ message, type });
    setTimeout(() => setToastMsg(null), 1500);
  };

  const fetchOrders = async (sellerId) => {
    if (!sellerId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(RELEVANT_COLUMNS)
      .eq("seller_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && Array.isArray(data)) {
      setOrders(data);
    } else {
      setOrders([]);
    }
    setLoading(false);
  };




  // Carga inicial + listener de sesión
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const displayName = 
          data.user.user_metadata?.display_name ||
          data.user.user_metadata?.full_name || 
          data.user.user_metadata?.name || 
          data.user.user_metadata?.first_name || 
          data.user.email?.split("@")[0];
        
        setUser({ ...data.user, displayName });
        fetchOrders(data.user.id);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate("/");
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  // Sincronización en tiempo real + refresco al volver a la página
  useEffect(() => {
    if (!user?.id) return;

    const refreshOrders = async () => {
      const { data } = await supabase
        .from("orders")
        .select(RELEVANT_COLUMNS)
        .eq("seller_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setOrders(data);
    };

    const channel = supabase
      .channel(`orders-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        refreshOrders
      )
      .subscribe();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshOrders();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", refreshOrders);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", refreshOrders);
    };
  }, [user?.id]);

  useEffect(() => {
    supabase.from("materials").select("name").order("name").then(({ data }) => {
      setMaterialOptions(data?.map(m => m.name) || []);
    });
    setClientsLoading(true);
    loadClients(supabase)
      .then(setClients)
      .finally(() => setClientsLoading(false));
  }, []);

  const handleClientSearch = useCallback(async (query) => {
    const results = await searchClients(supabase, query);
    setClients((prev) => {
      const byId = new Map(prev.map((client) => [client.id, client]));
      results.forEach((client) => byId.set(client.id, client));
      return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    return results;
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  // ── Funcion para cancelar orden ───────────────────────────────────────────────────────
  const handleCancelOrder = (order) => {
    // Validación: No permitir cancelar órdenes pagadas
    if (order?.payment_status === "pagado") {
      showToast("No se puede cancelar una orden que ya ha sido pagada", "error");
      return;
    }
    setCancelingOrder(order);
  };

  const handleConfirmCancel = async (reason) => {
    if (!cancelingOrder) return;
    
    // Validación adicional: Verificar nuevamente que no esté pagada
    if (cancelingOrder?.payment_status === "pagado") {
      showToast("No se puede cancelar una orden que ya ha sido pagada", "error");
      setCancelingOrder(null);
      return;
    }
    
    if (!String(reason || "").trim()) {
      showToast("Debes indicar el motivo de cancelacion", "error");
      return;
    }
    
    setCancelLoading(true);
    const { error } = await supabase
      .from("orders")
      .update({ status: ORDER_STATUS.CANCELLED, cancellation_reason: String(reason).trim() })
      .eq("id", cancelingOrder.id);
    setCancelLoading(false);
    
    if (error) {
      showToast("Error al cancelar la orden", "error");
      return;
    }
    
    setCancelingOrder(null);
    fetchOrders(user?.id);
  };

  // ── Ver detalles de orden ─────────────────────────────────────────────────
  const handleViewOrder = async (order) => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .single();
    
    if (data) {
      setSelectedOrder(data);
    } else {
      setSelectedOrder(order);
    }
  };

  // ── Enviar a Diseño ───────────────────────────────────────────────────────
  const handleSendToDesigner = (order) => {
    setSendingToDesigner(order);
  };

  // ── Enviar a Cotización (Diseño Externo) ─────────────────────────────────
  const handleSendToQuotation = (order) => {
    setSelectedOrder(null);
    setSendingToQuotation(order);
  };

  const handleConfirmSendToQuotation = async (quoteUserId) => {
    if (!sendingToQuotation) return;

    setSendingLoading(true);

    const assignmentPayloads = [
      { status: ORDER_STATUS.IN_QUOTE, quote_id: quoteUserId, return_reason: null, returned_to_designer_at: null },
    ];

    let updateError = null;

    for (const payload of assignmentPayloads) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", sendingToQuotation.id)
        .select("id")
        .single();

      if (!error) {
        updateError = null;
        break;
      }

      updateError = error;
    }

    setSendingLoading(false);

    if (updateError) {
      showToast("Error al enviar a cotización", "error");
      return;
    }

    setSendingToQuotation(null);
    setSelectedOrder(null);
    await fetchOrders(user?.id);

  };

  const handleConfirmSendToDesigner = async (designerId) => {
    if (!sendingToDesigner) return;

    setSendingLoading(true);

    try {
      const { error } = await supabase
        .from("orders")
        .update({ 
          status: ORDER_STATUS.IN_DESIGN,
          designer_id: designerId,
          return_reason: null,
          returned_to_designer_at: null
        })
        .eq("id", sendingToDesigner.id);

      if (error) {
        console.error("Error asignando diseñador:", error);
        showToast(`Error: ${error.message}`, "error");
        setSendingLoading(false);
        return;
      }

      setSendingToDesigner(null);
      await fetchOrders(user?.id);

      const { data: updated } = await supabase
        .from("orders")
        .select("*")
        .eq("id", sendingToDesigner.id)
        .single();
      
      if (updated) {
        setSelectedOrder(updated);
      }
    } catch (err) {
      console.error("Error inesperado:", err);
      showToast(`Error inesperado: ${err.message}`, "error");
    }

    setSendingLoading(false);
  };


  // ── Funcion para archivar orden ───────────────────────────────────────────────────────
  const handleArchiveOrder = (order) => {
    setArchivedingOrder(order);
  }
 
  // Funcion por si el usuario confirma el archivado
  const handleConfirmArchiveOrder = async () => {
    if (!archivedingOrder) return;

    setArchiveLoading(true);
    const { error } = await supabase.from("orders").update({ is_archived: true }).eq("id", archivedingOrder.id);
    setArchiveLoading(false);

    if (error) {
      showToast("Error al archivar la orden", "error");
      return;
    }

    setOrders(prev => prev.map(o =>
      o.id === archivedingOrder.id ? { ...o, is_archived: true } : o
    ));
    setArchivedingOrder(null);
  };

  // ── Metrics Values ─────────────────────────────────────────────────────────────
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today).length;
  const inQuote = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.PENDING)).length;
  const inDesign = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_DESIGN)).length;
  const inCotizacion = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_QUOTE)).length;
  const inProd = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_PRODUCTION)).length;
  const inTerminacion = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_TERMINATION)).length;
  const completed = orders.filter(o => isOrderStatus(o.status, ORDER_STATUS.IN_COMPLETED)).length;
  const returnedCount = orders.filter(o => isReturnedOrder(o)).length;

  // Funcionalidad para filtrar las ordenes
  const filtered = useMemo(() => orders.filter(o => {
    const q = search.toLowerCase();
    const orderDate = new Date(o.created_at);
    const now = new Date();
    
    let dateMatch = true;
    if (filterDate !== "all") {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const days3 = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
      const days7 = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const min30Ago = new Date(now.getTime() - 30 * 60 * 1000);
      const min10Ago = new Date(now.getTime() - 10 * 60 * 1000);
      
      switch (filterDate) {
        case "today":
          dateMatch = orderDate >= today;
          break;
        case "yesterday":
          dateMatch = orderDate >= yesterday && orderDate < today;
          break;
        case "3days":
          dateMatch = orderDate >= days3;
          break;
        case "7days":
          dateMatch = orderDate >= days7;
          break;
        case "thismonth":
          dateMatch = orderDate >= monthStart;
          break;
        case "thisyear":
          dateMatch = orderDate >= yearStart;
          break;
        case "1hour":
          dateMatch = orderDate >= hourAgo;
          break;
        case "30min":
          dateMatch = orderDate >= min30Ago;
          break;
        case "10min":
          dateMatch = orderDate >= min10Ago;
          break;
        default:
          dateMatch = true;
      }
    }
    
    const isDateFilterActive = filterDate !== "all";
    
    return (
      (!q || o.client_name?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q)) &&
      (isDateFilterActive ? true :
        (filterArchive === "active" ? !o.is_archived : o.is_archived === true) &&
        (filterStatus === "all" || isOrderStatus(o.status, filterStatus))) &&
      orderMatchesClientFilter(o, filterClient) &&
      (filterPayment === "all" || o.payment_status === filterPayment) &&
      dateMatch
    );
  }), [orders, search, filterDate, filterStatus, filterPayment, filterClient, filterArchive]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filtered.length]);

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Ordenes", icon: <Icons.Orders />, badge: orders.filter(o => !o.is_archived).length },
  ];

  // Valores para las cartas metricas
  const metrics = [
    { icon: <Icons.Orders />, label: "Ordenes hoy", value: todayOrders, sub: "Creadas por ti", accentIdx: 0, trend: 12 },
    { icon: <Icons.Package />, label: "Pendientes", value: inQuote, sub: "Ordenes Pendientes", accentIdx: 1 },
    { icon: <Icons.Edit />, label: "En diseño", value: inDesign, sub: "En proceso de diseño", accentIdx: 2 },
    { icon: <Icons.Package />, label: "En cotización", value: inCotizacion, sub: "Esperando aprobación", accentIdx: 1 },
    { icon: <Icons.Package />, label: "En producción", value: inProd, sub: "Siendo impresas", accentIdx: 3 },
    { icon: <Icons.Package />, label: "Terminación", value: inTerminacion, sub: "En proceso final", accentIdx: 2 },
    { icon: <Icons.Truck />, label: "Completadas", value: completed, sub: "Entregadas al cliente", accentIdx: 4, trend: 8 },
    { icon: <Icons.X />, label: "Devueltas", value: returnedCount, sub: "Pendientes de corrección", accentIdx: 3 },
  ];

  const visibleSellerNotifications = useMemo(
    () => notif.notifications.filter(isSellerVisibleNotification),
    [notif.notifications]
  );

  const visibleSellerToasts = useMemo(
    () => notif.toasts.filter(isSellerVisibleNotification),
    [notif.toasts]
  );

  const visibleSellerUnreadCount = useMemo(
    () => visibleSellerNotifications.filter((notification) => !notification.is_read && !notification.is_archived).length,
    [visibleSellerNotifications]
  );

  return (
    <div className="ps-root">

      {/* ── SIDEBAR ── */}
      <Sidebar 
        isOpen={sidebarOpen}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        role="Vendedor"
        userName={user?.email?.split('@')[0] || "Vendedor"}
        menuItems={nav.map(item => ({ ...item, icon: item.icon }))}
        onLogout={handleLogout}
        onCreateNew={() => setShowCreate(true)}
        showCreateButton={true}
      />

      {/* ── MAIN ── */}
      <div className="ps-main-wrap">
        <header className="ps-topbar">
          <div className="ps-topbar-left">
            <button className="ps-icon-btn" onClick={() => setSidebarOpen(p => !p)}>
              {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
            </button>
            <div>
              <div className="ps-page-title">{activeTab === "dashboard" ? "Dashboard" : "Gestion de Ordenes"}</div>
              <div className="ps-page-date">{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          </div>
          <div className="ps-topbar-right">
            <button className="ps-icon-btn" onClick={() => fetchOrders(user?.id)}><Icons.Refresh /></button>
            <NotificationCenter
              notifications={visibleSellerNotifications}
              unreadCount={visibleSellerUnreadCount}
              toasts={visibleSellerToasts}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDismissToast={notif.dismissToast}
            />
            <div className="ps-topbar-divider" />
            <button className="ps-topbar-new-btn" onClick={() => setShowCreate(true)}>
              <div className="ps-topbar-new-inner"><Icons.Plus /> Nueva Orden</div>
              <div className="ps-topbar-new-stripe" />
            </button>
          </div>
        </header>

        <main className="ps-main">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <>
              <div className="ps-greeting">
                <h2>Buen dia, <span>{user?.displayName || "Vendedor"}</span> 👋</h2>
                <p>Aqui tienes el resumen de tu actividad de hoy.</p>
              </div>
              <div className="ps-metrics">
                {metrics.map((m, i) => <MetricCard key={i} {...m} />)}
              </div>
              <div className="ps-panel">
                <div className="ps-panel-stripe" />
                <div className="ps-panel-header">
                  <div>
                    <div className="ps-panel-title">Ordenes recientes</div>
                    <div className="ps-panel-sub">Las ultimas 5 ordenes ingresadas al sistema</div>
                  </div>
                  <button className="ps-link-btn" onClick={() => setActiveTab("orders")}>
                    Ver todas <Icons.ArrowRight />
                  </button>
                </div>
                <div className="ps-table-wrap">
                  <table className="ps-table">
                    <thead><tr>{["Cliente", "Descripcion", "Material", "Estado", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="ps-table-empty">Cargando órdenes...</td>
                        </tr>
                      ) : orders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="ps-table-empty">No hay órdenes disponibles</td>
                        </tr>
                      ) : (
                        orders.slice(0, 5).map(o => (
                          <tr key={o.id} className="row-hover" onClick={() => setSelectedOrder(o)}>
                            <td className="td-pad td-name">{o.client_name}</td>
                            <td className="td-pad td-desc">{o.description}</td>
                            <td className="td-pad td-mat">{o.material}</td>
                            <td className="td-pad"><StatusBadge status={o.status} /></td>
                            <td className="td-pad">
                              <div className="table-actions">
                                <button className="table-action-btn view" onClick={e => { e.stopPropagation(); setSelectedOrder(o); }} title="Ver detalles">
                                  <Icons.Eye />
                                </button>
                                {!o.is_archived && (
                                  <button className="table-action-btn edit" onClick={e => { e.stopPropagation(); setEditingOrder(o); }} title="Editar orden">
                                    <Icons.Edit />
                                  </button>
                                )}
                                {(isOrderStatus(o.status, ORDER_STATUS.CANCELLED) || isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)) && (
                                  o.is_archived ? (
                                    <button 
                                      className="table-action-btn archive"
                                      title="Orden archivada"
                                      disabled
                                    >
                                      <Icons.Check />
                                    </button>
                                  ) : (
                                    <button 
                                      className="table-action-btn archive"
                                      onClick={e => { e.stopPropagation(); handleArchiveOrder(o); }}
                                      title="Archivar orden"
                                    >
                                      <Icons.Archived />
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ORDERS TAB */}
          {activeTab === "orders" && (
            <>
              <div className="ps-filters">
                <div className="ps-search-wrap">
                  <span className="ps-search-icon"><Icons.Search /></span>
                  <input className="ps-input with-icon" placeholder="Buscar por cliente, descripcion o ID..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 130, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="all">Todos los estados</option>
                      {STATUS_OPTIONS.map(status => {
                        const cfg = getOrderStatusConfig(status);
                        return <option key={status} value={status}>{cfg.label}</option>;
                      })}
                    </select>
                    <span className="ps-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 130, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                      <option value="all">Pago: Todos</option>
                      {Object.entries(PAYMENT_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span className="ps-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="ps-select-wrap">
                    <ClientFilterSelect
                      clients={clients}
                      value={filterClient}
                      onChange={setFilterClient}
                      className="ps-input"
                      allLabel="Todos los clientes"
                    />
                    <span className="ps-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 100, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                      <option value="active">Activas</option>
                      <option value="archived">Archivadas</option>
                    </select>
                    <span className="ps-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 140, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                      <option value="all">Fecha: Todas</option>
                      <option value="10min">Hace 10 minutos</option>
                      <option value="30min">Hace 30 minutos</option>
                      <option value="1hour">Hace 1 hora</option>
                      <option value="today">Hoy</option>
                      <option value="yesterday">Ayer</option>
                      <option value="3days">Hace 3 días</option>
                      <option value="7days">Hace 7 días</option>
                      <option value="thismonth">Este mes</option>
                      <option value="thisyear">Este año</option>
                    </select>
                    <span className="ps-select-arrow"><Icons.ChevronDown /></span>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
                    <button 
                      onClick={() => setViewMode("table")}
                      className={`ps-view-toggle ${viewMode === "table" ? "active" : ""}`}
                      title="Vista de tabla"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </button>
                    <button 
                      onClick={() => setViewMode("cards")}
                      className={`ps-view-toggle ${viewMode === "cards" ? "active" : ""}`}
                      title="Vista de tarjetas"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    </button>
                  </div>
                </div>
                <span className="ps-filters-count">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="ps-panel">
                <div className="ps-panel-stripe" />
                {viewMode === "table" ? (
                  <div className="ps-table-wrap">
                    <table className="ps-table">
                      <thead><tr>{["ID", "Cliente", "Descripcion", "Material", "Estado", "Pago", "Tipo", "Fecha", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan={9} className="ps-table-empty">Cargando órdenes...</td>
                          </tr>
                        ) : filtered.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="ps-table-empty">No hay órdenes disponibles</td>
                          </tr>
                        ) : (
                          paginated.map(o => (
                            <tr key={o.id} className="row-hover">
                              <td className="td-pad td-id">{o.id?.slice(0, 8) || "---"}</td>
                              <td className="td-pad td-name">
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <span>{o.client_name}</span>
{isReturnedOrder(o) && <ReturnedBadge compact />}
                                </div>
                              </td>
                              <td className="td-pad td-desc">{o.description}</td>
                              <td className="td-pad td-mat">{o.material}</td>
                              <td className="td-pad"><StatusBadge status={o.status} /></td>
                              <td className="td-pad"><StatusBadge status={o.payment_status} type="payment" /></td>
                              <td className="td-pad">
                                {o.order_type === "orden 911"
                                  ? <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #EF444420" }}>911</span>
                                  : <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40", border: "1px solid #0f1e4020" }}>Normal</span>
                                }
                              </td>
                              <td className="td-pad td-date">{new Date(o.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                              <td className="td-pad td-actions">
                                <div className="table-actions">
                                  <button className="table-action-btn view" onClick={() => handleViewOrder(o)} title="Ver detalles">
                                    <Icons.Eye />
                                  </button>
                                  {!o.is_archived && (
                                    <button className="table-action-btn edit" onClick={() => setEditingOrder(o)} title="Editar orden">
                                      <Icons.Edit />
                                    </button>
                                  )}
                                  {!isOrderStatus(o.status, ORDER_STATUS.CANCELLED) && !o.is_archived && o.payment_status !== "pagado" && (
                                    <button 
                                      className="table-action-btn cancel" 
                                      onClick={() => handleCancelOrder(o)} 
                                      title="Cancelar orden"
                                    >
                                      <Icons.Trash />
                                    </button>
                                  )}
                                  {(isOrderStatus(o.status, ORDER_STATUS.CANCELLED) || isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)) && (
                                    o.is_archived ? (
                                      <button 
                                        className="table-action-btn archive"
                                        title="Orden archivada"
                                        disabled
                                      >
                                        <Icons.Check />
                                      </button>
                                    ) : (
                                      <button 
                                        className="table-action-btn archive"
                                        onClick={() => handleArchiveOrder(o)}
                                        title="Archivar orden"
                                      >
                                        <Icons.Archived />
                                      </button>
                                    )
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="ps-cards-grid">
                    {loading ? (
                      <div className="ps-cards-empty">Cargando órdenes...</div>
                    ) : filtered.length === 0 ? (
                      <div className="ps-cards-empty">No hay órdenes disponibles</div>
                    ) : (
                      paginated.map(o => (
                        <div key={o.id} className="ps-order-card">
                          <div className="ps-order-card-header">
                            <span className="ps-order-card-id">#{o.id?.slice(0, 8).toUpperCase() || "---"}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <StatusBadge status={o.status} />
                              {isReturnedOrder(o) && <ReturnedBadge compact />}
                            </div>
                          </div>
                          <div className="ps-order-card-client">{o.client_name}</div>
                          <div className="ps-order-card-desc">{o.description}</div>
                          <div className="ps-order-card-meta">
                            <span className="ps-order-card-material">{o.material}</span>
                            <StatusBadge status={o.payment_status} type="payment" />
                          </div>
                          <div className="ps-order-card-footer">
                            <span className="ps-order-card-date">
                              {new Date(o.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                            <div className="ps-order-card-type">
                              {o.order_type === "orden 911" ? (
                                <span className="ps-badge" style={{ background: "#FEF2F2", color: "#991B1B" }}>911</span>
                              ) : (
                                <span className="ps-badge" style={{ background: "#E8EDF8", color: "#0f1e40" }}>Normal</span>
                              )}
                            </div>
                          </div>
                          <div className="ps-order-card-actions">
                            <button className="card-action-btn view" onClick={() => handleViewOrder(o)} title="Ver detalles">
                              <Icons.Eye />
                            </button>
                            {!o.is_archived && (
                              <button className="card-action-btn edit" onClick={() => setEditingOrder(o)} title="Editar">
                                <Icons.Edit />
                              </button>
                            )}
                            {!isOrderStatus(o.status, ORDER_STATUS.CANCELLED) && !o.is_archived && o.payment_status !== "pagado" && (
                              <button className="card-action-btn cancel" onClick={() => handleCancelOrder(o)} title="Cancelar">
                                <Icons.Trash />
                              </button>
                            )}
                            {o.payment_status === "pagado" && !o.is_archived && !isOrderStatus(o.status, ORDER_STATUS.CANCELLED) && (
                              <button className="card-action-btn cancel" disabled title="No se puede cancelar: orden pagada" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                                <Icons.Trash />
                              </button>
                            )}
                            {(isOrderStatus(o.status, ORDER_STATUS.CANCELLED) || isOrderStatus(o.status, ORDER_STATUS.IN_DELIVERED)) && !o.is_archived && (
                              <button className="card-action-btn archive" onClick={() => handleArchiveOrder(o)} title="Archivar">
                                <Icons.Archived />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
            </>
          )}
        </main>
      </div>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => fetchOrders(user?.id)} userId={user?.id} materialOptions={materialOptions} clients={clients} onClientSearch={handleClientSearch} />
      <EditOrderModal open={!!editingOrder} onClose={() => setEditingOrder(null)} order={editingOrder} onUpdated={() => fetchOrders(user?.id)} materialOptions={materialOptions} />
      <OrderDetailModal open={!!selectedOrder} onClose={() => setSelectedOrder(null)} order={selectedOrder} user={user} onSendToDesigner={handleSendToDesigner} onSendToQuotation={handleSendToQuotation} />
      <AssignModal
        open={!!sendingToDesigner}
        onClose={() => setSendingToDesigner(null)}
        order={sendingToDesigner}
        role="designer"
        onConfirm={handleConfirmSendToDesigner}
        loading={sendingLoading}
      />
      <AssignModal
        open={!!sendingToQuotation}
        onClose={() => setSendingToQuotation(null)}
        order={sendingToQuotation}
        role="quote"
        defaultUserId={isReturnedOrder(sendingToQuotation) ? (sendingToQuotation?.quote_id || "") : ""}
        onConfirm={handleConfirmSendToQuotation}
        loading={sendingLoading}
      />
      <CancelOrderModal open={!!cancelingOrder} onClose={() => setCancelingOrder(null)} order={cancelingOrder} onConfirm={handleConfirmCancel} loading={cancelLoading} />
      <ArchivedOrderModal open={!!archivedingOrder} onClose={() => setArchivedingOrder(null)} order={archivedingOrder} onConfirm={handleConfirmArchiveOrder} loading={archiveLoading} />
      
      {toastMsg && (
        <div className="ps-toast">
          <div className="ps-toast-icon">
            {toastMsg.type === "success" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <span className="ps-toast-message">{toastMsg.message}</span>
        </div>
      )}
    </div>
  );
}

function TrackingLinkField({ orderId }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("orders")
      .select("tracking_token")
      .eq("id", orderId)
      .single()
      .then(({ data }) => {
        if (data?.tracking_token) setToken(data.tracking_token);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId]);

  const trackingUrl = token ? `${window.location.origin}/track/${token}` : null;

  const handleCopy = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = trackingUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
        <div style={{ width: 14, height: 14, border: "2px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Cargando...</span>
      </div>
    );
  }

  return (
    <div>
      {trackingUrl ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            readOnly
            value={trackingUrl}
            onClick={(e) => e.target.select()}
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-alt)",
              color: "var(--text)",
              outline: "none",
              cursor: "text",
            }}
          />
          <button
            onClick={handleCopy}
            style={{
              padding: "8px 14px",
              background: copied ? "#10B981" : "var(--primary)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.2s",
              fontFamily: "'Poppins', sans-serif",
            }}
          >
            {copied ? "✓ Copiado" : "Copiar"}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, fontStyle: "italic" }}>
          El link estará disponible cuando la orden tenga un token de seguimiento.
        </p>
      )}
    </div>
  );
}
