// // import { useEffect } from "react";
// import { supabase } from "../../supabaseClient";
// import { useNavigate } from "react-router-dom";


// function PageSeller() {
//   // Navigate functtion to redirect user after logout
//   const navigate = useNavigate();

//   // Function to handle user logout
//   const handleLogout = async () => {
//     const { error } = await supabase.auth.signOut();
//     if (error) {
//       console.error("Error cerrando sesión:", error.message);
//       return;
//     }
//     navigate("/");
//   }

//   return (
//     <div>
//       <h1>Bienvenido Vendedor</h1>
//       <p> Quiere Registrar una orden</p>
//       <button className="cursor-pointer" onClick={handleLogout} >Cerrar Sesion</button>
//     </div>
//   );
// }

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  bg:         "#F8F9FB",
  surface:    "#FFFFFF",
  surfaceAlt: "#F1F4F8",
  border:     "#E4E9F0",
  borderHov:  "#CBD5E1",
  text:       "#0F172A",
  textSub:    "#64748B",
  textMuted:  "#94A3B8",
  blue:       "#0EA5E9",
  blueDark:   "#0284C7",
  blueLight:  "#E0F2FE",
  pink:       "#F43F5E",
  pinkLight:  "#FFF1F3",
  green:      "#22C55E",
  orange:     "#F97316",
  amber:      "#F59E0B",
};

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>),
  Plus: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Logout: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Eye: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>),
  Close: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  ChevronDown: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>),
  Bell: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>),
  TrendUp: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>),
  Package: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>),
  Truck: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>),
  Refresh: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>),
  ArrowRight: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>),
  Image: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>),
  ExternalLink: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>),
};

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  "pendiente de cotizacion": { label: "Pend. Cotizacion", color: "#B45309", bg: "#FEF3C7", dot: "#F59E0B" },
  "en cotizacion":           { label: "En Cotizacion",   color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "en diseno":               { label: "En Diseno",       color: "#6D28D9", bg: "#EDE9FE", dot: "#8B5CF6" },
  "en produccion":           { label: "En Produccion",   color: "#C2410C", bg: "#FFF7ED", dot: "#F97316" },
  "en entrega":              { label: "En Entrega",      color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  "completada":              { label: "Completada",      color: "#15803D", bg: "#DCFCE7", dot: "#22C55E" },
  "cancelada":               { label: "Cancelada",       color: "#B91C1C", bg: "#FEF2F2", dot: "#EF4444" },
};

const PAYMENT_CONFIG = {
  "pagado":    { label: "Pagado",    color: "#15803D", bg: "#DCFCE7" },
  "pendiente": { label: "Pendiente", color: "#B45309", bg: "#FEF3C7" },
  "parcial":   { label: "Parcial",   color: "#0369A1", bg: "#E0F2FE" },
};

const FLOW_STEPS = [
  { key: "pendiente de cotizacion", label: "Cotizacion" },
  { key: "en diseno",               label: "Diseno" },
  { key: "en produccion",           label: "Produccion" },
  { key: "en entrega",              label: "Entrega" },
  { key: "completada",              label: "Completada" },
];

const MATERIALS = ["Vinilo", "Banner", "Lona", "Papel Fotografico", "Carton", "Adhesivo", "PVC", "Acrilico", "Tela", "Otro"];
const SIZES = ['A4','A3','A2','A1','Carta','8.5x11"','11x17"','16x20"','18x24"','24x36"','Personalizado'];

const MOCK_ORDERS = [
  { id: "ORD-001", client_name: "Supermercado Nacional", description: "Banner principal evento apertura", material: "Lona", size: "8x3 ft", quantity: 2, price: 4500, status: "en produccion", payment_status: "pagado", created_at: "2025-01-15T09:30:00", order_type: "banner" },
  { id: "ORD-002", client_name: "Clinica San Rafael", description: "Vinilos adhesivos para vidrieras", material: "Vinilo", size: "1x1 m", quantity: 10, price: 3200, status: "en diseno", payment_status: "pendiente", created_at: "2025-01-15T11:00:00", order_type: "vinilo" },
  { id: "ORD-003", client_name: "Tienda Moda Urbana", description: "Catalogo temporada verano A4", material: "Papel Fotografico", size: "A4", quantity: 500, price: 8900, status: "pendiente de cotizacion", payment_status: "pendiente", created_at: "2025-01-15T13:45:00", order_type: "impresion" },
  { id: "ORD-004", client_name: "Hotel Caribe Inn", description: "Senalizacion interna habitaciones", material: "Acrilico", size: "20x15 cm", quantity: 30, price: 12000, status: "completada", payment_status: "pagado", created_at: "2025-01-14T10:20:00", order_type: "senalizacion" },
  { id: "ORD-005", client_name: "Farmacia Salud Total", description: "Rollup para feria de salud", material: "Banner", size: "80x200 cm", quantity: 3, price: 5500, status: "en entrega", payment_status: "parcial", created_at: "2025-01-14T15:30:00", order_type: "rollup" },
  { id: "ORD-006", client_name: "Universidad INTEC", description: "Flyers convocatoria graduacion", material: "Papel Fotografico", size: "A5", quantity: 1000, price: 6200, status: "en cotizacion", payment_status: "pendiente", created_at: "2025-01-13T08:00:00", order_type: "flyer" },
];

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status, type = "status" }) => {
  const cfg = type === "status" ? STATUS_CONFIG[status] : PAYMENT_CONFIG[status];
  if (!cfg) return <span style={{ color: C.textMuted, fontSize: 12 }}>{status || "---"}</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap", fontFamily: "Poppins, sans-serif" }}>
      {type === "status" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />}
      {cfg.label}
    </span>
  );
};

