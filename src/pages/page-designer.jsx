// DESIGNER PAGE - ORDER DASHBOARD FOR DESIGNERS

import { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "../css-components/page-designer.css";
import Sidebar from "../components/Sidebar";

// Icones SVG para la interfaz
const Icon = {
  Dashboard: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>),
  Orders: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>),
  Logout: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>),
  Eye: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>),
  Close: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  ChevronDown: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>),
  Upload: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>),
  Image: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>),
  File: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>),
  Trash: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>),
  Menu: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>),
  Clock: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>),
  User: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>),
  Check: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>),
  Download: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>),
  X: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>),
  Send: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>),
  Package: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>),
};

// Configuración de estados y pagos para badges
const STATUS_CONFIG = {
  "Pending": { label: "Pendiente", value: "Pending", color: "#92620A", bg: "#FEF3C7", dot: "#F59E0B" },
  "In_Design": { label: "En Diseño", value: "In_Design", color: "#5B21B6", bg: "#EDE9FE", dot: "#8B5CF6" },
  "cotizacion": { label: "Cotización", value: "cotizacion", color: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" },
  "en produccion": { label: "En Producción", value: "en produccion", color: "#9A3412", bg: "#FFF7ED", dot: "#F97316" },
  "terminacion": { label: "Terminación", value: "terminacion", color: "#0369A1", bg: "#E0F2FE", dot: "#0284C7" },
  "en entrega": { label: "En Entrega", value: "en entrega", color: "#065F46", bg: "#ECFDF5", dot: "#10B981" },
  "completada": { label: "Completada", value: "completada", color: "#14532D", bg: "#DCFCE7", dot: "#22C55E" },
  "cancelada": { label: "Cancelada", value: "cancelada", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
  "cancelled": { label: "Cancelada", value: "cancelled", color: "#991B1B", bg: "#FEF2F2", dot: "#EF4444" },
};

// Colores y etiquetas para estados de pago
const PAYMENT_CONFIG = {
  "pagado": { label: "Pagado", color: "#14532D", bg: "#DCFCE7" },
  "Pending_Payment": { label: "Pago Pendiente", color: "#92620A", bg: "#FEF3C7" },
  "parcial": { label: "Parcial", color: "#0369A1", bg: "#E0F2FE" },
};

// Badge component para mostrar estado de la orden
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["Pending"];
  return (
    <span className="pd-badge" style={{ background: cfg.bg, color: cfg.color }}>
      <span className="pd-badge-dot" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ status }) {
  const cfg = PAYMENT_CONFIG[status] || PAYMENT_CONFIG["Pending_Payment"];
  return (
    <span className="pd-payment-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

const NOTIFICATION_DURATION = 5000;
const EDITED_ORDERS_STORAGE_KEY = "pd_edited_orders";
const TRACKED_ORDER_FIELDS = [
  "client_name",
  "seller_name",
  "client_contact",
  "order_type",
  "created_at",
  "description",
  "material",
];

const normalizeTrackedValue = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const hasTrackedOrderChanges = (previousOrder, nextOrder) => {
  return TRACKED_ORDER_FIELDS.some(field => (
    normalizeTrackedValue(previousOrder?.[field]) !== normalizeTrackedValue(nextOrder?.[field])
  ));
};

function NotificationToast({ notification, onClose }) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const updateProgress = () => {
      const remaining = notification.expiresAt - Date.now();
      const nextProgress = Math.max(0, (remaining / notification.duration) * 100);
      setProgress(nextProgress);
    };

    updateProgress();

    const interval = setInterval(updateProgress, 50);
    return () => clearInterval(interval);
  }, [notification.duration, notification.expiresAt]);

  return (
    <div className={`pd-notification ${notification.type}`} role="status" aria-live="polite">
      <div className="pd-notification-main">
        <div className="pd-notification-icon">
          {notification.type === "cancelled" ? <Icon.X /> : <Icon.Package />}
        </div>

        <div className="pd-notification-content">
          <span className="pd-notification-title">{notification.label}</span>
          <span className="pd-notification-subtitle">{notification.orderTitle}</span>
          <span className="pd-notification-text">{notification.message}</span>
        </div>

        <button
          type="button"
          className="pd-notification-close"
          onClick={() => onClose(notification.id)}
          aria-label="Cerrar notificación"
        >
          <Icon.X />
        </button>
      </div>

      <div className="pd-notification-progress-track">
        <div
          className="pd-notification-progress"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

const getFilesCountFromDB = (order) => {
  if (!order?.order_file_url) return 0;
  try {
    const urls = JSON.parse(order.order_file_url);
    return Array.isArray(urls) ? urls.length : 1;
  } catch {
    return 1;
  }
};

const hasPreview = (order, orderPreviews) => {
  return order?.preview_image || orderPreviews?.[order?.id];
};

const hasFiles = (order, orderFiles) => {
  const storageFiles = orderFiles?.[order?.id]?.length || 0;
  const dbFiles = getFilesCountFromDB(order);
  return storageFiles > 0 || dbFiles > 0;
};

function OrderDetailModal({ open, onClose, order, designerFiles, designerPreview, onRefresh, onSendToQuotation, quotationSending }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  
  if (!order) return null;
  
  const created = new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
  const canEditDesignerAssets = order.status === "In_Design";
  const isCancelledReadonly = order.is_archived_designer && ["cancelada", "cancelado", "cancelled"].includes(order.status);
  const readonlyMessage =
    isCancelledReadonly
      ? "Esta orden está en modo lectura porque fue cancelada."
      : order.status === "cotizacion"
        ? "Esta orden está en modo lectura mientras permanece en cotización."
        : "Esta orden está en modo lectura según su estado actual.";
  
  const handleFileSelect = (e) => {
    if (!canEditDesignerAssets) return;
    const files = Array.from(e.target.files);
    setPendingFiles(prev => [...prev, ...files]);
    setSaveSuccess(false);
  };
  
  const handlePreviewSelect = (e) => {
    if (!canEditDesignerAssets) return;
    if (e.target.files && e.target.files[0]) {
      setPendingPreview(e.target.files[0]);
      setSaveSuccess(false);
    }
  };
  
  const removePendingFile = (index) => {
    if (!canEditDesignerAssets) return;
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
    setSaveSuccess(false);
  };
  
  const handleSave = async () => {
    if (!canEditDesignerAssets) return;
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    
    try {
      const updateData = {};
      
      if (pendingFiles.length > 0) {
        const fileUrls = [];
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          const fileName = `${Date.now()}-${i}-${file.name}`;
          
          const { data, error } = await supabase.storage
            .from("order-docs")
            .upload(`orders/${order.id}/files/${fileName}`, file, { upsert: true });
          
          if (!error && data) {
            const { data: { publicUrl } } = supabase.storage
              .from("order-docs")
              .getPublicUrl(`orders/${order.id}/files/${fileName}`);
            fileUrls.push(publicUrl);
          }
        }
        
        if (fileUrls.length > 0) {
          const { data: orderData } = await supabase
            .from("orders")
            .select("order_file_url")
            .eq("id", order.id)
            .single();
          
          let existingUrls = [];
          if (orderData?.order_file_url) {
            try {
              existingUrls = JSON.parse(orderData.order_file_url);
              if (!Array.isArray(existingUrls)) existingUrls = [existingUrls];
            } catch { existingUrls = []; }
          }
          
          updateData.order_file_url = JSON.stringify([...existingUrls, ...fileUrls]);
        }
      }
      
      if (pendingPreview) {
        const fileName = `preview-${Date.now()}.${pendingPreview.name.split('.').pop()}`;
        const { data, error } = await supabase.storage
          .from("order-previews")
          .upload(`orders/${order.id}/preview/${fileName}`, pendingPreview, { upsert: true });
        
        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from("order-previews")
            .getPublicUrl(`orders/${order.id}/preview/${fileName}`);
          updateData.preview_image = publicUrl;
        }
      }
      
      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from("orders")
          .update(updateData)
          .eq("id", order.id);
        
        if (updateError) throw updateError;
      }
      
      if (onRefresh) onRefresh();
      
      setPendingFiles([]);
      setPendingPreview(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving:", error);
      setSaveError("Error al guardar los archivos");
    }
    
    setSaving(false);
  };
  
  const handleClose = () => {
    setPendingFiles([]);
    setPendingPreview(null);
    setSaveSuccess(false);
    setSaveError(null);
    onClose();
  };
  
  const hasChanges = pendingFiles.length > 0 || pendingPreview !== null;
  
  const dbFiles = (() => {
    if (!order.order_file_url) return [];
    try {
      const urls = JSON.parse(order.order_file_url);
      const arr = Array.isArray(urls) ? urls : [urls];
      return arr.map((url, i) => ({
        name: url.split('/').pop() || `archivo-${i + 1}`,
        url: url
      }));
    } catch {
      return [{ name: order.order_file_url.split('/').pop(), url: order.order_file_url }];
    }
  })();
  
  const allFiles = [...(designerFiles || []), ...dbFiles];
  const uniqueFiles = allFiles.filter((f, i, arr) => arr.findIndex(x => x.url === f.url) === i);
  const displayPreview = pendingPreview ? URL.createObjectURL(pendingPreview) : (designerPreview || order.preview_image);
  const canSendToQuotation = canEditDesignerAssets && uniqueFiles.length > 0 && !hasChanges;
  
  return (
    <div className="pd-modal-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="pd-modal">
        <div className="pd-modal-header">
          <div className="pd-modal-title">
            <h3>Orden #{order.id?.slice(0, 8).toUpperCase()}</h3>
            <span className="pd-modal-subtitle">Detalles de la orden de trabajo</span>
          </div>
          <button className="pd-modal-close" onClick={handleClose}>
            <Icon.Close />
          </button>
        </div>
        
        <div className="pd-modal-body">
          {saveSuccess && (
            <div className="pd-alert pd-alert-success">
              <Icon.Check />
              Archivos guardados correctamente
            </div>
          )}
          
          {saveError && (
            <div className="pd-alert pd-alert-error">
              <Icon.X />
              {saveError}
            </div>
          )}
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icon.User />
              <h4>Información del Cliente</h4>
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item">
                <span className="pd-modal-label">Cliente</span>
                <span className="pd-modal-value">{order.client_name || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Vendedor</span>
                <span className="pd-modal-value highlight">{order.seller_name || "No especificado"}</span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Teléfono</span>
                {order.client_contact ? (
                  <a 
                    href={`https://wa.me/${order.client_contact.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pd-whatsapp-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    {order.client_contact}
                  </a>
                ) : <span className="pd-modal-value">No especificado</span>}
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Tipo de Orden</span>
                <span className="pd-modal-value">
                  {order.order_type === "orden 911" ? (
                    <span className="pd-badge-911">⚡ 911 - Urgente</span>
                  ) : (
                    <span className="pd-badge-normal">Normal</span>
                  )}
                </span>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Fecha de Creación</span>
                <span className="pd-modal-value">{created}</span>
              </div>
            </div>
          </div>
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icon.Package />
              <h4>Detalles del Trabajo</h4>
            </div>
            <div className="pd-modal-grid">
              <div className="pd-modal-item full">
                <span className="pd-modal-label">Descripción</span>
                <p className="pd-modal-description">{order.description || "Sin descripción"}</p>
              </div>
              <div className="pd-modal-item">
                <span className="pd-modal-label">Material</span>
                <span className="pd-modal-value highlight">{order.material || "No especificado"}</span>
              </div>
              {order.width && order.height && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Dimensiones</span>
                  <span className="pd-modal-value">{order.width} x {order.height} cm</span>
                </div>
              )}
              {order.quantity && (
                <div className="pd-modal-item">
                  <span className="pd-modal-label">Cantidad</span>
                  <span className="pd-modal-value">{order.quantity} unidades</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icon.File />
              <h4>Archivos del Diseño</h4>
              {hasChanges && <span className="pd-pending-badge">Cambios pendientes</span>}
            </div>

            {!canEditDesignerAssets && (
              <div className={`pd-readonly-note ${isCancelledReadonly ? "pd-readonly-note-cancelled" : ""}`}>
                <Icon.Check />
                {readonlyMessage}
              </div>
            )}
            
            {canEditDesignerAssets ? (
              <div className="pd-upload-area">
                <input
                  type="file"
                  id="designer-file-upload"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <label htmlFor="designer-file-upload" className="pd-upload-btn">
                  <Icon.Upload />
                  <span>Subir Archivos</span>
                </label>
                <span className="pd-upload-hint">Archivos seleccionados se guardarán al hacer clic en "Guardar cambios"</span>
              </div>
            ) : (
              <div className="pd-upload-area pd-upload-area-disabled">
                <Icon.File />
                <span className="pd-upload-hint">Los archivos ya no se pueden modificar después de enviarse a cotización.</span>
              </div>
            )}
            
            {pendingFiles.length > 0 && (
              <div className="pd-files-container">
                <span className="pd-files-label">Archivos pendientes ({pendingFiles.length})</span>
                {pendingFiles.map((file, i) => (
                  <div key={i} className="pd-file-card pending">
                    <div className="pd-file-icon">
                      <Icon.File />
                    </div>
                    <div className="pd-file-info">
                      <span className="pd-file-name">{file.name}</span>
                    </div>
                    <div className="pd-file-actions">
                      <button className="pd-file-action remove" onClick={() => removePendingFile(i)}>
                        <Icon.X />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {uniqueFiles.length > 0 && (
              <div className="pd-files-container" style={{ marginTop: pendingFiles.length > 0 ? '12px' : '0' }}>
                <span className="pd-files-label">Archivos guardados ({uniqueFiles.length})</span>
                {uniqueFiles.map((file, i) => (
                  <div key={i} className="pd-file-card">
                    <div className="pd-file-icon">
                      <Icon.File />
                    </div>
                    <div className="pd-file-info">
                      <span className="pd-file-name">{file.name}</span>
                    </div>
                    <div className="pd-file-actions">
                      <a href={file.url} target="_blank" rel="noopener noreferrer" className="pd-file-action">
                        <Icon.Download />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="pd-modal-card">
            <div className="pd-modal-card-title">
              <Icon.Image />
              <h4>Vista Previa</h4>
            </div>
            
            <div className="pd-preview-container">
              {displayPreview ? (
                <>
                  <img src={displayPreview} alt="Preview" className="pd-preview-image" />
                  {pendingPreview && <span className="pd-preview-badge">Nuevo</span>}
                  <div className="pd-preview-overlay">
                    <a href={displayPreview} target="_blank" rel="noopener noreferrer" className="pd-file-action" style={{ background: 'white', color: '#0f172a' }}>
                      <Icon.Eye />
                    </a>
                    {canEditDesignerAssets && (
                      <button className="pd-file-action remove" style={{ background: 'white' }} onClick={() => { setPendingPreview(null); setSaveSuccess(false); }}>
                        <Icon.Trash />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                canEditDesignerAssets ? (
                  <label htmlFor="designer-preview-upload" className="pd-preview-empty">
                    <input
                      type="file"
                      id="designer-preview-upload"
                      accept="image/*"
                      onChange={handlePreviewSelect}
                      style={{ display: "none" }}
                    />
                    <Icon.Image />
                    <span>Subir imagen de preview</span>
                  </label>
                ) : (
                  <div className="pd-preview-empty pd-preview-empty-disabled">
                    <Icon.Image />
                    <span>La preview permanece disponible solo para consulta.</span>
                  </div>
                )
              )}
            </div>
          </div>
          
          <div className="pd-status-bar">
            <div className="pd-status-item">
              <span className="pd-status-label">Estado</span>
              <StatusBadge status={order.status} />
            </div>
            <div className="pd-status-item">
              <span className="pd-status-label">Pago</span>
              <PaymentBadge status={order.payment_status} />
            </div>
          </div>
        </div>
        
        <div className="pd-modal-footer">
          <button className="pd-btn pd-btn-secondary" onClick={handleClose}>
            Cerrar
          </button>
          {canSendToQuotation && (
            <button
              className="pd-btn pd-btn-quotation"
              onClick={() => onSendToQuotation?.(order)}
              disabled={quotationSending}
            >
              {quotationSending ? (
                <>
                  <span className="pd-btn-spinner"></span>
                  Enviando...
                </>
              ) : (
                <>
                  <Icon.Send />
                  Enviar a cotización
                </>
              )}
            </button>
          )}
          <button 
            className="pd-btn pd-btn-primary" 
            onClick={handleSave}
            disabled={!canEditDesignerAssets || !hasChanges || saving}
          >
            {saving ? (
              <>
                <span className="pd-btn-spinner"></span>
                Guardando...
              </>
            ) : (
              <>
                <Icon.Check />
                Guardar cambios
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SendToQuotationModal({ open, onClose, onConfirm, order, loading }) {
  const [quoteUsers, setQuoteUsers] = useState([]);
  const [selectedQuoteUser, setSelectedQuoteUser] = useState("");
  const [loadingQuoteUsers, setLoadingQuoteUsers] = useState(true);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;

    setLoadingQuoteUsers(true);
    setSelectedQuoteUser("");
    setLocalError("");

    supabase
      .from("profiles")
      .select("id, name, role")
      .then(({ data, error }) => {
        setLoadingQuoteUsers(false);

        if (error) {
          setQuoteUsers([]);
          setLocalError("No se pudieron cargar los usuarios de cotización.");
          return;
        }

        const quotes = (data || [])
          .filter(profile => profile.role && profile.role.toLowerCase().includes("quote"))
          .map(profile => ({
            ...profile,
            displayName: profile.name || "Cotizador",
          }));

        setQuoteUsers(quotes);

        if (quotes.length === 0) {
          setLocalError("No hay usuarios con rol Quote disponibles.");
        }
      });
  }, [open]);

  if (!open || !order) return null;

  const handleConfirm = () => {
    if (!selectedQuoteUser) {
      setLocalError("Debes seleccionar un usuario de cotización.");
      return;
    }

    setLocalError("");
    onConfirm(selectedQuoteUser);
  };

  return (
    <div className="pd-assign-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pd-assign-modal">
        <div className="pd-assign-icon">
          <Icon.Send />
        </div>

        <h3 className="pd-assign-title">Enviar a cotización</h3>
        <p className="pd-assign-text">
          Confirma que agregaste los archivos correctos antes de enviar esta orden al proceso de cotización.
        </p>

        <div className="pd-assign-order">
          <span className="pd-assign-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
          <span className="pd-assign-order-name">{order.client_name || order.description || "Orden sin título"}</span>
        </div>

        {loadingQuoteUsers ? (
          <div className="pd-assign-loading">Cargando usuarios de cotización...</div>
        ) : (
          <select
            className="pd-assign-select"
            value={selectedQuoteUser}
            onChange={(e) => {
              setSelectedQuoteUser(e.target.value);
              setLocalError("");
            }}
            disabled={loading || quoteUsers.length === 0}
          >
            <option value="">Seleccionar usuario Quote...</option>
            {quoteUsers.map((quoteUser) => (
              <option key={quoteUser.id} value={quoteUser.id}>
                {quoteUser.displayName}
              </option>
            ))}
          </select>
        )}

        {localError && <div className="pd-assign-error">{localError}</div>}

        <div className="pd-assign-actions">
          <button className="pd-btn pd-btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            className="pd-btn pd-btn-quotation"
            onClick={handleConfirm}
            disabled={loading || !selectedQuoteUser}
          >
            {loading ? (
              <>
                <span className="pd-btn-spinner"></span>
                Enviando...
              </>
            ) : (
              "Enviar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchiveDesignerOrderModal({ open, onClose, onConfirm, order, loading }) {
  if (!open || !order) return null;

  return (
    <div className="pd-assign-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pd-assign-modal">
        <div className="pd-assign-icon pd-assign-icon-archive">
          <Icon.File />
        </div>

        <h3 className="pd-assign-title">Archivar orden</h3>
        <p className="pd-assign-text">
          ¿Estás seguro de que deseas archivar esta orden?
        </p>

        <div className="pd-assign-order">
          <span className="pd-assign-order-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
          <span className="pd-assign-order-name">{order.client_name || order.description || "Orden sin título"}</span>
        </div>

        <div className="pd-assign-actions">
          <button className="pd-btn pd-btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button className="pd-btn pd-btn-archive" onClick={onConfirm} disabled={loading}>
            {loading ? (
              <>
                <span className="pd-btn-spinner"></span>
                Archivando...
              </>
            ) : (
              "Archivar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PageDesigner() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [viewMode, setViewMode] = useState("cards");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [viewedOrders, setViewedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem("pd_viewed_orders");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [editedOrders, setEditedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITED_ORDERS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [orderFiles, setOrderFiles] = useState({});
  const [orderPreviews, setOrderPreviews] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [sendingToQuotation, setSendingToQuotation] = useState(null);
  const [quotationSending, setQuotationSending] = useState(false);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  
  const ordersRef = useRef([]);
  const viewedOrdersRef = useRef({});
  const userRef = useRef(null);
  const knownOrderIdsRef = useRef(new Set());
  const previousOrdersRef = useRef({});
  const ordersInitializedRef = useRef(false);
  const notificationTimeoutsRef = useRef({});

  viewedOrdersRef.current = viewedOrders;

  useEffect(() => {
    localStorage.setItem("pd_viewed_orders", JSON.stringify(viewedOrders));
  }, [viewedOrders]);

  useEffect(() => {
    localStorage.setItem(EDITED_ORDERS_STORAGE_KEY, JSON.stringify(editedOrders));
  }, [editedOrders]);

  const removeNotification = (notificationId) => {
    setNotifications(prev => prev.filter(item => item.id !== notificationId));

    if (notificationTimeoutsRef.current[notificationId]) {
      clearTimeout(notificationTimeoutsRef.current[notificationId]);
      delete notificationTimeoutsRef.current[notificationId];
    }
  };

  const showActionNotification = ({ type = "completed", label, orderTitle, message }) => {
    const notificationId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification = {
      id: notificationId,
      type,
      label,
      orderTitle,
      message,
      duration: NOTIFICATION_DURATION,
      expiresAt: Date.now() + NOTIFICATION_DURATION,
    };

    setNotifications(prev => [notification, ...prev].slice(0, 3));

    notificationTimeoutsRef.current[notificationId] = setTimeout(() => {
      removeNotification(notificationId);
    }, NOTIFICATION_DURATION);
  };

  const createNotificationForOrder = (order, type = "new") => {
    const notificationId = `${type}-${order.id}`;

    if (notificationTimeoutsRef.current[notificationId]) return;

    const orderTitle =
      order.description ||
      order.client_name ||
      `Orden #${order.id?.slice(0, 8).toUpperCase()}`;

    const notificationConfig = {
      new: {
        label: "Nueva orden asignada",
        message: "Se ha creado una nueva orden para ti.",
      },
      cancelled: {
        label: "Orden cancelada",
        message: "Una de tus órdenes asignadas ha sido cancelada.",
      },
    };

    notificationConfig.updated = {
      label: "Orden editada",
      message: "Se actualizó la información de una orden asignada a ti.",
    };

    const notification = {
      id: notificationId,
      type,
      label: notificationConfig[type]?.label || "Notificación",
      orderTitle,
      message: notificationConfig[type]?.message || "Tienes una actualización en una orden.",
      duration: NOTIFICATION_DURATION,
      expiresAt: Date.now() + NOTIFICATION_DURATION,
    };

    setNotifications(prev => [notification, ...prev].slice(0, 3));

    notificationTimeoutsRef.current[notificationId] = setTimeout(() => {
      removeNotification(notificationId);
    }, NOTIFICATION_DURATION);
  };

  const handleViewOrder = async (order) => {
    setEditedOrders(prev => {
      if (!prev[order.id]) return prev;
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

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
    
    setViewedOrders(prev => {
      if (prev[order.id]) return prev;
      return { ...prev, [order.id]: Date.now() };
    });
  };

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/");
        return;
      }
      setUser(user);
      userRef.current = user;
    };
    getUser();
  }, [navigate]);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!userRef.current) return;

      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("designer_id", userRef.current.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        const nextOrderIds = new Set(data.map(order => order.id));
        const previousOrderIds = knownOrderIdsRef.current;
        const previousOrders = previousOrdersRef.current;

        if (!ordersInitializedRef.current) {
          knownOrderIdsRef.current = nextOrderIds;
          previousOrdersRef.current = data.reduce((acc, order) => {
            acc[order.id] = order;
            return acc;
          }, {});
          ordersInitializedRef.current = true;
          ordersRef.current = data;
          setOrders(data);
          setLoading(false);
          return;
        }

        data
          .filter(order => !previousOrderIds.has(order.id))
          .forEach(createNotificationForOrder);

        data.forEach(order => {
          const previousOrder = previousOrders[order.id];
          const wasCancelledBefore = ["cancelada", "cancelled"].includes(previousOrder?.status);
          const isCancelledNow = ["cancelada", "cancelled"].includes(order.status);

          if (previousOrder && !wasCancelledBefore && isCancelledNow) {
            createNotificationForOrder(order, "cancelled");
          }

          if (
            previousOrder &&
            !isCancelledNow &&
            hasTrackedOrderChanges(previousOrder, order)
          ) {
            setEditedOrders(prev => ({ ...prev, [order.id]: Date.now() }));
            createNotificationForOrder(order, "updated");
          }
        });

        knownOrderIdsRef.current = nextOrderIds;
        previousOrdersRef.current = data.reduce((acc, order) => {
          acc[order.id] = order;
          return acc;
        }, {});
        ordersRef.current = data;
        setOrders(data);
        setLoading(false);
      }
    };

    fetchOrders();
    
    const interval = setInterval(fetchOrders, 1500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(notificationTimeoutsRef.current).forEach(clearTimeout);
    };
  }, []);

  const isNewOrder = (order) => {
    if (viewedOrders[order.id]) return false;
    const createdAt = new Date(order.created_at).getTime();
    const hoursAgo = (Date.now() - createdAt) < 24 * 60 * 60 * 1000;
    return hoursAgo;
  };

  const isEditedOrder = (order) => {
    return !!editedOrders[order.id];
  };

  const isDesignerArchivable = (order) => {
    return ["cancelada", "cancelado", "cancelled"].includes(order.status);
  };

  const metrics = [
    { label: "Total Órdenes", value: orders.length, color: "#8B5CF6", icon: <Icon.Package /> },
    { label: "En Diseño", value: orders.filter(o => o.status === "In_Design").length, color: "#F59E0B", icon: <Icon.File /> },
    { label: "Cotización", value: orders.filter(o => o.status === "cotizacion").length, color: "#0EA5E9", icon: <Icon.Send /> },
    { label: "Completadas", value: orders.filter(o => o.status === "completada").length, color: "#10B981", icon: <Icon.Check /> },
  ];

  const filteredOrders = orders.filter((order) => {
    const query = search.trim().toLowerCase();
    const searchableValues = [
      order.client_name,
      order.description,
      order.id,
      order.material,
    ];

    const matchesSearch = !query || searchableValues.some((value) =>
      String(value || "").toLowerCase().includes(query)
    );

    const matchesType = filterType === "all" || (
      filterType === "911"
        ? order.order_type === "orden 911"
        : order.order_type !== "orden 911"
    );

    const matchesStatus = filterStatus === "all" || order.status === filterStatus;

    const matchesArchive =
      filterArchive === "all" ||
      (filterArchive === "active" && !order.is_archived_designer) ||
      (filterArchive === "archived" && order.is_archived_designer);

    const createdAt = new Date(order.created_at);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const matchesDate =
      filterDate === "all" ||
      (filterDate === "today" && createdAt >= startOfToday) ||
      (filterDate === "yesterday" && createdAt >= startOfYesterday && createdAt < startOfToday) ||
      (filterDate === "3days" && createdAt >= threeDaysAgo) ||
      (filterDate === "7days" && createdAt >= sevenDaysAgo) ||
      (filterDate === "month" && createdAt >= startOfMonth);

    return matchesSearch && matchesType && matchesStatus && matchesDate && matchesArchive;
  });

  const shouldEnableOrdersScroll = filteredOrders.length > 7;

  const fetchOrderFiles = async (orderId) => {
    try {
      const { data, error } = await supabase.storage
        .from("order-docs")
        .list(`orders/${orderId}/files/`);

      if (!error && data) {
        const files = data.map(f => ({
          name: f.name,
          url: supabase.storage.from("order-docs").getPublicUrl(`orders/${orderId}/files/${f.name}`).data.publicUrl
        }));
        setOrderFiles(prev => ({ ...prev, [orderId]: files }));
      }
    } catch (err) {
      console.error("Error fetching files:", err);
    }
  };

  const fetchOrderPreview = async (orderId) => {
    try {
      const { data, error } = await supabase.storage
        .from("order-previews")
        .list(`orders/${orderId}/preview/`);

      if (!error && data && data.length > 0) {
        const latest = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        const url = supabase.storage.from("order-previews").getPublicUrl(`orders/${orderId}/preview/${latest.name}`).data.publicUrl;
        setOrderPreviews(prev => ({ ...prev, [orderId]: url }));
      }
    } catch (err) {
      console.error("Error fetching preview:", err);
    }
  };

  useEffect(() => {
    orders.forEach(order => {
      fetchOrderFiles(order.id);
      fetchOrderPreview(order.id);
    });
  }, [orders]);

  const refreshOrderFromDB = async (orderId) => {
    const { data } = await supabase.from("orders").select("*").eq("id", orderId).single();
    if (data) {
      setOrders(prev => prev.map(o => o.id === orderId ? data : o));
      setSelectedOrder(data);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleOpenSendToQuotation = (order) => {
    setSendingToQuotation(order);
  };

  const handleOpenArchiveOrder = (order) => {
    setArchivingOrder(order);
  };

  const handleConfirmSendToQuotation = async (quoteUserId) => {
    if (!sendingToQuotation) return;

    setQuotationSending(true);

    const assignmentPayloads = [
      { status: "cotizacion", quote_id: quoteUserId },
      { status: "cotizacion", quotation_id: quoteUserId },
      { status: "cotizacion", quote_user_id: quoteUserId },
    ];

    let updateError = null;

    for (const payload of assignmentPayloads) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", sendingToQuotation.id);

      if (!error) {
        updateError = null;
        break;
      }

      updateError = error;
    }

    setQuotationSending(false);

    if (updateError) {
      showActionNotification({
        type: "cancelled",
        label: "Error al enviar",
        orderTitle: sendingToQuotation.client_name || sendingToQuotation.description || `Orden #${sendingToQuotation.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo enviar la orden a cotización. Verifica la asignación o el estado.",
      });
      return;
    }

    const updatedOrder = {
      ...sendingToQuotation,
      status: "cotizacion",
    };

    setOrders(prev => prev.map(order => (
      order.id === sendingToQuotation.id ? { ...order, status: "cotizacion" } : order
    )));
    setSelectedOrder(updatedOrder);
    setSendingToQuotation(null);

    showActionNotification({
      type: "completed",
      label: "Enviada a cotización",
      orderTitle: updatedOrder.client_name || updatedOrder.description || `Orden #${updatedOrder.id?.slice(0, 8).toUpperCase()}`,
      message: "La orden ha sido enviada a cotización correctamente.",
    });
  };

  const handleConfirmArchiveDesignerOrder = async () => {
    if (!archivingOrder) return;

    setArchiveLoading(true);

    const { error } = await supabase
      .from("orders")
      .update({ is_archived_designer: true })
      .eq("id", archivingOrder.id);

    setArchiveLoading(false);

    if (error) {
      showActionNotification({
        type: "cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
        message: "No se pudo archivar la orden.",
      });
      return;
    }

    setOrders(prev => prev.map(order => (
      order.id === archivingOrder.id
        ? { ...order, is_archived_designer: true }
        : order
    )));

    if (selectedOrder?.id === archivingOrder.id) {
      setSelectedOrder(prev => prev ? { ...prev, is_archived_designer: true } : prev);
    }

    showActionNotification({
      type: "completed",
      label: "Orden archivada",
      orderTitle: archivingOrder.client_name || archivingOrder.description || `Orden #${archivingOrder.id?.slice(0, 8).toUpperCase()}`,
      message: "La orden fue archivada correctamente.",
    });

    setArchivingOrder(null);
  };

  return (
    <div className="pd-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Diseñador"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Dashboard", icon: <Icon.Dashboard /> },
          { id: "orders", label: "Mis Órdenes", icon: <Icon.Orders />, badge: orders.length }
        ]}
        onLogout={handleLogout}
      />

      <main className="pd-main">
        <header className="pd-header">
          <button className="pd-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Icon.Menu />
          </button>
          <div className="pd-header-title">
            <h2>{activeTab === "dashboard" ? "Dashboard" : "Mis Órdenes"}</h2>
          </div>
        </header>

        <div className="pd-content">
          {activeTab === "dashboard" && (
            <>
              <div className="pd-greeting">
                <h2>Bienvenido, <span>{user?.displayName || "Diseñador"}</span></h2>
                <p>Estas son tus órdenes asignadas para trabajar.</p>
              </div>
              
              <div className="pd-metrics">
                {metrics.map((m, i) => (
                  <div key={i} className="pd-metric-card">
                    <div className="pd-metric-icon" style={{ background: m.color }}>
                      {m.icon}
                    </div>
                    <div className="pd-metric-info">
                      <span className="pd-metric-value">{m.value}</span>
                      <span className="pd-metric-label">{m.label}</span>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="pd-recent-section">
                <div className="pd-recent-header">
                  <h3>Órdenes Recientes</h3>
                  <span className="pd-recent-count">{orders.length} órdenes</span>
                </div>
                {loading ? (
                  <div className="pd-loading">Cargando órdenes...</div>
                ) : orders.length === 0 ? (
                  <div className="pd-empty">No tienes órdenes asignadas</div>
                ) : (
                  <div className="pd-recent-list">
                    {orders.slice(0, 5).map(order => (
                      <div key={order.id} className="pd-recent-item" onClick={() => handleViewOrder(order)}>
                        <div className="pd-recent-item-left">
                          <span className="pd-recent-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                          <span className="pd-recent-client">{order.client_name}</span>
                        </div>
                        <div className="pd-recent-item-center">
                          <span className="pd-recent-desc">
                            {order.description?.length > 60 
                              ? order.description.substring(0, 60) + '...' 
                              : order.description || 'Sin descripción'}
                          </span>
                        </div>
                        <div className="pd-recent-item-right">
                          <StatusBadge status={order.status} />
                          <PaymentBadge status={order.payment_status} />
                          <button className="pd-recent-view-btn" title="Ver detalle">
                            <Icon.Eye />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "orders" && (
            <>
              <div className="pd-filters">
                <div className="pd-search-wrap">
                  <span className="pd-search-icon"><Icon.Search /></span>
                  <input 
                    className="pd-input" 
                    placeholder="Buscar por cliente, ID o descripción..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="all">Todos los tipos</option>
                    <option value="normal">Normal</option>
                    <option value="911">911 - Urgente</option>
                  </select>
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">Todos los estados</option>
                    <option value="In_Design">En Diseño</option>
                    <option value="cotizacion">Cotización</option>
                    <option value="en produccion">En Producción</option>
                    <option value="completada">Completada</option>
                  </select>
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                    <option value="all">Todas las fechas</option>
                    <option value="today">Hoy</option>
                    <option value="yesterday">Ayer</option>
                    <option value="3days">Últimos 3 días</option>
                    <option value="7days">Últimos 7 días</option>
                    <option value="month">Este mes</option>
                  </select>
                </div>
                <div className="pd-select-wrap">
                  <select className="pd-input" value={filterArchive} onChange={e => setFilterArchive(e.target.value)}>
                    <option value="active">Activas</option>
                    <option value="archived">Archivadas</option>
                    <option value="all">Todas</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setViewMode("cards")} className={`pd-view-toggle ${viewMode === "cards" ? "active" : ""}`} title="Vista de tarjetas">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  </button>
                  <button onClick={() => setViewMode("table")} className={`pd-view-toggle ${viewMode === "table" ? "active" : ""}`} title="Vista de tabla">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                </div>
                <span className="pd-filters-count">{filteredOrders.length} orden{filteredOrders.length !== 1 ? "es" : ""}</span>
              </div>

              {loading ? (
                <div className="pd-loading">Cargando órdenes...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="pd-empty">No hay órdenes que coincidan con los filtros</div>
              ) : viewMode === "table" ? (
                <div className={`pd-table-wrap ${shouldEnableOrdersScroll ? "pd-orders-scroll" : ""}`}>
                  <table className="pd-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Descripción</th>
                        <th>Material</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                        <th>Pago</th>
                        <th>Fecha</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map(order => (
                        <tr key={order.id}>
                          <td className="pd-td-id">#{order.id?.slice(0, 8).toUpperCase()}</td>
                          <td className="pd-td-client">{order.client_name}</td>
                          <td className="pd-td-desc">{order.description}</td>
                          <td className="pd-td-material">{order.material}</td>
                          <td className="pd-td-type">
                            {order.order_type === "orden 911" ? <span className="pd-card-911">911</span> : <span className="pd-badge-normal-table">Normal</span>}
                          </td>
                          <td className="pd-td-status"><StatusBadge status={order.status} /></td>
                          <td className="pd-td-status"><PaymentBadge status={order.payment_status} /></td>
                          <td className="pd-td-date">{new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</td>
                          <td className="pd-td-actions">
                            <div className="pd-row-actions">
                              <button className="pd-action-btn view" onClick={() => handleViewOrder(order)}>Ver</button>
                              {isDesignerArchivable(order) && !order.is_archived_designer && (
                                <button className="pd-action-btn archive" onClick={() => handleOpenArchiveOrder(order)}>
                                  Archivar orden
                                </button>
                              )}
                              {isDesignerArchivable(order) && order.is_archived_designer && (
                                <button className="pd-action-btn archived" disabled>
                                  Archivada
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`pd-cards-grid ${shouldEnableOrdersScroll ? "pd-orders-scroll" : ""}`}>
                  {filteredOrders.map(order => (
                    <div key={order.id} className="pd-order-card">
                      <div className="pd-card-header">
                        <span className="pd-card-id">#{order.id?.slice(0, 8).toUpperCase()}</span>
                        <div className="pd-card-badges">
                          {isNewOrder(order) && <span className="pd-badge-new">Nuevo</span>}
                          {isEditedOrder(order) && <span className="pd-badge-edited">Editada</span>}
                          <StatusBadge status={order.status} />
                        </div>
                      </div>
                      <div className="pd-card-client">{order.client_name}</div>
                      <div className="pd-card-desc">{order.description}</div>
                      <div className="pd-card-meta">
                        <span className="pd-card-material">{order.material}</span>
                        {order.order_type === "orden 911" && <span className="pd-card-911">911</span>}
                        <PaymentBadge status={order.payment_status} />
                      </div>
                      <div className="pd-card-footer">
                        <div className="pd-card-footer-left">
                          <div className="pd-card-date">
                            <Icon.Clock />
                            {new Date(order.created_at).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}
                          </div>
                        </div>
                        <div className="pd-card-actions">
                          <button className="pd-view-btn" onClick={() => handleViewOrder(order)}>Ver</button>
                          {isDesignerArchivable(order) && !order.is_archived_designer && (
                            <button className="pd-action-btn archive" onClick={() => handleOpenArchiveOrder(order)}>
                              Archivar orden
                            </button>
                          )}
                          {isDesignerArchivable(order) && order.is_archived_designer && (
                            <button className="pd-action-btn archived" disabled>
                              Archivada
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {notifications.length > 0 && (
        <div className="pd-notification-stack">
          {notifications.map(notification => (
            <NotificationToast
              key={notification.id}
              notification={notification}
              onClose={removeNotification}
            />
          ))}
        </div>
      )}

      <OrderDetailModal 
        open={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        order={selectedOrder}
        designerFiles={selectedOrder ? orderFiles[selectedOrder.id] : []}
        designerPreview={selectedOrder ? orderPreviews[selectedOrder.id] : null}
        onSendToQuotation={handleOpenSendToQuotation}
        quotationSending={quotationSending}
        onRefresh={() => {
          if (selectedOrder) {
            fetchOrderFiles(selectedOrder.id);
            refreshOrderFromDB(selectedOrder.id);
          }
        }}
      />
      <SendToQuotationModal
        open={!!sendingToQuotation}
        onClose={() => setSendingToQuotation(null)}
        onConfirm={handleConfirmSendToQuotation}
        order={sendingToQuotation}
        loading={quotationSending}
      />
      <ArchiveDesignerOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveDesignerOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />
    </div>
  );
}
