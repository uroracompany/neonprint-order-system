// SELLER'S HOME PAGE - ORDER DASHBOARD
// IMPORT REACT  &  SUPABASE
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";

// IMPORT CSS & ASSETS
import "../css-components/page-seller.css";
import Logo from "../assets/images/logo-neonprint.jpg" //  SYSTEM LOGO

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  Plus: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>),
  Logout: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>),
  Eye: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>),
  Close: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  ChevronDown: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>),
  Bell: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>),
  TrendUp: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>),
  Package: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>),
  Truck: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>),
  Refresh: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>),
  ArrowRight: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>),
  Upload: () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>),
  Trash: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>),
  ExternalLink: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>),
  Phone: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.1 6.1l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>),
  Calendar: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>),
  Receipt: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 2 2 2-2 2 2 2-2 3 2V4a2 2 0 0 0-2-2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /></svg>),
  Brush: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 0 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1 1 6.23 1 7 0 .48-.93.49-2.01 0-3.04a3.03 3.03 0 0 0-2-2z" /></svg>),
  X: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
};

// ─── STATUS & PAYMENT CONFIG ──────────────────────────────────────────────────
const STATUS_CONFIG = {
  "Quote_Pending": { label: "Contización Pend.", value: "Quote_Pending", color: "#92620A", bg: "#FEF3C7", dot: "#F59E0B" },
  "en cotizacion": { label: "En Cotizacion", value: "en cotizacion", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "en diseno": { label: "En Diseno", value: "en diseno", color: "#5B21B6", bg: "#EDE9FE", dot: "#8B5CF6" },
  "en produccion": { label: "En Produccion", value: "en produccion", color: "#9A3412", bg: "#FFF7ED", dot: "#F97316" },
  "en entrega": { label: "En Entrega", value: "en entrega", color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  "completada": { label: "Completada", value: "completada", color: "#14532D", bg: "#DCFCE7", dot: "#22C55E" },
  "cancelada": { label: "Cancelada", value: "cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
};

const PAYMENT_CONFIG = {
  "pagado": { label: "Pagado", color: "#14532D", bg: "#DCFCE7" },
  "Pending_Payment": { label: "Pago Pendiente", value: "Pending_Payment", color: "#92620A", bg: "#FEF3C7" },
  "parcial": { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};
const FLOW_STEPS = [
  { key: "pendiente de cotizacion", label: "Cotizacion" },
  { key: "en diseno", label: "Diseno" },
  { key: "en produccion", label: "Produccion" },
  { key: "en entrega", label: "Entrega" },
  { key: "completada", label: "Completada" },
];
const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
];

// ─── CONSTANTES DE FORMULARIO ─────────────────────────────────────────────────
const MATERIALS = [
  "Vinilo", "Banner", "Lona", "Papel Fotografico", "Carton",
  "Adhesivo", "PVC", "Acrilico", "Tela", "Foam", "Otro"
];


// ─── LOGO ─────────────────────────────────────────────────────────
const NeonLogo = ({ size = 54 }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: "conic-gradient(#00d4ff 0deg 118deg, #ff1f6e 118deg 238deg, #ffe600 238deg 360deg)",
    boxShadow: "0 0 0 2.5px rgba(255,255,255,.06), 0 8px 28px rgba(0,0,0,.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <img src={Logo} className="rounded-full" alt="Logo neonPrint" />
  </div>
);

// Eliminado MOCK_ORDERS: ya no se usan datos falsos

// ─── COMPONENTES REUTILIZABLES ────────────────────────────────────────────────
function StatusBadge({ status, type = "status" }) {
  const cfg = type === "status" ? STATUS_CONFIG[status] : PAYMENT_CONFIG[status];
  if (!cfg) return <span style={{ color: "#8899B5", fontSize: 12 }}>{status || "---"}</span>;
  return (
    <span className="ps-badge" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}20` }}>
      {type === "status" && <span className="ps-badge-dot" style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
}

function MetricCard({ icon, label, value, sub, accentIdx = 0, trend }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="ps-card"
      onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
      onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
      <div className="ps-card-glow" style={{ background: acc.glow }} />
      {trend !== undefined && <span className="ps-trend-badge"><Icon.TrendUp /> +{trend}%</span>}
      <div className="ps-card-icon" style={{ background: acc.bg, color: acc.color }}>{icon}</div>
      <div className="ps-card-value">{value}</div>
      <div className="ps-card-label">{label}</div>
      {sub && <div className="ps-card-sub" style={{ color: acc.color }}>{sub}</div>}
    </div>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="ps-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`ps-modal ${wide ? "wide" : "narrow"}`}>
        <div className="ps-modal-stripe" />
        <div className="ps-modal-header">
          <span className="ps-modal-title">{title}</span>
          <button className="ps-modal-close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, optional, hint, children }) {
  return (
    <div className="ps-field">
      <label className="ps-label">
        {label}
        {required && <span className="ps-label-req">*</span>}
        {optional && <span className="ps-label-opt">(opcional)</span>}
      </label>
      {hint && <p className="ps-field-hint">{hint}</p>}
      {children}
    </div>
  );
}

function FlowTracker({ status }) {
  const idx = FLOW_STEPS.findIndex(s => s.key === status);
  return (
    <div className="ps-flow">
      {FLOW_STEPS.map((step, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${done ? "done" : active ? "active" : ""}`}>{done ? "✓" : i + 1}</div>
              <span className={`ps-flow-label ${done ? "done" : active ? "active" : ""}`}>{step.label}</span>
            </div>
            {i < FLOW_STEPS.length - 1 && <div className={`ps-flow-line ${done ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── MULTI MATERIAL SELECTOR ──────────────────────────────────────────────────
function MultiMaterialSelector({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (mat) => {
    onChange(selected.includes(mat) ? selected.filter(m => m !== mat) : [...selected, mat]);
  };
  const remove = (mat) => onChange(selected.filter(m => m !== mat));

  return (
    <div className="ps-multimat" ref={ref}>
      {/* Chips + trigger */}
      <div className={`ps-multimat-box ${open ? "focused" : ""}`} onClick={() => setOpen(p => !p)}>
        {selected.length === 0
          ? <span className="ps-multimat-placeholder">Seleccionar materiales...</span>
          : selected.map(m => (
            <span key={m} className="ps-chip">
              {m}
              <button className="ps-chip-remove" onClick={e => { e.stopPropagation(); remove(m); }}><Icon.X /></button>
            </span>
          ))
        }
        <span className="ps-multimat-arrow"><Icon.ChevronDown /></span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="ps-multimat-dropdown">
          {MATERIALS.map(mat => (
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
      <div className="ps-upload-icon"><Icon.Upload /></div>
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
            <Icon.Receipt />
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
          <button className="ps-preview-del-btn" onClick={onRemove}><Icon.Trash /></button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={accept} style={{ display: "none" }} onChange={onFileChange} />
    </div>
  );
}

// ─── CREATE ORDER MODAL ───────────────────────────────────────────────────────
const EMPTY_FORM = {
  client_name: "",
  client_phone: "",
  description: "",
  materials: [],       // array — multi-select
  order_type: "",       // "orden normal" | "orden 911"
  design_type: "",       // "interno" | "externo"
  delivery_date: "",       // ISO date string o "" (indefinido)
  indefinido: false,    // si true, fecha queda como indefinida
};

function CreateOrderModal({ open, onClose, onCreated, userId }) {
  const previewRef = useRef(null);
  const facturaRef = useRef(null);
  const disenoRef = useRef(null);
  const formTopRef = useRef(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [facturaFile, setFacturaFile] = useState(null);
  const [facturaUrl, setFacturaUrl] = useState(null);
  const [disenoFile, setDisenoFile] = useState(null);
  const [disenoUrl, setDisenoUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── File handler factory ─────────────────────────────────────────────────
  const makeFileHandler = (setFile, setUrl, type = "image") => (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isImg = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (type === "image" && !isImg) { setError("Solo se permiten archivos de imagen."); return; }
    if (type === "doc" && !isImg && !isPdf) { setError("Solo se permiten imágenes o PDF."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("El archivo no puede superar 8 MB."); return; }
    setError("");
    setFile(file);
    if (isImg) {
      const reader = new FileReader();
      reader.onload = ev => setUrl(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setUrl("pdf"); // indicador de que hay un pdf
    }
  };

  const makeRemover = (setFile, setUrl, ref) => () => {
    setFile(null); setUrl(null);
    if (ref.current) ref.current.value = "";
  };

  // ── Upload helper ──────────────────────────────────────────────────────
  const uploadFile = async (file, bucket, prefix) => {
    if (!file) return null;
    const ext = file.name.split(".").pop();
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file);
    if (upErr) {throw new Error("Error subiendo archivo: " + upErr.message);}
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.client_name) { setError("El nombre del cliente es requerido."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.description) { setError("La descripcion del trabajo es requerida."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (form.materials.length === 0) { setError("Selecciona al menos un material."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.order_type) { setError("Selecciona el tipo de orden."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.design_type) { setError("Indica si el diseno es interno o externo."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }

    setLoading(true); setError("");

    const [previewPublicUrl, disenoPublicUrl] = await Promise.all([
      uploadFile(previewFile, "order-previews", "previews"),
      uploadFile(disenoFile, "order-docs", "disenos"),
    ]);

    const payload = {
      client_name: form.client_name.trim(),
      client_contact: form.client_phone.trim() || null,
      description: form.description.trim(),
      material: form.materials.join(", "),
      order_type: form.order_type,
      order_design_type: form.design_type,
      delivery_date: form.indefinido ? null : (form.delivery_date || null),
      status: STATUS_CONFIG["Quote_Pending"].value, // estado inicial
      payment_status: PAYMENT_CONFIG["Pending_Payment"].value, // estado inicial
      seller_id: userId,
      created_by: userId,
      preview_image: previewPublicUrl,
      order_file_url: disenoPublicUrl,
    };

    const { error: err } = await supabase.from("orders").insert([payload]);
    setLoading(false);
    if (err) { setError("Error al crear la orden: " + err.message); return; }
    handleClose(); onCreated?.();
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setPreviewFile(null); setPreviewUrl(null);
    setFacturaFile(null); setFacturaUrl(null);
    setDisenoFile(null); setDisenoUrl(null);
    setError(""); onClose();
  };

  const isExterno = form.design_type === "EXTERNAL_DESING";

  return (
    <Modal open={open} onClose={handleClose} title="Nueva Orden">
      <div ref={formTopRef} />
      {error && <div className="ps-form-error">{error}</div>}

      {/* ─ Sección 1: Datos del cliente ─ */}
      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Nombre del cliente" required>
            <input className="ps-form-input" placeholder="Ej: Empresa ABC"
              value={form.client_name} onChange={e => set("client_name", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Telefono / Contacto" optional hint="WhatsApp o numero de contacto del cliente">
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icon.Phone /></span>
              <input className="ps-form-input with-icon" placeholder="Ej: 809-555-1234"
                value={form.client_phone} onChange={e => set("client_phone", e.target.value)} />
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
          <Field label="Descripcion del trabajo" required>
            <textarea className="ps-form-input textarea" placeholder="Describe el trabajo solicitado por el cliente..."
              value={form.description} onChange={e => set("description", e.target.value)} />
          </Field>
        </div>

        {/* Multi-material */}
        <div className="col-full">
          <Field label="Materiales" required hint="Puedes seleccionar más de un material">
            <MultiMaterialSelector selected={form.materials} onChange={v => set("materials", v)} />
          </Field>
        </div>

        {/* Tipo de orden — solo 2 opciones */}
        <div className="col-full">
          <Field label="Tipo de orden" required>
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

        {/* Tipo de diseño — afecta visibilidad de campo externo */}
        <div className="col-full">
          <Field label="Tipo de diseno" required>
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

        {/* Fecha de entrega */}
        <div className="col-full">
          <Field label="Fecha de entrega" optional>
            <div className="ps-date-row">
              <div className="ps-input-icon-wrap" style={{ flex: 1 }}>
                <span className="ps-input-icon"><Icon.Calendar /></span>
                <input
                  className="ps-form-input with-icon"
                  type="date"
                  value={form.delivery_date}
                  disabled={form.indefinido}
                  onChange={e => set("delivery_date", e.target.value)}
                  style={{ opacity: form.indefinido ? 0.4 : 1 }}
                />
              </div>
              <label className="ps-indefinido-check">
                <input type="checkbox" checked={form.indefinido} onChange={e => set("indefinido", e.target.checked)} />
                <span>Indefinido</span>
              </label>
            </div>
          </Field>
        </div>
      </div>

      {/* ─ Sección 3: Archivos ─ */}
      <div className="ps-form-section-title">
        <span className="ps-form-section-num">3</span> Archivos adjuntos
      </div>
      <div className="ps-form-grid">

        {/* Imagen de referencia (opcional) */}
        <div className="col-full">
          <Field label="Imagen de referencia / Preview" optional hint="Referencia visual del trabajo esperado">
            <UploadField
              fileRef={previewRef}
              previewUrl={previewUrl}
              fileName={previewFile?.name}
              onFileChange={makeFileHandler(setPreviewFile, setPreviewUrl, "image")}
              onRemove={makeRemover(setPreviewFile, setPreviewUrl, previewRef)}
              onChangeClick={() => previewRef.current?.click()}
              accept="image/*"
            />
          </Field>
        </div>


        {/* Diseño externo — SOLO si design_type === "externo" */}
        {isExterno && (
          <div className="col-full">
            <Field
              label="Archivo de diseno del cliente"
              optional
              hint="El cliente entrego su diseno — subelo aqui para que el departamento de produccion lo reciba"
            >
              <div className="ps-upload-doc-tag design">
                <Icon.Brush /> Diseno entregado por el cliente
              </div>
              <UploadField
                fileRef={disenoRef}
                previewUrl={disenoUrl}
                fileName={disenoFile?.name}
                onFileChange={makeFileHandler(setDisenoFile, setDisenoUrl, "doc")}
                onRemove={makeRemover(setDisenoFile, setDisenoUrl, disenoRef)}
                onChangeClick={() => disenoRef.current?.click()}
                accept="image/*,.pdf"
              />
            </Field>
          </div>
        )}
      </div>

      <div className="ps-form-actions">
        <button className="ps-btn-cancel" onClick={handleClose}>Cancelar</button>
        <button className="ps-btn-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Creando orden..." : "Crear Orden →"}
        </button>
      </div>
    </Modal>
  );
}

// ─── ORDER DETAIL MODAL ───────────────────────────────────────────────────────
function OrderDetailModal({ open, onClose, order }) {
  if (!order) return null;
  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Modal open={open} onClose={onClose} title={`Orden · ${order.id?.slice(0, 8)}`} wide>
      <FlowTracker status={order.status} />
      <div className="ps-detail-grid">
        <div>
          <p className="ps-detail-section-title">Cliente &amp; Trabajo</p>
          <div className="ps-detail-box">
            <p className="ps-detail-client-name">{order.client_name}</p>
            {order.client_contact && (
              <p style={{ fontSize: 12, color: "#4A5E80", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                <Icon.Phone />{order.client_contact}
              </p>
            )}
            <p className="ps-detail-client-desc">{order.description}</p>
          </div>
          {[
            ["Material", order.material],
            ["Tipo de orden", order.order_type],
            ["Tipo de diseno",
              order.order_design_type === "INTERNAL_DESING" ? "Diseño interno" :
                order.order_design_type === "EXTERNAL_DESING" ? "Diseño externo" : "---"
            ],
            ["Fecha entrega", order.delivery_date || "Indefinida"],
          ].map(([k, v]) => (
            <div key={k} className="ps-detail-row">
              <span className="ps-detail-row-label">{k}</span>
              <span className="ps-detail-row-val">{v || "---"}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="ps-detail-section-title">Estado &amp; Pago</p>
          <div className="ps-detail-box">
            <div className="ps-detail-row" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="ps-detail-row-label">Estado actual</span>
              <StatusBadge status={order.status} />
            </div>
            <div className="ps-detail-row" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="ps-detail-row-label">Pago</span>
              <StatusBadge status={order.payment_status} type="payment" />
            </div>
            <div className="ps-detail-row" style={{ border: "none", paddingBottom: 0 }}>
              <span className="ps-detail-row-label">Precio</span>
              <span className={`ps-detail-price ${!order.price ? "none" : ""}`}>
                {order.price ? "RD$" + order.price.toLocaleString("es-DO") : "Sin cotizar"}
              </span>
            </div>
          </div>
          <p className="ps-detail-section-title" style={{ marginTop: 4 }}>Metadatos</p>
          {[["Creada", created], ["ID orden", order.id?.slice(0, 8)]].map(([k, v]) => (
            <div key={k} className="ps-detail-row">
              <span className="ps-detail-row-label">{k}</span>
              <span className="ps-detail-row-val" style={{ fontSize: 12 }}>{v}</span>
            </div>
          ))}
          {order.preview_image && (
            <div style={{ marginTop: 14 }}>
              <p className="ps-detail-section-title">Imagen de Orden de trabajo</p>
              <a href={order.preview_image} target="_blank" rel="noreferrer">
                <img src={order.preview_image} alt="preview" className="ps-detail-preview-img" />
              </a>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function PageSeller() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) setUser(data.user);
      fetchOrders();
    })();
  }, []);

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      setOrders(data);
    } else {
      setOrders([]);
    }
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today).length;
  const inQuote = orders.filter(o => ["pendiente de cotizacion", "en cotizacion"].includes(o.status)).length;
  const inProd = orders.filter(o => o.status === "en produccion").length;
  const completed = orders.filter(o => o.status === "completada").length;

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    return (
      (!q || o.client_name?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q)) &&
      (filterStatus === "all" || o.status === filterStatus) &&
      (filterPayment === "all" || o.payment_status === filterPayment)
    );
  });

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
    { id: "orders", label: "Ordenes", icon: <Icon.Orders />, badge: orders.length },
  ];
  const metrics = [
    { icon: <Icon.Orders />, label: "Ordenes hoy", value: todayOrders, sub: "Creadas por ti", accentIdx: 0, trend: 12 },
    { icon: <Icon.Package />, label: "En cotizacion", value: inQuote, sub: "Esperando precio", accentIdx: 1 },
    { icon: <Icon.Package />, label: "En produccion", value: inProd, sub: "Siendo impresas", accentIdx: 2 },
    { icon: <Icon.Truck />, label: "Completadas", value: completed, sub: "Entregadas al cliente", accentIdx: 3, trend: 8 },
  ];

  return (
    <div className="ps-root">

      {/* ── SIDEBAR ── */}
      <aside className={`ps-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="ps-sidebar-logo">
          <NeonLogo size={52} />
          {sidebarOpen && (
            <div className="ps-sidebar-logo-text">
              <div className="ps-sidebar-logo-title">Neon<span>Print</span></div>
              <div className="text-[9px] text-[#ff1f6dba] tracking-[0.07em] uppercase">Sistema de Ordenes</div>
            </div>
          )}
        </div>
        {sidebarOpen && <div className="ps-sidebar-role"><div className="ps-sidebar-role-badge">● VENDEDOR</div></div>}
        <nav className="ps-sidebar-nav">
          {nav.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`ps-nav-btn ${activeTab === item.id ? "active" : ""}`}>
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
              {sidebarOpen && item.badge !== undefined && (
                <span className={`ps-nav-badge ${activeTab === item.id ? "active-badge" : ""}`}>{item.badge}</span>
              )}
            </button>
          ))}
          <div className="ps-nav-divider" />
          <button className="ps-new-order-btn" onClick={() => setShowCreate(true)}>
            <span style={{ flexShrink: 0 }}><Icon.Plus /></span>
            {sidebarOpen && "Nueva Orden"}
          </button>
        </nav>
        <div className="ps-sidebar-footer">
          {sidebarOpen && (
            <div className="ps-user-card">
              <div className="ps-user-name">{user?.email?.split("@")[0] || "Vendedor"}</div>
              <div className="ps-user-email">{user?.email || "---"}</div>
            </div>
          )}
          <button className="ps-logout-btn" onClick={handleLogout}>
            <span style={{ flexShrink: 0 }}><Icon.Logout /></span>
            {sidebarOpen && "Cerrar sesion"}
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="ps-main-wrap">
        <header className="ps-topbar">
          <div className="ps-topbar-left">
            <button className="ps-icon-btn" onClick={() => setSidebarOpen(p => !p)}><Icon.Menu /></button>
            <div>
              <div className="ps-page-title">{activeTab === "dashboard" ? "Dashboard" : "Gestion de Ordenes"}</div>
              <div className="ps-page-date">{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          </div>
          <div className="ps-topbar-right">
            <button className="ps-icon-btn" onClick={fetchOrders}><Icon.Refresh /></button>
            <button className="ps-icon-btn"><Icon.Bell /><span className="ps-notif-dot" /></button>
            <div className="ps-topbar-divider" />
            <button className="ps-topbar-new-btn" onClick={() => setShowCreate(true)}>
              <div className="ps-topbar-new-inner"><Icon.Plus /> Nueva Orden</div>
              <div className="ps-topbar-new-stripe" />
            </button>
          </div>
        </header>

        <main className="ps-main">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <>
              <div className="ps-greeting">
                <h2>Buen dia, <span>{user?.email?.split("@")[0] || "Vendedor"}</span> 👋</h2>
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
                    <div className="ps-panel-sub">Las ultimas ordenes ingresadas al sistema</div>
                  </div>
                  <button className="ps-link-btn" onClick={() => setActiveTab("orders")}>
                    Ver todas <Icon.ArrowRight />
                  </button>
                </div>
                <div className="ps-table-wrap">
                  <table className="ps-table">
                    <thead><tr>{["Cliente", "Descripcion", "Material", "Estado", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="ps-table-empty">No hay proyectos agregados</td>
                        </tr>
                      ) : (
                        orders.slice(0, 5).map(o => (
                          <tr key={o.id} className="row-hover" onClick={() => setSelectedOrder(o)}>
                            <td className="td-pad td-name">{o.client_name}</td>
                            <td className="td-pad td-desc">{o.description}</td>
                            <td className="td-pad td-mat">{o.material}</td>
                            <td className="td-pad"><StatusBadge status={o.status} /></td>
                            <td className="td-pad">
                              <button className="ps-detail-btn" onClick={e => { e.stopPropagation(); setSelectedOrder(o); }}>
                                <Icon.ExternalLink /> Ver detalles
                              </button>
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
                  <span className="ps-search-icon"><Icon.Search /></span>
                  <input className="ps-input with-icon" placeholder="Buscar por cliente, descripcion o ID..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 160, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="all">Todos los estados</option>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span className="ps-select-arrow"><Icon.ChevronDown /></span>
                  </div>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 130, paddingRight: 32, cursor: "pointer", appearance: "none" }}
                      value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                      <option value="all">Pago: Todos</option>
                      {Object.entries(PAYMENT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span className="ps-select-arrow"><Icon.ChevronDown /></span>
                  </div>
                </div>
                <span className="ps-filters-count">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="ps-panel">
                <div className="ps-panel-stripe" />
                {loading ? <div className="ps-loading">Cargando ordenes...</div> : (
                  <div className="ps-table-wrap">
                    <table className="ps-table">
                      <thead><tr>{["ID", "Cliente", "Descripcion", "Material", "Estado", "Pago", "Tipo", "Fecha", ""].map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="ps-table-empty">No hay proyectos agregados</td>
                          </tr>
                        ) : (
                          filtered.map(o => (
                            <tr key={o.id} className="row-hover">
                              <td className="td-pad td-id">{o.id?.slice(0, 8) || "---"}</td>
                              <td className="td-pad td-name">{o.client_name}</td>
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
                              <td className="td-pad">
                                <button className="ps-detail-btn" onClick={() => setSelectedOrder(o)}>
                                  <Icon.Eye /> Ver detalles de la orden
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchOrders} userId={user?.id} />
      <OrderDetailModal open={!!selectedOrder} onClose={() => setSelectedOrder(null)} order={selectedOrder} />
    </div>
  );
}