// ─── METRIC CARD ─────────────────────────────────────────────────────────────
const MetricCard = ({ icon, label, value, sub, accent, accentLight, trend }) => (
  <div
    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px 24px", position: "relative", overflow: "hidden", transition: "box-shadow 0.2s, transform 0.2s", cursor: "default", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}
  >
    <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: accentLight, opacity: 0.7, pointerEvents: "none" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
      <div style={{ background: accentLight, borderRadius: 10, padding: 10, color: accent, display: "flex" }}>{icon}</div>
      {trend !== undefined && (
        <span style={{ fontSize: 11, color: "#15803D", fontWeight: 600, display: "flex", alignItems: "center", gap: 3, background: "#DCFCE7", padding: "3px 8px", borderRadius: 20 }}>
          <Icon.TrendUp /> +{trend}%
        </span>
      )}
    </div>
    <div style={{ fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 13, color: C.textSub, marginTop: 5, fontWeight: 500 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: accent, marginTop: 4, fontWeight: 500 }}>{sub}</div>}
  </div>
);

// ─── MODAL ────────────────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children, wide }) => {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.4)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, width: "100%", maxWidth: wide ? 860 : 560, maxHeight: "90vh", overflowY: "auto", fontFamily: "Poppins, sans-serif", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", animation: "slideUp 0.25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 28px", borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>{title}</h2>
          <button onClick={onClose}
            style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: 7, cursor: "pointer", color: C.textSub, display: "flex", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = C.border; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.textSub; }}>
            <Icon.Close />
          </button>
        </div>
        <div style={{ padding: "24px 28px 28px" }}>{children}</div>
      </div>
    </div>
  );
};

const FormInput = ({ label, required, children }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textSub, marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {label}{required && <span style={{ color: C.pink, marginLeft: 3 }}>*</span>}
    </label>
    {children}
  </div>
);

const iStyle = {
  width: "100%", background: C.surface, border: `1.5px solid ${C.border}`,
  borderRadius: 10, padding: "10px 13px", color: C.text,
  fontSize: 14, fontFamily: "Poppins, sans-serif", outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box",
};

const focusIn  = e => { e.target.style.borderColor = C.blue; e.target.style.boxShadow = `0 0 0 3px ${C.blueLight}`; };
const focusOut = e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = "none"; };

