// SELLER'S HOME PAGE - ORDER DASHBOARD

// IMPORT REACT  &  SUPABASE
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";

// IMPORT CSS & ASSETS
import "../css-components/page-seller.css";
import Sidebar from "../components/Sidebar";

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
  Edit: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>),
  Archived: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>),
  ChevronLeft: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>),
  ChevronRight: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>),
  Clipboard: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>),
  Paintbrush: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63a3.75 3.75 0 0 0-5.3 0l-.4.4a3.75 3.75 0 0 0 0 5.3l4.26 4.26a3.75 3.75 0 0 0 5.3 0l.4-.4a3.75 3.75 0 0 0 0-5.3l-4.26-4.26Z" /><path d="M9.41 2.63a3.75 3.75 0 0 1 5.3 0l.4.4a3.75 3.75 0 0 1 0 5.3l-4.26 4.26a3.75 3.75 0 0 1-5.3 0l-.4-.4a3.75 3.75 0 0 1 0-5.3l4.26-4.26Z" /></svg>),
  FileText: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>),
  Paperclip: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>),
  Settings: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>),
  Key: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m-3.5 3.5L12 12" /></svg>),
  Clock: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>),
  User: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>),
  Image: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>),
  File: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
};

// ─── STATUS & PAYMENT CONFIG ──────────────────────────────────────────────────
const STATUS_CONFIG = {
  "Pending": { label: "Pendiente", value: "Pending", color: "#92620A", bg: "#FEF3C7", dot: "#F59E0B" },
  "In_Design": { label: "En Diseño", value: "In_Design", color: "#5B21B6", bg: "#EDE9FE", dot: "#8B5CF6" },
  "in_Quotation": { label: "En Cotización", value: "in_Quotation", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "cotizacion": { label: "Cotización", value: "cotizacion", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "en produccion": { label: "En Producción", value: "en produccion", color: "#9A3412", bg: "#FFF7ED", dot: "#F97316" },
  "terminacion": { label: "Terminación", value: "terminacion", color: "#0369A1", bg: "#E0F2FE", dot: "#0284C7" },
  "en entrega": { label: "En Entrega", value: "en entrega", color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  "completada": { label: "Completada", value: "completada", color: "#14532D", bg: "#DCFCE7", dot: "#22C55E" },
  "cancelada": { label: "Cancelada", value: "cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
  "archivada": { label: "Archivada", value: "archivada", color: "#7C3AED", bg: "#EDE9FE", dot: "#8B5CF6" },
};

const PAYMENT_CONFIG = {
  "pagado": { label: "Pagado", color: "#14532D", bg: "#DCFCE7" },
  "Pending_Payment": { label: "Pago Pendiente", value: "Pending_Payment", color: "#92620A", bg: "#FEF3C7" },
  "parcial": { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};

// Helper function to parse order_file_url (handles both single string and JSON array)
const parseFileUrls = (fileUrl) => {
  if (!fileUrl) return [];
  try {
    const parsed = JSON.parse(fileUrl);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [fileUrl];
  }
};

const FLOW_STEPS = [
  { key: "Pending", label: "Pendiente" },
  { key: "In_Design", label: "Diseño" },
  { key: "cotizacion", label: "Cotización" },
  { key: "Produccion", label: "Producción" },
  { key: "en produccion", label: "Terminación" },
  { key: "en entrega", label: "Entrega" },
];

// Flujo para órdenes de Diseño Externo (sin paso de diseño)
const FLOW_STEPS_EXTERNAL = [
  { key: "Pending", label: "Pendiente" },
  { key: "cotizacion", label: "Cotización" },
  { key: "en produccion", label: "Producción" },
  { key: "terminacion", label: "Terminación" },
  { key: "en entrega", label: "Entrega" },
];

// Mapeo para mostrar la etiqueta correcta del paso actual
const FLOW_STEP_LABELS = {
  "Pending": "Pendiente",
  "In_Design": "Diseño", 
  "in_Quotation": "Cotización",
  "cotizacion": "Cotización",
  "Produccion": "Producción",
  "en produccion": "Terminación",
  "terminacion": "Terminación",
  "en entrega": "Entrega",
  "completada": "Completada",
  "cancelada": "Cancelada",
};

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
];

// ─── CONSTANTES DE FORMULARIO ─────────────────────────────────────────────────
const MATERIALS = [
  "Vinilo", "Banner", "Lona", "Papel Fotografico", "Carton",
  "Adhesivo", "PVC", "Acrilico", "Tela", "Foam", "Otro"
];


// ─── COMPONENTES REUTILIZABLES ────────────────────────────────────────────────
function ErrorBoundary({ children }) {
  return children;
}

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

// CARTA DE METRICA PARA DASHBOARD
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
          <button className="ps-modal-close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="ps-modal-body">{children}</div>
      </div>
    </div>
  );
}

// CAMPO DE FORMULARIO QUE RECIBE VALORES
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

// BARRA DE POGRESO SE SEGUIMIENTO DE  LA ORDEN
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
  // Mapeo de estados a índice del tracker (ambos estados de cotización van al mismo paso)
  const statusToIndex = {
    "Pending": 0,
    "in_Quotation": 1,
    "cotizacion": 1,
    "en produccion": 2,
    "terminacion": 3,
    "en entrega": 4,
    "completada": 4,
    "cancelada": -1,
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

// ─── Selector de diferentes materiales ──────────────────────────────────────────────────
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
  termination_type: "", // tipo de terminación
  order_type: "",       // "orden normal" | "orden 911"
  design_type: "",       // "INTERNAL_DESING" | "EXTERNAL_DESING"
  delivery_date: "",       // ISO date string o "" (indefinido)
  indefinido: false,    // si true, fecha queda como indefinida
  design_files: [],     // archivos de diseño externo
  design_preview: null, // imagen preview de diseño externo
};

function CreateOrderModal({ open, onClose, onCreated, userId }) {
  const formTopRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewInputRef = useRef(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.client_name) { setError("El nombre del cliente es requerido."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.description) { setError("La descripcion del trabajo es requerida."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (form.materials.length === 0) { setError("Selecciona al menos un material."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.order_type) { setError("Selecciona el tipo de orden."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.design_type) { setError("Indica si el diseno es interno o externo."); formTopRef.current?.scrollIntoView({ behavior: "smooth" }); return; }

    setLoading(true); setError("");

    const payload = {
      client_name: form.client_name.trim(),
      client_contact: form.client_phone.trim() || null,
      description: form.description.trim(),
      material: form.materials.join(", "),
      termination_type: form.termination_type.trim() || null,
      order_type: form.order_type,
      order_design_type: form.design_type,
      delivery_date: form.indefinido ? null : (form.delivery_date || null),
      status: "Pending",
      payment_status: PAYMENT_CONFIG["Pending_Payment"].value,
      seller_id: userId,
      created_by: userId,
    };

    const { data: newOrder, error: err } = await supabase.from("orders").insert([payload]).select().single();
    setLoading(false);
    if (err) { setError("Error al crear la orden: " + err.message); return; }

    if (form.design_files.length > 0 || form.design_preview) {
      setLoading(true);
      const fileUrls = [];
      
      for (let i = 0; i < form.design_files.length; i++) {
        const file = form.design_files[i];
        const fileName = `${Date.now()}-${i}-${file.name}`;
        const { data, error } = await supabase.storage
          .from("order-docs")
          .upload(`orders/${newOrder.id}/files/${fileName}`, file, { upsert: true });
        
        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from("order-docs")
            .getPublicUrl(`orders/${newOrder.id}/files/${fileName}`);
          fileUrls.push(publicUrl);
        }
      }
      
      let previewUrl = null;
      if (form.design_preview) {
        const fileName = `preview-${Date.now()}.${form.design_preview.name.split('.').pop()}`;
        const { data, error } = await supabase.storage
          .from("order-previews")
          .upload(`orders/${newOrder.id}/preview/${fileName}`, form.design_preview, { upsert: true });
        
        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from("order-previews")
            .getPublicUrl(`orders/${newOrder.id}/preview/${fileName}`);
          previewUrl = publicUrl;
        }
      }
      
      if (fileUrls.length > 0 || previewUrl) {
        const updateData = {};
        if (fileUrls.length > 0) updateData.order_file_url = JSON.stringify(fileUrls);
        if (previewUrl) updateData.preview_image = previewUrl;
        
        await supabase.from("orders").update(updateData).eq("id", newOrder.id);
      }
      
      setLoading(false);
    }

    handleClose(); onCreated?.();
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setError(""); onClose();
  };

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

        {/* Tipo de terminación */}
        <div className="col-full">
          <Field label="Tipo de terminación" optional hint="Describe el tipo de terminación del trabajo">
            <input className="ps-form-input" placeholder="Ej: Brillante, Mate, Con marco..."
              value={form.termination_type} onChange={e => set("termination_type", e.target.value)} />
          </Field>
        </div>

        {/* Tipo de orden */}
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

        {/* Tipo de diseño */}
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

        {/* Campos para DISEÑO EXTERNO */}
        {form.design_type === "EXTERNAL_DESING" && (
          <>
            <div className="col-full">
              <Field label="Archivos de diseño" hint="Sube los archivos de diseño del cliente">
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
                  <div className="ps-upload-icon"><Icon.Upload /></div>
                  <div className="ps-upload-btn-wrapper">
                    <span className="ps-upload-btn-text">Subir archivos</span>
                  </div>
                  <span className="ps-upload-hint">Archivos del diseño (PDF, AI, PNG, JPG...)</span>
                </div>
                {form.design_files.length > 0 && (
                  <div className="ps-files-list">
                    {form.design_files.map((file, i) => (
                      <div key={i} className="ps-file-item">
                        <Icon.File />
                        <span className="ps-file-name">{file.name}</span>
                        <button className="ps-file-remove" onClick={(e) => { e.stopPropagation(); set("design_files", form.design_files.filter((_, idx) => idx !== i)); }}>
                          <Icon.X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="col-full">
              <Field label="Imagen de preview" hint="Vista previa del diseño">
                {!form.design_preview ? (
                  <div className="ps-preview-empty" onClick={() => previewInputRef.current?.click()}>
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
                    <div className="ps-preview-upload-content">
                      <div className="ps-preview-upload-icon"><Icon.Image /></div>
                      <span className="ps-preview-upload-text">Subir imagen de preview</span>
                    </div>
                  </div>
                ) : (
                  <div className="ps-preview-showcase">
                    <div className="ps-preview-card">
                      <img src={URL.createObjectURL(form.design_preview)} alt="Preview" className="ps-preview-img-main" />
                      <div className="ps-preview-card-overlay">
                        <span className="ps-preview-card-label">Vista previa del diseño</span>
                        <div className="ps-preview-card-actions">
                          <button className="ps-preview-change-btn" onClick={() => previewInputRef.current?.click()}>Cambiar</button>
                          <button className="ps-preview-del-btn" onClick={() => set("design_preview", null)}><Icon.Trash /></button>
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
function EditOrderModal({ open, onClose, order, onUpdated }) {
  const [form, setForm] = useState({
    client_name: "",
    client_contact: "",
    description: "",
    material: "",
    status: "",
    payment_status: "",
    delivery_date: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (order) {
      setForm({
        client_name: order.client_name || "",
        client_contact: order.client_contact || "",
        description: order.description || "",
        material: order.material || "",
        status: order.status || "",
        payment_status: order.payment_status || "",
        delivery_date: order.delivery_date ? order.delivery_date.split("T")[0] : "",
      });
    }
  }, [order]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.client_name) { setError("El nombre del cliente es requerido."); return; }
    if (!form.description) { setError("La descripción es requerida."); return; }

    setLoading(true);
    setError("");

    const { error: err } = await supabase
      .from("orders")
      .update({
        client_name: form.client_name.trim(),
        client_contact: form.client_contact.trim() || null,
        description: form.description.trim(),
        material: form.material.trim(),
        status: form.status,
        payment_status: form.payment_status,
        delivery_date: form.delivery_date || null,
      })
      .eq("id", order.id);

    setLoading(false);

    if (err) {
      setError("Error al actualizar: " + err.message);
      return;
    }

    onUpdated?.();
    onClose();
  };

  const statusOptions = Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({
    value: key,
    label: cfg.label,
  }));

  const paymentOptions = Object.entries(PAYMENT_CONFIG).map(([key, cfg]) => ({
    value: key,
    label: cfg.label,
  }));

  return (
    <Modal open={open} onClose={onClose} title={`Editar Orden #${order?.id?.slice(0, 8).toUpperCase()}`}>
      {error && <div className="ps-form-error">{error}</div>}

      <div className="ps-form-section-title">
        <span className="ps-form-section-num">1</span> Datos del cliente
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Nombre del cliente" required>
            <input className="ps-form-input" value={form.client_name} onChange={e => set("client_name", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Contacto" optional>
            <input className="ps-form-input" value={form.client_contact} onChange={e => set("client_contact", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="ps-form-section-title" style={{ marginTop: 20 }}>
        <span className="ps-form-section-num">2</span> Detalles de la orden
      </div>
      <div className="ps-form-grid">
        <div className="col-full">
          <Field label="Descripción" required>
            <textarea className="ps-form-input textarea" value={form.description} onChange={e => set("description", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Material" optional>
            <input className="ps-form-input" value={form.material} onChange={e => set("material", e.target.value)} />
          </Field>
        </div>
        <div className="col-full">
          <Field label="Estado" required>
            <select className="ps-form-input" value={form.status} onChange={e => set("status", e.target.value)}>
              <option value="">Seleccionar...</option>
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-full">
          <Field label="Pago" required>
            <select className="ps-form-input" value={form.payment_status} onChange={e => set("payment_status", e.target.value)}>
              <option value="">Seleccionar...</option>
              {paymentOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-full">
          <Field label="Fecha de entrega" optional>
            <div className="ps-input-icon-wrap">
              <span className="ps-input-icon"><Icon.Calendar /></span>
              <input className="ps-form-input with-icon" type="date" value={form.delivery_date} onChange={e => set("delivery_date", e.target.value)} />
            </div>
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
  if (!order) return null;
  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const statusConfig = STATUS_CONFIG[order.status];
  const paymentConfig = PAYMENT_CONFIG[order.payment_status];
  
  const [designerName, setDesignerName] = useState("");
  
  useEffect(() => {
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
                { label: "Material", value: order.material, icon: <Icon.Paintbrush /> },
                { label: "Tipo de terminación", value: order.termination_type || "---", icon: <Icon.Check /> },
                { label: "Tipo de orden", value: order.order_type, icon: <Icon.Package /> },
                { label: "Diseño", 
                  value: order.order_design_type === "INTERNAL_DESING" ? "Diseño interno" :
                         order.order_design_type === "EXTERNAL_DESING" ? "Diseño externo" : "---", 
                  icon: <Icon.Edit /> },
                { label: "Fecha entrega", value: order.delivery_date || "Indefinida", icon: <Icon.Calendar /> },
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
                <StatusBadge status={order.status} />
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
            </div>

            {/* Botón Enviar a Diseño / Cotización */}
            {order.status !== "In_Design" && order.status !== "en produccion" && order.status !== "en entrega" && order.status !== "completada" && order.status !== "cancelada" && order.status !== "in_Quotation" && order.status !== "cotizacion" && (
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
                    <Icon.Edit style={{ width: 18, height: 18 }} />
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
                    <Icon.Edit style={{ width: 18, height: 18 }} />
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
                { label: "ID Orden", value: order.id?.slice(0, 8), icon: <Icon.Key /> },
                { label: "Creada", value: created, icon: <Icon.Clock /> },
                { label: "Responsable", value: user?.displayName || "---", icon: <Icon.User /> },
                ...(order.designer_id ? [{ label: "Diseñador", value: designerName || "Asignado", icon: <Icon.Edit style={{ color: "#8B5CF6" }} /> }] : []),
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
                  <Icon.Eye /> Orden de Trabajo
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
                  <Icon.Brush /> Diseño del cliente
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
                        <Icon.Receipt style={{ fontSize: 24 }} />
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
                            <Icon.FileText />
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
function SendToDesignerModal({ open, onClose, onConfirm, order, loading }) {
  const [designers, setDesigners] = useState([]);
  const [selectedDesigner, setSelectedDesigner] = useState("");
  const [loadingDesigners, setLoadingDesigners] = useState(true);

  useEffect(() => {
    if (open) {
      setLoadingDesigners(true);
      setSelectedDesigner("");
      // Consultar diseñadores desde profiles (que tiene el nombre sincronizado desde auth)
      supabase
        .from("profiles")
        .select("id, name, role")
        .then(({ data, error }) => {
          setLoadingDesigners(false);
          console.log("Todos los perfiles:", data, error);
          if (!error && data) {
            // Filtrar manualmente por rol que contenga "design"
            const designers = data
              .filter(p => p.role && p.role.toLowerCase().includes("design"))
              .map(p => ({
                ...p,
                // Usar el nombre del perfil como display_name
                displayName: p.name || "Diseñador"
              }));
            console.log("Diseñadores filtrados:", designers);
            setDesigners(designers);
          } else {
            setDesigners([]);
          }
        });
    }
  }, [open]);

  const handleConfirm = () => {
    if (selectedDesigner) {
      onConfirm(selectedDesigner);
    }
  };

  const getDesignerName = (designer) => {
    return designer.displayName || designer.name || "Diseñador";
  };

  return (
    <Modal open={open} onClose={onClose} title="Enviar a Diseño">
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
            background: "linear-gradient(135deg, #EDE9FE 0%, #C4B5FD 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(139, 92, 246, 0.25)"
          }}>
            <Icon.Edit style={{ color: "#7C3AED", width: 28, height: 28 }} />
          </div>
        </div>
        
        <p style={{ fontSize: 15, color: "#374151", marginBottom: 12, lineHeight: 1.5, textAlign: "center", fontWeight: 500 }}>
          Selecciona el diseñador responsable
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
        
        {loadingDesigners ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#6B7280" }}>
            Cargando diseñadores...
          </div>
        ) : designers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#EF4444" }}>
            No hay diseñadores disponibles
          </div>
        ) : (
          <div style={{ marginBottom: 24 }}>
            <select 
              value={selectedDesigner} 
              onChange={(e) => {
                setSelectedDesigner(e.target.value);
              }}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                fontFamily: "'Poppins', sans-serif",
                background: "#fff",
                color: "#374151",
                cursor: "pointer",
                outline: "none"
              }}
            >
              <option value="">Seleccionar diseñador...</option>
              {designers.map(d => (
                <option key={d.id} value={d.id}>
                  {getDesignerName(d)}
                </option>
              ))}
            </select>
          </div>
        )}
        
        {loading && (
          <div style={{ textAlign: "center", padding: "12px 0", color: "#8B5CF6", fontSize: 14 }}>
            Enviando orden...
          </div>
        )}
        
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
            onClick={handleConfirm}
            disabled={loading || !selectedDesigner}
            style={{ 
              background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)", 
              border: "1px solid #6D28D9",
              boxShadow: "0 2px 8px rgba(139, 92, 246, 0.3)",
              opacity: (!selectedDesigner || loading) ? 0.6 : 1
            }}
          >
            {loading ? "Enviando..." : "Asignar Orden"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── CANCELAR ORDEN VENTANA DE COMFIRMACION ───────────────────────────────────────────
function CancelOrderModal({ open, onClose, onConfirm, order, loading }) {
  return (
    <Modal open={open} onClose={onClose} title="Cancelar Orden">
      <div style={{ minWidth: 350, paddingTop: 8 }}>
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
            onClick={onConfirm}
            disabled={loading}
            style={{ background: "#EF4444", border: "1px solid #DC2626" }}
          >
            {loading ? "Cancelando..." : "Si, cancelar orden"}
          </button>
        </div>
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
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [viewMode, setViewMode] = useState("table");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cancelingOrder, setCancelingOrder] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [archivedingOrder , setArchivedingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [sendingToDesigner, setSendingToDesigner] = useState(null);
  const [designers, setDesigners] = useState([]);
  const [sendingLoading, setSendingLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 1500);
  };

  // Obtener usuario y ordenes al cargar la pagina
  useEffect(() => {
    let isFirstLoad = true;

    // Listener para detectar cuando la sesión expire
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Solo procesar cuando es SIGNED_IN (no TOKEN_REFRESHED)
      if (event === 'SIGNED_IN' && session?.user) {
        // Extraer nombre desde user_metadata
        const displayName = 
          session.user.user_metadata?.display_name ||
          session.user.user_metadata?.full_name || 
          session.user.user_metadata?.name || 
          session.user.user_metadata?.first_name || 
          session.user.email?.split("@")[0];
        
        // Solo actualizar si es la primera carga o si el nombre es diferente
        if (isFirstLoad || displayName) {
          setUser({ ...session.user, displayName });
          fetchOrders(session.user.id);
          isFirstLoad = false;
        }
      } else if (event === 'SIGNED_OUT') {
        navigate("/");
      }
    });

    // Carga inicial
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

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Funcion para obtener las ordenes desde Supabase
  const fetchOrders = async (sellerId) => {
    // Si no hay sellerId, no hacer la consulta
    if (!sellerId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const idToUse = sellerId || user?.id;
    console.log("User ID:", idToUse);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("seller_id", idToUse)
      .order("created_at", { ascending: false });
    console.log("Orders data:", data);
    console.log("Error:", error);
    if (!error && Array.isArray(data)) {
      setOrders(data);
    } else {
      setOrders([]);
    }
    setLoading(false);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  // ── Funcion para cancelar orden ───────────────────────────────────────────────────────
  const handleCancelOrder = (order) => {
    setCancelingOrder(order);
  };

  const handleConfirmCancel = async () => {
    if (!cancelingOrder) return;
    
    setCancelLoading(true);
    const { error } = await supabase.from("orders").update({ status: "cancelada" }).eq("id", cancelingOrder.id);
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
  const handleSendToQuotation = async (order) => {
    setSendingLoading(true);
    const { error } = await supabase
      .from("orders")
      .update({ status: "in_Quotation" })
      .eq("id", order.id);

    setSendingLoading(false);

    if (error) {
      console.error("Error al enviar a cotización:", error);
    }

    setSelectedOrder(null);
    fetchOrders(user?.id);
  };

  const handleConfirmSendToDesigner = async (designerId) => {
    if (!sendingToDesigner) return;

    setSendingLoading(true);

    // Actualizar la orden con el diseñador y cambiar estado a en diseno
    const { error } = await supabase
      .from("orders")
      .update({ 
        status: "In_Design",
        designer_id: designerId
      })
      .eq("id", sendingToDesigner.id);

    setSendingLoading(false);

    if (error) {
      showToast("Error al enviar a diseño", "error");
      return;
    }

    // Fetch updated orders and then update selectedOrder with new data
    const fetchAndUpdate = async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("id", sendingToDesigner.id)
        .single();
      
      if (data) {
        setSelectedOrder(data);
      }
    };

    setSendingToDesigner(null);
    await fetchOrders(user?.id);
    await fetchAndUpdate();
    showToast("Orden enviada a diseño exitosamente!");
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

    setArchivedingOrder(null);
    fetchOrders(user?.id);
  };

  // ── Metrics Values ─────────────────────────────────────────────────────────────
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today).length;
  const inQuote = orders.filter(o => ["Pending", "Pendiente"].includes(o.status)).length;
  const inDesign = orders.filter(o => o.status === "In_Design").length;
  const inCotizacion = orders.filter(o => ["in_Quotation", "cotizacion"].includes(o.status)).length;
  const inProd = orders.filter(o => o.status === "en produccion").length;
  const inTerminacion = orders.filter(o => o.status === "terminacion").length;
  const completed = orders.filter(o => o.status === "completada").length;

  // Funcionalidad para filtrar las ordenes
  const filtered = orders.filter(o => {
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
    
    // Si hay filtro de fecha activo, mostrar todas las órdenes (incluidas archivadas)
    const isDateFilterActive = filterDate !== "all";
    
    return (
      (!q || o.client_name?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q)) &&
      (isDateFilterActive ? true :
        (filterStatus === "all" ? !o.is_archived : 
          (filterStatus === "archivada" ? o.is_archived === true : 
            o.status === filterStatus))) &&
      (filterPayment === "all" || o.payment_status === filterPayment) &&
      dateMatch
    );
  });

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
    { id: "orders", label: "Ordenes", icon: <Icon.Orders />, badge: orders.filter(o => !o.is_archived).length },
  ];

  // Valores para las cartas metricas
  const metrics = [
    { icon: <Icon.Orders />, label: "Ordenes hoy", value: todayOrders, sub: "Creadas por ti", accentIdx: 0, trend: 12 },
    { icon: <Icon.Package />, label: "Pendientes", value: inQuote, sub: "Ordenes Pendientes", accentIdx: 1 },
    { icon: <Icon.Edit />, label: "En diseño", value: inDesign, sub: "En proceso de diseño", accentIdx: 2 },
    { icon: <Icon.Package />, label: "En cotización", value: inCotizacion, sub: "Esperando aprobación", accentIdx: 1 },
    { icon: <Icon.Package />, label: "En producción", value: inProd, sub: "Siendo impresas", accentIdx: 3 },
    { icon: <Icon.Package />, label: "Terminación", value: inTerminacion, sub: "En proceso final", accentIdx: 2 },
    { icon: <Icon.Truck />, label: "Completadas", value: completed, sub: "Entregadas al cliente", accentIdx: 4, trend: 8 },
  ];

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
              {sidebarOpen ? <Icon.ChevronLeft /> : <Icon.ChevronRight />}
            </button>
            <div>
              <div className="ps-page-title">{activeTab === "dashboard" ? "Dashboard" : "Gestion de Ordenes"}</div>
              <div className="ps-page-date">{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          </div>
          <div className="ps-topbar-right">
            <button className="ps-icon-btn" onClick={() => fetchOrders(user?.id)}><Icon.Refresh /></button>
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
                    Ver todas <Icon.ArrowRight />
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
                                  <Icon.Eye />
                                </button>
                                {!o.is_archived && (
                                  <button className="table-action-btn edit" onClick={e => { e.stopPropagation(); setEditingOrder(o); }} title="Editar orden">
                                    <Icon.Edit />
                                  </button>
                                )}
                                {o.status === "cancelada" && (
                                  o.is_archived ? (
                                    <button 
                                      className="table-action-btn archive"
                                      title="Orden archivada"
                                      disabled
                                    >
                                      <Icon.Check />
                                    </button>
                                  ) : (
                                    <button 
                                      className="table-action-btn archive"
                                      onClick={e => { e.stopPropagation(); handleArchiveOrder(o); }}
                                      title="Archivar orden"
                                    >
                                      <Icon.Archived />
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
                  <span className="ps-search-icon"><Icon.Search /></span>
                  <input className="ps-input with-icon" placeholder="Buscar por cliente, descripcion o ID..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="ps-select-wrap">
                    <select className="ps-input" style={{ minWidth: 130, paddingRight: 32, cursor: "pointer", appearance: "none" }}
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
                    <span className="ps-select-arrow"><Icon.ChevronDown /></span>
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
                              <td className="td-pad td-actions">
                                <div className="table-actions">
                                  <button className="table-action-btn view" onClick={() => handleViewOrder(o)} title="Ver detalles">
                                    <Icon.Eye />
                                  </button>
                                  {!o.is_archived && (
                                    <button className="table-action-btn edit" onClick={() => setEditingOrder(o)} title="Editar orden">
                                      <Icon.Edit />
                                    </button>
                                  )}
                                  {o.status !== "cancelada" && !o.is_archived && (
                                    <button 
                                      className="table-action-btn cancel" 
                                      onClick={() => handleCancelOrder(o)} 
                                      title="Cancelar orden"
                                    >
                                      <Icon.Trash />
                                    </button>
                                  )}
                                  {o.status === "cancelada" && (
                                    o.is_archived ? (
                                      <button 
                                        className="table-action-btn archive"
                                        title="Orden archivada"
                                        disabled
                                      >
                                        <Icon.Check />
                                      </button>
                                    ) : (
                                      <button 
                                        className="table-action-btn archive"
                                        onClick={() => handleArchiveOrder(o)}
                                        title="Archivar orden"
                                      >
                                        <Icon.Archived />
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
                      filtered.map(o => (
                        <div key={o.id} className="ps-order-card" onClick={() => handleViewOrder(o)}>
                          <div className="ps-order-card-header">
                            <span className="ps-order-card-id">#{o.id?.slice(0, 8).toUpperCase() || "---"}</span>
                            <StatusBadge status={o.status} />
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
                          <div className="ps-order-card-actions" onClick={e => e.stopPropagation()}>
                            <button className="card-action-btn view" onClick={() => handleViewOrder(o)} title="Ver detalles">
                              <Icon.Eye />
                            </button>
                            {!o.is_archived && (
                              <button className="card-action-btn edit" onClick={() => setEditingOrder(o)} title="Editar">
                                <Icon.Edit />
                              </button>
                            )}
                            {o.status !== "cancelada" && !o.is_archived && (
                              <button className="card-action-btn cancel" onClick={() => handleCancelOrder(o)} title="Cancelar">
                                <Icon.Trash />
                              </button>
                            )}
                            {o.status === "cancelada" && !o.is_archived && (
                              <button className="card-action-btn archive" onClick={() => handleArchiveOrder(o)} title="Archivar">
                                <Icon.Archived />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => fetchOrders(user?.id)} userId={user?.id} />
      <EditOrderModal open={!!editingOrder} onClose={() => setEditingOrder(null)} order={editingOrder} onUpdated={() => fetchOrders(user?.id)} />
      <OrderDetailModal open={!!selectedOrder} onClose={() => setSelectedOrder(null)} order={selectedOrder} user={user} onSendToDesigner={handleSendToDesigner} onSendToQuotation={handleSendToQuotation} />
      <SendToDesignerModal 
        open={!!sendingToDesigner} 
        onClose={() => setSendingToDesigner(null)} 
        order={sendingToDesigner} 
        onConfirm={handleConfirmSendToDesigner} 
        loading={sendingLoading} 
      />
      <CancelOrderModal open={!!cancelingOrder} onClose={() => setCancelingOrder(null)} order={cancelingOrder} onConfirm={handleConfirmCancel} loading={cancelLoading} />
      <ArchivedOrderModal open={!!archivedingOrder} onClose={() => setArchivedingOrder(null)} order={archivedingOrder} onConfirm={handleConfirmArchiveOrder} loading={archiveLoading} />
      
      {/* Toast Notification */}
      {toast && (
        <div className="ps-toast">
          <div className="ps-toast-icon">
            {toast.type === "success" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <span className="ps-toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  );
}