// ─── FLOW TRACKER ─────────────────────────────────────────────────────────────
const FlowTracker = ({ status }) => {
  const idx = FLOW_STEPS.findIndex(s => s.key === status);
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 28, padding: "18px 20px", background: C.surfaceAlt, borderRadius: 12, border: `1px solid ${C.border}` }}>
      {FLOW_STEPS.map((step, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: active ? C.blue : done ? "#DCFCE7" : C.surface, border: `2px solid ${active ? C.blue : done ? C.green : C.border}`, fontSize: 11, fontWeight: 700, color: active ? "#fff" : done ? C.green : C.textMuted, transition: "all 0.3s" }}>
                {done ? "v" : i + 1}
              </div>
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, color: active ? C.blue : done ? C.green : C.textMuted, whiteSpace: "nowrap" }}>{step.label}</span>
            </div>
            {i < FLOW_STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: done ? "#BBF7D0" : C.border, margin: "0 4px", marginBottom: 18, transition: "background 0.3s" }} />}
          </div>
        );
      })}
    </div>
  );
};

// ─── CREATE ORDER MODAL ───────────────────────────────────────────────────────
const CreateOrderModal = ({ open, onClose, onCreated, userId }) => {
  const [form, setForm] = useState({ client_name: "", description: "", material: "", size: "", quantity: "", order_type: "", preview_image: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.client_name || !form.description || !form.material || !form.quantity) {
      setError("Por favor completa los campos requeridos."); return;
    }
    setLoading(true); setError("");
    const payload = {
      client_name: form.client_name.trim(), description: form.description.trim(),
      material: form.material, size: form.size, quantity: parseInt(form.quantity),
      order_type: form.order_type || "general",
      status: "pendiente de cotizacion", payment_status: "pendiente",
      seller_id: userId, created_by: userId,
      preview_image: form.preview_image || null,
    };
    const { error: err } = await supabase.from("orders").insert([payload]);
    setLoading(false);
    if (err) { setError("Error al crear la orden: " + err.message); return; }
    setForm({ client_name: "", description: "", material: "", size: "", quantity: "", order_type: "", preview_image: "" });
    onCreated?.(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Nueva Orden">
      {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 13, color: "#B91C1C" }}>{error}</div>}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${C.blue}, ${C.pink})`, borderRadius: 4, marginBottom: 22 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
        <div style={{ gridColumn: "1/-1" }}>
          <FormInput label="Nombre del Cliente" required>
            <input style={iStyle} placeholder="Ej: Empresa ABC" value={form.client_name} onChange={e => set("client_name", e.target.value)} onFocus={focusIn} onBlur={focusOut} />
          </FormInput>
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <FormInput label="Descripcion del trabajo" required>
            <textarea style={{ ...iStyle, minHeight: 80, resize: "vertical" }} placeholder="Describe el trabajo requerido..." value={form.description} onChange={e => set("description", e.target.value)} onFocus={focusIn} onBlur={focusOut} />
          </FormInput>
        </div>
        <FormInput label="Material" required>
          <div style={{ position: "relative" }}>
            <select style={{ ...iStyle, appearance: "none", paddingRight: 34, cursor: "pointer" }} value={form.material} onChange={e => set("material", e.target.value)} onFocus={focusIn} onBlur={focusOut}>
              <option value="">Seleccionar...</option>
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: C.textMuted, pointerEvents: "none" }}><Icon.ChevronDown /></span>
          </div>
        </FormInput>
        <FormInput label="Tamano / Dimensiones">
          <div style={{ position: "relative" }}>
            <select style={{ ...iStyle, appearance: "none", paddingRight: 34, cursor: "pointer" }} value={form.size} onChange={e => set("size", e.target.value)} onFocus={focusIn} onBlur={focusOut}>
              <option value="">Seleccionar...</option>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: C.textMuted, pointerEvents: "none" }}><Icon.ChevronDown /></span>
          </div>
        </FormInput>
        <FormInput label="Cantidad" required>
          <input style={iStyle} type="number" min="1" placeholder="1" value={form.quantity} onChange={e => set("quantity", e.target.value)} onFocus={focusIn} onBlur={focusOut} />
        </FormInput>
        <FormInput label="Tipo de orden">
          <input style={iStyle} placeholder="Ej: banner, flyer, rollup..." value={form.order_type} onChange={e => set("order_type", e.target.value)} onFocus={focusIn} onBlur={focusOut} />
        </FormInput>
        <div style={{ gridColumn: "1/-1" }}>
          <FormInput label="Preview / Referencia visual">
            <div style={{ border: `1.5px dashed ${C.border}`, borderRadius: 12, padding: 16, background: C.surfaceAlt, transition: "border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{ background: C.blueLight, borderRadius: 8, padding: 8, color: C.blue, display: "flex" }}><Icon.Image /></div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text }}>Imagen de referencia</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>Pega la URL de la imagen aqui</p>
                </div>
              </div>
              <input style={{ ...iStyle, fontSize: 12 }} placeholder="https://..." value={form.preview_image} onChange={e => set("preview_image", e.target.value)} onFocus={focusIn} onBlur={focusOut} />
            </div>
          </FormInput>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button onClick={onClose} style={{ flex: 1, background: C.surfaceAlt, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "11px", color: C.textSub, fontFamily: "Poppins, sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
        <button onClick={handleSubmit} disabled={loading} style={{ flex: 2, background: loading ? C.surfaceAlt : C.blue, border: "none", borderRadius: 10, padding: "11px", color: loading ? C.textMuted : "#fff", fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : "0 4px 14px rgba(14,165,233,0.3)" }}>
          {loading ? "Creando orden..." : "Crear Orden"}
        </button>
      </div>
    </Modal>
  );
};

// ─── ORDER DETAIL MODAL ───────────────────────────────────────────────────────
const OrderDetailModal = ({ open, onClose, order }) => {
  if (!order) return null;
  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  return (
    <Modal open={open} onClose={onClose} title={`Orden - ${order.id}`} wide>
      <FlowTracker status={order.status} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12, marginTop: 0 }}>Cliente & Trabajo</p>
          <div style={{ background: C.surfaceAlt, borderRadius: 12, padding: 18, border: `1px solid ${C.border}`, marginBottom: 16 }}>
            <p style={{ margin: "0 0 5px", fontSize: 17, fontWeight: 700, color: C.text }}>{order.client_name}</p>
            <p style={{ margin: 0, fontSize: 13, color: C.textSub, lineHeight: 1.6 }}>{order.description}</p>
          </div>
          {[["Material", order.material], ["Tamano", order.size], ["Cantidad", order.quantity], ["Tipo", order.order_type]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.textSub }}>{k}</span>
              <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{v || "---"}</span>
            </div>
          ))}
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12, marginTop: 0 }}>Estado & Pago</p>
          <div style={{ background: C.surfaceAlt, borderRadius: 12, padding: 18, border: `1px solid ${C.border}`, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: C.textSub }}>Estado actual</span>
              <StatusBadge status={order.status} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: C.textSub }}>Pago</span>
              <StatusBadge status={order.payment_status} type="payment" />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.textSub }}>Precio</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: order.price ? C.blue : C.textMuted }}>
                {order.price ? "RD$" + order.price.toLocaleString("es-DO") : "Sin cotizar"}
              </span>
            </div>
          </div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Metadatos</p>
          {[["Creada", created], ["ID", order.id]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.textSub }}>{k}</span>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{v}</span>
            </div>
          ))}
          {order.preview_image && (
            <a href={order.preview_image} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, padding: "10px 14px", background: C.blueLight, borderRadius: 10, border: "1px solid #BAE6FD", color: C.blueDark, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              <Icon.Image /> Ver imagen de referencia
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
function PageSeller() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab]     = useState("dashboard");
  const [orders, setOrders]           = useState(MOCK_ORDERS);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [filterStatus, setFilterStatus]   = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [showCreate, setShowCreate]   = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [user, setUser]               = useState(null);
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
    if (!error && data?.length) setOrders(data);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const today      = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today).length;
  const inQuote     = orders.filter(o => ["pendiente de cotizacion", "en cotizacion"].includes(o.status)).length;
  const inProd      = orders.filter(o => o.status === "en produccion").length;
  const completed   = orders.filter(o => o.status === "completada").length;

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    return (
      (!q || o.client_name?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q)) &&
      (filterStatus  === "all" || o.status         === filterStatus) &&
      (filterPayment === "all" || o.payment_status === filterPayment)
    );
  });

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
    { id: "orders",    label: "Ordenes",   icon: <Icon.Orders />, badge: orders.length },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, fontFamily: "Poppins, sans-serif", color: C.text, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #F8F9FB; }
        ::-webkit-scrollbar-thumb { background: #E4E9F0; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }
        @keyframes slideUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        .row-np:hover td { background: #F1F4F8 !important; }
        .nav-item-np { background: transparent; }
        .nav-item-np:hover { background: #F1F4F8 !important; }
        .btn-icon:hover { background: #F1F4F8 !important; color: #0F172A !important; border-color: #CBD5E1 !important; }
        .detail-btn:hover { background: #0EA5E9 !important; color: #fff !important; border-color: #0EA5E9 !important; }
        .new-order-sidebar:hover { background: #0EA5E9 !important; color: #fff !important; }
      `}</style>

      {/* SIDEBAR */}
      <aside style={{ width: sidebarOpen ? 224 : 60, minWidth: sidebarOpen ? 224 : 60, background: "#FFFFFF", borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width 0.25s ease, min-width 0.25s ease", overflow: "hidden", boxShadow: "2px 0 8px rgba(0,0,0,0.04)" }}>
        {/* Logo */}
        <div style={{ padding: "20px 14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg, ${C.blue}, ${C.pink})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>N</div>
          {sidebarOpen && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>Neon<span style={{ color: C.blue }}>Print</span></div>
              <div style={{ fontSize: 9, color: C.textMuted, whiteSpace: "nowrap", letterSpacing: "0.07em", textTransform: "uppercase" }}>Sistema de Ordenes</div>
            </div>
          )}
        </div>
        {/* Role pill */}
        {sidebarOpen && (
          <div style={{ padding: "12px 14px 4px" }}>
            <div style={{ background: C.blueLight, borderRadius: 7, padding: "5px 10px", fontSize: 10, color: C.blueDark, fontWeight: 700, textAlign: "center", letterSpacing: "0.05em" }}>VENDEDOR</div>
          </div>
        )}
        {/* Nav */}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className="nav-item-np" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer", width: "100%", background: activeTab === item.id ? C.blueLight : "transparent", color: activeTab === item.id ? C.blue : C.textSub, fontFamily: "Poppins, sans-serif", fontWeight: activeTab === item.id ? 600 : 500, fontSize: 13, transition: "all 0.15s", borderLeft: `3px solid ${activeTab === item.id ? C.blue : "transparent"}`, whiteSpace: "nowrap", overflow: "hidden" }}>
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
              {sidebarOpen && item.badge !== undefined && (
                <span style={{ marginLeft: "auto", background: activeTab === item.id ? "#BAE6FD" : C.surfaceAlt, borderRadius: 20, padding: "1px 8px", fontSize: 11, color: activeTab === item.id ? C.blue : C.textMuted, fontWeight: 600 }}>{item.badge}</span>
              )}
            </button>
          ))}
          <div style={{ height: 1, background: C.border, margin: "8px 4px" }} />
          <button onClick={() => setShowCreate(true)} className="new-order-sidebar" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: `1.5px solid ${C.blue}`, cursor: "pointer", width: "100%", background: C.blueLight, color: C.blue, fontFamily: "Poppins, sans-serif", fontWeight: 600, fontSize: 13, transition: "all 0.15s", whiteSpace: "nowrap", overflow: "hidden" }}>
            <span style={{ flexShrink: 0 }}><Icon.Plus /></span>
            {sidebarOpen && "Nueva Orden"}
          </button>
        </nav>
        {/* User + logout */}
        <div style={{ padding: "10px 8px 14px", borderTop: `1px solid ${C.border}` }}>
          {sidebarOpen && (
            <div style={{ padding: "9px 10px", marginBottom: 4, borderRadius: 9, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email?.split("@")[0] || "Vendedor"}</div>
              <div style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email || "---"}</div>
            </div>
          )}
          <button onClick={handleLogout} className="nav-item-np" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer", width: "100%", background: "transparent", color: C.pink, fontFamily: "Poppins, sans-serif", fontWeight: 500, fontSize: 13, transition: "all 0.15s", whiteSpace: "nowrap", overflow: "hidden" }}>
            <span style={{ flexShrink: 0 }}><Icon.Logout /></span>
            {sidebarOpen && "Cerrar sesion"}
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{ background: "#FFFFFF", borderBottom: `1px solid ${C.border}`, padding: "0 26px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={() => setSidebarOpen(p => !p)} className="btn-icon" style={{ background: "transparent", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 8px", cursor: "pointer", color: C.textSub, display: "flex", alignItems: "center", transition: "all 0.15s" }}>
              <Icon.Menu />
            </button>
            <div>
              <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{activeTab === "dashboard" ? "Dashboard" : "Gestion de Ordenes"}</h1>
              <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={fetchOrders} className="btn-icon" style={{ background: "transparent", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 8px", cursor: "pointer", color: C.textSub, display: "flex", alignItems: "center", transition: "all 0.15s" }}>
              <Icon.Refresh />
            </button>
            <button className="btn-icon" style={{ background: "transparent", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 8px", cursor: "pointer", color: C.textSub, display: "flex", alignItems: "center", position: "relative", transition: "all 0.15s" }}>
              <Icon.Bell />
              <span style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: "50%", background: C.pink }} />
            </button>
            <div style={{ width: 1, height: 24, background: C.border }} />
            <button onClick={() => setShowCreate(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: C.blue, border: "none", borderRadius: 9, padding: "8px 16px", color: "#fff", fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all 0.15s", boxShadow: "0 2px 8px rgba(14,165,233,0.3)" }}
              onMouseEnter={e => { e.currentTarget.style.background = C.blueDark; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.blue; }}>
              <Icon.Plus /> Nueva Orden
            </button>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflow: "auto", padding: 26, animation: "fadeIn 0.3s ease" }}>

          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <div>
              <div style={{ marginBottom: 26 }}>
                <h2 style={{ margin: "0 0 3px", fontSize: 21, fontWeight: 800, color: C.text }}>
                  Buen dia, <span style={{ color: C.blue }}>{user?.email?.split("@")[0] || "Vendedor"}</span>
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: C.textSub }}>Resumen de tu actividad de hoy.</p>
              </div>

              {/* 4 metric cards — no revenue */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
                <MetricCard icon={<Icon.Orders />} label="Ordenes hoy"   value={todayOrders} sub="Creadas por ti"        accent={C.blue}   accentLight={C.blueLight} trend={12} />
                <MetricCard icon={<Icon.Package />} label="En cotizacion" value={inQuote}    sub="Esperando precio"      accent="#F59E0B"  accentLight="#FEF3C7" />
                <MetricCard icon={<Icon.Package />} label="En produccion" value={inProd}     sub="Siendo impresas"       accent={C.orange} accentLight="#FFF7ED" />
                <MetricCard icon={<Icon.Truck />}   label="Completadas"   value={completed}  sub="Entregadas al cliente" accent={C.green}  accentLight="#DCFCE7" trend={8} />
              </div>

              {/* Recent orders */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Ordenes recientes</h3>
                    <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>Las ultimas ordenes creadas</p>
                  </div>
                  <button onClick={() => setActiveTab("orders")} style={{ background: "none", border: "none", color: C.blue, fontFamily: "Poppins, sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 7, transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = C.blueLight}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    Ver todas <Icon.ArrowRight />
                  </button>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.surfaceAlt }}>
                      {["Cliente", "Descripcion", "Material", "Estado", ""].map(h => (
                        <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 5).map(o => (
                      <tr key={o.id} className="row-np" style={{ cursor: "pointer", transition: "background 0.1s" }} onClick={() => setSelectedOrder(o)}>
                        <td style={{ padding: "12px 18px", color: C.text, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{o.client_name}</td>
                        <td style={{ padding: "12px 18px", color: C.textSub, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{o.description}</td>
                        <td style={{ padding: "12px 18px", color: C.textSub, borderBottom: `1px solid ${C.border}` }}>{o.material}</td>
                        <td style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}><StatusBadge status={o.status} /></td>
                        <td style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
                          <button onClick={e => { e.stopPropagation(); setSelectedOrder(o); }} className="detail-btn" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.blueLight, border: "1px solid #BAE6FD", borderRadius: 7, padding: "5px 10px", cursor: "pointer", color: C.blue, fontSize: 11, fontWeight: 600, fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                            <Icon.ExternalLink /> Ver detalles
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ORDERS TAB */}
          {activeTab === "orders" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textMuted }}><Icon.Search /></span>
                  <input style={{ ...iStyle, paddingLeft: 36 }} placeholder="Buscar por cliente, descripcion o ID..." value={search} onChange={e => setSearch(e.target.value)} onFocus={focusIn} onBlur={focusOut} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...iStyle, appearance: "none", paddingRight: 32, minWidth: 160, cursor: "pointer" }} onFocus={focusIn} onBlur={focusOut}>
                      <option value="all">Todos los estados</option>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: C.textMuted, pointerEvents: "none" }}><Icon.ChevronDown /></span>
                  </div>
                  <div style={{ position: "relative" }}>
                    <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} style={{ ...iStyle, appearance: "none", paddingRight: 32, minWidth: 130, cursor: "pointer" }} onFocus={focusIn} onBlur={focusOut}>
                      <option value="all">Pago: Todos</option>
                      {Object.entries(PAYMENT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: C.textMuted, pointerEvents: "none" }}><Icon.ChevronDown /></span>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: C.textMuted, padding: "0 4px" }}>{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                {loading ? (
                  <div style={{ padding: 48, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Cargando ordenes...</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: C.surfaceAlt }}>
                          {["ID", "Cliente", "Descripcion", "Material", "Cant.", "Estado", "Pago", "Fecha", ""].map(h => (
                            <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr><td colSpan={9} style={{ padding: 48, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No se encontraron ordenes con los filtros aplicados.</td></tr>
                        ) : filtered.map(o => (
                          <tr key={o.id} className="row-np" style={{ transition: "background 0.1s" }}>
                            <td style={{ padding: "12px 16px", color: C.textMuted, fontFamily: "monospace", fontSize: 11, borderBottom: `1px solid ${C.border}` }}>{o.id?.slice(0, 8) || "---"}</td>
                            <td style={{ padding: "12px 16px", color: C.text, fontWeight: 600, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{o.client_name}</td>
                            <td style={{ padding: "12px 16px", color: C.textSub, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{o.description}</td>
                            <td style={{ padding: "12px 16px", color: C.textSub, borderBottom: `1px solid ${C.border}` }}>{o.material}</td>
                            <td style={{ padding: "12px 16px", color: C.textSub, textAlign: "center", borderBottom: `1px solid ${C.border}` }}>{o.quantity}</td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}><StatusBadge status={o.status} /></td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}><StatusBadge status={o.payment_status} type="payment" /></td>
                            <td style={{ padding: "12px 16px", color: C.textMuted, fontSize: 12, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>
                              {new Date(o.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}
                            </td>
                            <td style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
                              <button onClick={() => setSelectedOrder(o)} className="detail-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.blueLight, border: "1px solid #BAE6FD", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: C.blue, fontSize: 12, fontWeight: 600, fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                                <Icon.Eye /> Ver detalles de la orden
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchOrders} userId={user?.id} />
      <OrderDetailModal open={!!selectedOrder} onClose={() => setSelectedOrder(null)} order={selectedOrder} />
    </div>
  );
}

export default PageSeller;