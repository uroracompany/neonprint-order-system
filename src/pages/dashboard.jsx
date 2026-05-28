import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import Sidebar from "../components/Sidebar";
import { validateImage } from "../utils/imageValidation";
import {
  buildPaymentReceiptPath,
  buildStorageSafeFileName,
  createSignedOrderAssetUrlFromStoredUrl,
  removeOrderAssetByPublicUrl,
  uploadOrderAsset,
} from "../utils/uploadOrderAsset";
import { Icons } from "../utils/icons";
import { StatusBadge, PaymentBadge, RoleBadge } from "../components/ui/Badge";
import { AssignModal } from "../components/ui/AssignModal";
import { Pagination } from "../components/ui/Pagination";
import {
  ORDER_STATUS,
  STATUS_LABELS,
  PAYMENT_LABELS,
  MATERIAL_OPTIONS,
  QUOTE_ASSIGNMENT_FIELDS,
  STATUS_OPTIONS,
  getOrderStatusLabel,
  isOrderStatus,
  isOrderStatusIn,
  normalizeOrderStatus,
  normalizeText,
  formatDate,
  parseFileUrls,
  serializeFileUrls,
  getFileNameFromUrl,
  resolveSellerId,
  isAdminArchivable
} from "../utils/constants";
import { FlowTracker, FlowTrackerExternal } from "../components/FlowTracker";
import useNotifications from "../hooks/useNotifications";
import NotificationCenter from "../components/NotificationCenter";
import "../css-components/page-admin.css";
import "../css-components/page-seller.css";


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
  status: ORDER_STATUS.PENDING,
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

const resolveQuoteAssignmentId = (order) => QUOTE_ASSIGNMENT_FIELDS.map((field) => order?.[field]).find(Boolean) || null;
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


// Genera nombres únicos y legibles para los archivos que sube el administrador.
// Función uploadOrderAsset importada desde ../utils/uploadOrderAsset.js
// Para usar: uploadOrderAsset({ bucket, path, file })

// Funciones para obtener información de los perfiles de usuario con lógica de respaldo
// Funcion para obtener el nombre del usuario
const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";
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
    printer: "Producción",
    delivery: "Entregador"
  };
  return map[role] || role;
};

function ModalShell({ open, title, onClose, children, size = "default" }) {
  if (!open) return null;
  return (
    <div className="pa-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`pa-modal ${size}`}>
        <div className="pa-modal-head">
          <div className="pa-modal-copy"><span className="pa-modal-kicker">Administrador</span><h3>{title}</h3></div>
          <button className="pa-icon-btn pa-modal-close" onClick={onClose} aria-label="Cerrar modal"><Icons.Close /></button>
        </div>
        <div className="pa-modal-body">{children}</div>
      </div>
    </div>
  );
}

function OrderFormModal({ open, mode, orderForm, setOrderForm, onClose, onSubmit, saving }) {
  const [simpleMaterials, setSimpleMaterials] = useState([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("materials").select("name").order("name");
      setSimpleMaterials(data || []);
    };
    if (open) load();
  }, [open]);

  return (
    <ModalShell open={open} onClose={onClose} title={mode === "create" ? "Crear orden" : "Editar orden"} size="large">
      <div className="pa-form-grid">
        <label className="pa-field"><span>Cliente</span><input value={orderForm.client_name} onChange={(e) => setOrderForm(prev => ({ ...prev, client_name: e.target.value }))} /></label>
        <label className="pa-field"><span>Teléfono</span><input value={orderForm.client_contact} onChange={(e) => setOrderForm(prev => ({ ...prev, client_contact: e.target.value }))} /></label>
        <label className="pa-field full"><span>Descripción</span><textarea rows={3} value={orderForm.description} onChange={(e) => setOrderForm(prev => ({ ...prev, description: e.target.value }))} /></label>
        <label className="pa-field"><span>Material</span><select value={orderForm.material} onChange={(e) => setOrderForm(prev => ({ ...prev, material: e.target.value }))}><option value="">Seleccionar material</option>{simpleMaterials.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
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



// Modal de detalles de orden para admin
function AdminOrderDetailModal({ open, order, usersById, onClose, onEdit, onCancel, onAssign, onArchive }) {
  const [paymentInvoiceUrl, setPaymentInvoiceUrl] = useState("");

  useEffect(() => {
    let active = true;

    const loadPaymentInvoiceUrl = async () => {
      if (!open || !order?.invoice_payment) {
        if (active) setPaymentInvoiceUrl("");
        return;
      }

      const signedUrl = await createSignedOrderAssetUrlFromStoredUrl({
        bucket: "payment-invoice",
        url: order.invoice_payment,
      });

      if (active) {
        setPaymentInvoiceUrl(signedUrl || "");
      }
    };

    loadPaymentInvoiceUrl();

    return () => {
      active = false;
    };
  }, [open, order?.invoice_payment]);

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
  const paymentInvoice = paymentInvoiceUrl;

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
                    <Icons.Brush /> Diseño del cliente
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
                            <Icons.Receipt style={{ fontSize: 24 }} />
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
                            <Icons.Download style={{ fontSize: 24 }} />
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
                            <Icons.Download />
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
                                  <Icons.FileText />
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
                                  <Icons.Download />
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
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>{getOrderStatusLabel(order.status)}</span>
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

            <AdminTrackingLinkField orderId={order.id} />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="pa-btn primary" style={{ flex: 1 }} onClick={() => { onClose(); onEdit(order); }}>
              <Icons.Edit />Editar
            </button>
          </div>
          {isAdminArchivable(order) && !order.is_archived_admin && (
            <button className="pa-btn" style={{ width: "100%", marginTop: 8, background: "#F59E0B", color: "#fff", border: "none" }} onClick={() => onArchive(order)}>
              <Icons.Archive />Archivar orden
            </button>
          )}
          {!isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED, ORDER_STATUS.IN_DESIGN]) && (
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
          {!isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED]) && (
            <button className="pa-btn danger" style={{ width: "100%", marginTop: 8 }} onClick={() => onCancel(order)}>
              <Icons.Trash />Cancelar Orden
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// Modal de asignación de orden a usuario
// Versión enriquecida del formulario de órdenes para admin, con la misma capacidad de carga
// de archivos y preview que hoy utiliza seller.
function AdminOrderFormModal({ open, mode, orderForm, setOrderForm, onClose, onSubmit, saving }) {
  const filesInputRef = useRef(null);
  const previewInputRef = useRef(null);
  const [adminMaterials, setAdminMaterials] = useState([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("materials").select("name").order("name");
      setAdminMaterials(data || []);
    };
    if (open) load();
  }, [open]);

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
                {adminMaterials.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
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
        <div className="pa-user-modal-icon"><Icons.Users /></div>
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
        
        {/* Apartado para configurar los permisos y estados del usuario */}
        <section className="pa-form-section">
          <div className="pa-form-section-head">
            <span className="pa-form-section-kicker">Acceso</span>
            <h5>Permisos y estado</h5>
          </div>
          <div className="pa-form-grid single">
            {/* Apartado para elegir el rol de usuario */}
            <label className="pa-field">
              <span>Rol</span>
              <select value={userForm.role} onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}>
                <option value="seller">Vendedor</option>
                <option value="designer">Diseñador</option>
                <option value="quote">Cotizador</option>
                <option value="printer">Impresor</option>
                <option value="delivery">Entregador</option>
              </select>
            </label>
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
            <div><span>Estado</span><strong><StatusBadge status={order.status} className="ps-badge" showDot bordered /></strong></div>
            <div><span>Pago</span><strong><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></strong></div>
            <div><span>Precio</span><strong>{order.price ? `RD$${Number(order.price).toLocaleString("es-DO")}` : "Sin cotizar"}</strong></div>
            <div><span>Preview</span><strong>{order.preview_image ? <a href={order.preview_image} target="_blank" rel="noreferrer">Ver preview</a> : "Sin preview"}</strong></div>
          </div>
          {files.length > 0 ? <div className="pa-file-list">{files.map((file, index) => <a key={`${file}-${index}`} href={file} target="_blank" rel="noreferrer" className="pa-file-link"><Icons.File /> Diseño {index + 1}</a>)}</div> : <div className="pa-empty-small">No hay diseños cargados.</div>}
        </div>
      </div>
      <div className="pa-modal-actions">
        <button className="pa-btn secondary" onClick={onClose}>Cerrar</button>
        <button className="pa-btn ghost" onClick={() => onEdit(order)}>Editar</button>
        {!isOrderStatus(order.status, ORDER_STATUS.CANCELLED) && <button className="pa-btn danger" onClick={() => onCancel(order)}>Cancelar orden</button>}
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
          {willActivate ? <Icons.Users /> : <Icons.Close />}
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
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Estados de validación
  const [errors, setErrors] = useState({ newPassword: "", confirmPassword: "" });

  useEffect(() => {
    if (!open || !user?.id) return;

    const fetchUserEmail = async () => {
      setUserEmail("");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/get-user-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}),
          },
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
    fetchUserEmail();
  }, [open, user?.id]);

  const handleChangePassword = async () => {
    if (!user?.id) return;

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
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/change-user-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}),
        },
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

    } catch {
      onShowFeedback?.("error", "Error al conectar con el servidor");
    }

    setChangingPassword(false);
  };

  if (!open || !user) return null;

  const employmentStatus = getEmploymentStatus(user);
  const isActive = isEmploymentActive(user);

  return (
    <>
      <ModalShell open={open} onClose={onClose} title={`${getUserDisplayName(user)}`} size="compact">
        <div className="pa-user-detail-container">
          <div className="pa-user-detail-avatar-section">
            <div className="pa-user-avatar">
              <span>{getUserDisplayName(user).charAt(0).toUpperCase()}</span>
            </div>
            <div className="pa-user-detail-badge">
              <RoleBadge role={user.role} />
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

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#E8EDF8", glow: "#E8EDF8" },
  { color: "#F59E0B", bg: "#FEF3C7", glow: "#FEF3C7" },
  { color: "#8B5CF6", bg: "#EDE9FE", glow: "#EDE9FE" },
  { color: "#F97316", bg: "#FFF7ED", glow: "#FFF7ED" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
];

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
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;
  const [dateFilter, setDateFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("active");
  const notif = useNotifications(user?.id);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [userViewMode, setUserViewMode] = useState("cards");
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
  const [materials, setMaterials] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [materialFormName, setMaterialFormName] = useState("");
  const [materialFormError, setMaterialFormError] = useState("");
  const [deletingMaterialId, setDeletingMaterialId] = useState(null);

  const usersById = useMemo(() => Object.fromEntries(profiles.map(item => [item.id, item])), [profiles]);
  const showFeedback = (type, message) => setFeedback({ type, message, id: Date.now() });

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const loadSession = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return navigate("/");
    const { data: currentProfile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
    if (!currentProfile || currentProfile.role !== "admin") {
      navigate("/", { replace: true, state: { loginMessage: "Tu usuario no tiene permisos para acceder al panel administrativo." } });
      return;
    }
    setUser(data.user);
    setProfile(currentProfile);
  }, [navigate]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    setOrders(!error && Array.isArray(data) ? data : []);
    setLoadingOrders(false);
  }, []);

  const loadProfiles = useCallback(async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
    setProfiles(!error && Array.isArray(data) ? data : []);
    setLoadingUsers(false);
  }, []);

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
  }, [loadSession, loadOrders, loadProfiles]);

  const fetchMaterials = async () => {
    setMaterialsLoading(true);
    try {
      const { data, error } = await supabase
        .from("materials")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      setMaterials(data || []);
    } catch (err) {
      console.error("Error fetching materials:", err);
    } finally {
      setMaterialsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "materials") {
      fetchMaterials();
    }
  }, [activeTab]);

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
      status: normalizeOrderStatus(order.status || ORDER_STATUS.PENDING),
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
      delivery_date: !orderForm.delivery_date ? null : (orderForm.indefinido ? null : orderForm.delivery_date),
      status: ORDER_STATUS.PENDING,
      payment_status: orderForm.payment_status,
      seller_id: user?.id || null,
      created_by: user?.id || null,
    };

    setSavingOrder(true);

    let finalPreviewUrl = orderForm.existingPreview;
    let finalFileUrls = [...orderForm.existingFiles];

    // Subir nuevos archivos de diseño
    for (const file of orderForm.newFiles) {
      const fileName = buildStorageSafeFileName(file, "design-");
      const publicUrl = await uploadOrderAsset({
        bucket: "order-docs",
        path: `orders/${orderForm.id || selectedOrder?.id || "new"}/files/${fileName}`,
        file,
      });
      if (publicUrl) finalFileUrls.push(publicUrl);
    }

    // Subir nuevo preview
    if (orderForm.newPreview) {
      const fileName = buildStorageSafeFileName(orderForm.newPreview, "preview-");
      finalPreviewUrl = await uploadOrderAsset({
        bucket: "order-previews",
        path: `orders/${orderForm.id || selectedOrder?.id || "new"}/preview/${fileName}`,
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
      const { error: insertError } = await supabase.from("orders").insert([payload]).select().single();
      error = insertError;
    } else {
      const { error: updateError } = await supabase.from("orders").update(payload).eq("id", orderId);
      error = updateError;
    }

    setSavingOrder(false);

    if (error) return showFeedback("error", `No se pudo guardar la orden: ${error.message}`);

    await Promise.all([
      ...orderForm.removedFiles.map((url) => removeOrderAssetByPublicUrl({ bucket: "order-docs", url })),
      orderForm.removePreview && orderForm.existingPreview
        ? removeOrderAssetByPublicUrl({ bucket: "order-previews", url: orderForm.existingPreview })
        : Promise.resolve({ removed: false, error: null }),
    ]);

    setOrderModalOpen(false);
    setSelectedOrder(null);
    resetOrderForm();
    await loadOrders();
    showFeedback("success", orderModalMode === "create" ? "Orden creada correctamente." : "Orden actualizada correctamente.");
  };

  const openCancelModal = (order) => {
    if (order.payment_status === "pagado" || isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED])) {
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
      .update({ status: ORDER_STATUS.CANCELLED })
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
      ? { status: ORDER_STATUS.IN_DESIGN, designer_id: userId }
      : { status: ORDER_STATUS.IN_QUOTE, quote_id: userId };

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
      const { data: { session } } = await supabase.auth.getSession();
      response = await fetch("/api/admin-create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password: trimmedPassword,
          role: userForm.role,
        }),
      });

      result = await response.json();
    } catch {
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

  const handleAddMaterial = () => {
    setEditingMaterial(null);
    setMaterialFormName("");
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleEditMaterial = (mat) => {
    setEditingMaterial(mat);
    setMaterialFormName(mat.name);
    setMaterialFormError("");
    setShowMaterialModal(true);
  };

  const handleSaveMaterial = async () => {
    const name = materialFormName.trim();
    if (!name || name.length < 2) {
      setMaterialFormError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    try {
      if (editingMaterial) {
        const { error } = await supabase
          .from("materials")
          .update({ name, updated_at: new Date().toISOString() })
          .eq("id", editingMaterial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("materials")
          .insert({ name });
        if (error) {
          if (error.code === "23505") {
            setMaterialFormError("Ya existe un material con ese nombre.");
            return;
          }
          throw error;
        }
      }
      setShowMaterialModal(false);
      fetchMaterials();
    } catch (err) {
      setMaterialFormError(err.message || "Error al guardar el material.");
    }
  };

  const handleDeleteMaterial = async (id) => {
    if (deletingMaterialId === id) {
      try {
        const { error } = await supabase.from("materials").delete().eq("id", id);
        if (error) throw error;
        setDeletingMaterialId(null);
        fetchMaterials();
      } catch (err) {
        console.error("Error deleting material:", err);
      }
    } else {
      setDeletingMaterialId(id);
    }
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
      const matchesStatus = statusFilter === "all" || isOrderStatus(order.status, statusFilter);
      const matchesOwner = ownerFilter === "all" || orderMatchesProfileFilter(order, selectedProfile);
      const matchesArchive = archiveFilter === "all"
        || (archiveFilter === "active" && !order.is_archived_admin)
        || (archiveFilter === "archived" && order.is_archived_admin);
      const createdAt = new Date(order.created_at);
      const matchesDate = dateFilter === "all" || (dateFilter === "today" && createdAt >= startOfToday) || (dateFilter === "week" && createdAt >= startOfWeek);
      return matchesSearch && matchesStatus && matchesOwner && matchesArchive && matchesDate;
    });
  }, [orders, search, statusFilter, ownerFilter, archiveFilter, dateFilter, usersById]);

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  useEffect(() => { setPage(1); }, [filteredOrders.length]);

  const filteredProfiles = useMemo(() => {
    const q = normalizeText(userSearch);
    return profiles.filter(item => {
      const matchesSearch = !q || [getUserDisplayName(item), item.email, item.role, getEmploymentStatus(item)].some(value => normalizeText(value).includes(q));
      const matchesRole = roleFilter === "all" || item.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [profiles, userSearch, roleFilter]);

  const metrics = [
    { label: "Órdenes totales", value: orders.length, icon: <Icons.Orders /> },
    { label: "Cotización", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)).length, icon: <Icons.Money /> },
    { label: "En diseño", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_DESIGN)).length, icon: <Icons.File /> },
    { label: "Usuarios", value: profiles.length, icon: <Icons.Users /> },
  ];

  const typeMetrics = [
    { label: "Órdenes normales", value: orders.filter(order => order.order_type !== "orden 911").length },
    { label: "Órdenes 911", value: orders.filter(order => order.order_type === "orden 911").length },
    { label: "Canceladas", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.CANCELLED)).length },
    { label: "Completadas", value: orders.filter(order => isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)).length },
    { label: "Archivadas", value: orders.filter(order => order.is_archived_admin).length },
  ];

  const menuItems = [
    { id: "overview", label: "Resumen", icon: <Icons.Dashboard /> },
    { id: "orders", label: "Órdenes", icon: <Icons.Orders />, badge: orders.length },
    { id: "materials", label: "Materiales", icon: <Icons.Package /> },
    { id: "users", label: "Usuarios", icon: <Icons.Users />, badge: profiles.length },
  ];

  return (
    // Apartado principal totalmente flexible
    <div className="pa-root">
      <Sidebar isOpen={sidebarOpen} activeTab={activeTab} onTabChange={setActiveTab} role="Admin" userName={getUserDisplayName(profile)} menuItems={menuItems} onLogout={handleLogout} onCreateNew={openCreateOrder} showCreateButton />
      <main className="pa-main">
        <header className="pa-header">
          <div className="pa-header-left">
            <button className="pa-mobile-toggle" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Abrir menú"><Icons.Menu /></button>
            <div><span className="pa-kicker">Administrador</span><h1>{activeTab === "overview" ? "Panel General" : activeTab === "orders" ? "Gestión de órdenes" : activeTab === "materials" ? "Gestión de Materiales" : "Gestión de usuarios"}</h1></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {feedback && <div className={`pa-feedback ${feedback.type}`}>{feedback.message}</div>}
            <NotificationCenter
              notifications={notif.notifications}
              unreadCount={notif.unreadCount}
              toasts={notif.toasts}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDismissToast={notif.dismissToast}
            />
          </div>
        </header>

        {activeTab === "overview" &&
          <section className="pa-section">
            <div className="pa-metrics-grid">
              {metrics.map((metric, idx) => {
                const acc = CARD_ACCENTS[idx % CARD_ACCENTS.length];
                return (
                  <article key={metric.label} className="pa-metric-card"
                    onMouseEnter={e => e.currentTarget.style.borderColor = acc.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = ""}>
                    <div className="pa-metric-glow" style={{ background: acc.glow }} />
                    <div className="pa-metric-icon" style={{ background: acc.bg, color: acc.color }}>
                      {metric.icon}
                    </div>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </article>
                );
              })}
            </div>
            <div className="pa-two-col">
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-stripe" />
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
                <div className="pa-panel-body">
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
              </div>
              <div className="pa-panel pa-overview-panel">
                <div className="pa-panel-stripe" />
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
                <div className="pa-panel-body">
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
                          <StatusBadge status={order.status} className="ps-badge" showDot bordered />
                          <span>
                            {formatDate(order.created_at)}
                          </span>
                        </div>
                      </button>)}
                  </div>
                </div>
              </div>
            </div>
          </section>
        }

        {activeTab === "orders" &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-orders">
              <div className="pa-search-box pa-toolbar-search">
                <Icons.Search />
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
              <button className="pa-btn primary pa-toolbar-create" onClick={openCreateOrder}><Icons.Plus />
                Nueva orden
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-stripe" />
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
                    {loadingOrders ? <tr><td colSpan={9} className="ps-table-empty">Cargando órdenes...</td></tr> : filteredOrders.length === 0 ? <tr><td colSpan={9} className="ps-table-empty">No hay órdenes disponibles.</td></tr> : paginatedOrders.map(order =>
                          <tr key={order.id} className="row-hover">
                            <td className="td-pad td-id">{order.id?.slice(0, 8) || "---"}</td>
                            <td className="td-pad td-name">{order.client_name || "Sin cliente"}</td>
                            <td className="td-pad td-desc">{order.description || "Sin descripción"}</td>
                            <td className="td-pad td-mat">{order.material || "---"}</td>
                            <td className="td-pad"><StatusBadge status={order.status} className="ps-badge" showDot bordered /></td>
                            <td className="td-pad"><PaymentBadge status={order.payment_status} className="ps-badge" bordered /></td>
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
                                  <Icons.Eye />
                                </button>
                                <button className="table-action-btn edit" onClick={() => openEditOrder(order)} title="Editar orden">
                                  <Icons.Edit />
                                </button>
                                {!isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED, ORDER_STATUS.IN_COMPLETED]) && (
                                  <button className="table-action-btn" style={{ background: "#06B6D4", color: "#fff", border: "none" }} onClick={() => openQuotationModal(order)} title="Cotizar">
                                    <Icons.Money />
                                  </button>
                                )}
                                {!isOrderStatus(order.status, ORDER_STATUS.CANCELLED) &&
                                  <button className="table-action-btn cancel" onClick={() => openCancelModal(order)} title="Cancelar orden">
                                    <Icons.Trash />
                                  </button>}
                                {isAdminArchivable(order) && (
                                  order.is_archived_admin ? (
                                    <button className="table-action-btn archive" title="Orden archivada" disabled>
                                      <Icons.Archive />
                                    </button>
                                  ) : (
                                    <button className="table-action-btn archive" onClick={() => openArchiveModal(order)} title="Archivar orden">
                                      <Icons.Archive />
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>)}
                  </tbody>
                </table>
              </div>
              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </section>
        }

        {activeTab === "materials" && (
          <section className="pa-section">
            <div className="pa-section-heading">
              <div>
                <span className="pa-kicker">Catálogo</span>
                <h2>Gestión de Materiales</h2>
                <p>Administra los materiales disponibles para las órdenes de producción.</p>
              </div>
              <button className="pa-btn primary" onClick={handleAddMaterial}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Agregar material
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-body" style={{ padding: 0 }}>
                {materialsLoading ? (
                  <div className="pa-loading" style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Cargando materiales...</div>
                ) : materials.length === 0 ? (
                  <div className="pa-empty" style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    <p>No hay materiales registrados.</p>
                    <p style={{ fontSize: "12px", marginTop: "4px" }}>Haz clic en "Agregar material" para comenzar.</p>
                  </div>
                ) : (
                  <table className="pa-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Fecha de creación</th>
                        <th style={{ width: 160 }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((mat) => (
                        <tr key={mat.id}>
                          <td style={{ fontWeight: 600 }}>{mat.name}</td>
                          <td style={{ color: "#64748b", fontSize: "13px" }}>
                            {new Date(mat.created_at).toLocaleDateString("es-DO", {
                              day: "2-digit", month: "short", year: "numeric"
                            })}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="pa-btn secondary small" onClick={() => handleEditMaterial(mat)}>
                                Editar
                              </button>
                              <button
                                className={`pa-btn ${deletingMaterialId === mat.id ? "danger" : "secondary"} small`}
                                onClick={() => handleDeleteMaterial(mat.id)}
                              >
                                {deletingMaterialId === mat.id ? "¿Eliminar?" : "Eliminar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
        )}

        {showMaterialModal && (
          <div className="pa-overlay" onClick={() => setShowMaterialModal(false)}>
            <div className="pa-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="pa-modal-head">
                <h3>{editingMaterial ? "Editar material" : "Agregar material"}</h3>
                <button className="pa-close-btn" onClick={() => setShowMaterialModal(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="pa-modal-body">
                <div className="pa-field">
                  <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: "13px", color: "#0f1e40" }}>Nombre del material</label>
                  <input
                    className="pa-input"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #DDE3EF", fontSize: "14px" }}
                    value={materialFormName}
                    onChange={e => { setMaterialFormName(e.target.value); setMaterialFormError(""); }}
                    placeholder="Ej. Vinilo, Banner, Lona..."
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleSaveMaterial(); }}
                  />
                  {materialFormError && (
                    <p style={{ color: "#EF4444", fontSize: "12px", marginTop: 6 }}>{materialFormError}</p>
                  )}
                </div>
              </div>
              <div className="pa-modal-actions">
                <button className="pa-btn secondary" onClick={() => setShowMaterialModal(false)}>Cancelar</button>
                <button className="pa-btn primary" onClick={handleSaveMaterial}>
                  {editingMaterial ? "Guardar cambios" : "Agregar material"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "users" &&
          <section className="pa-section">
            <div className="pa-toolbar pa-toolbar-users">
              <div className="pa-search-box pa-toolbar-search"><Icons.Search />
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
              <div className="pa-view-toggle-group">
                <button onClick={() => setUserViewMode("table")} className={`pa-view-toggle ${userViewMode === "table" ? "active" : ""}`} title="Vista de tabla">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                </button>
                <button onClick={() => setUserViewMode("cards")} className={`pa-view-toggle ${userViewMode === "cards" ? "active" : ""}`} title="Vista de tarjetas">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                </button>
              </div>
              <button className="pa-btn primary pa-toolbar-create" onClick={() => setUserModalOpen(true)}><Icons.Plus />
                Crear usuario
              </button>
            </div>
            <div className="pa-panel">
              <div className="pa-panel-stripe" />
              <div className="pa-panel-head">
                <div>
                  <span className="pa-section-kicker">Supervisión</span>
                  <h2>Usuarios del sistema</h2>
                </div>
                <span className="pa-results-count">{filteredProfiles.length} usuarios</span>
              </div>
              {userViewMode === "cards" ? (
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
                                <RoleBadge role={item.role} />
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
                              event.stopPropagation();
                              setSelectedUser(item);
                              setUserDetailModalOpen(true);
                            }}>
                              Ver detalles
                            </button>
                            <button className={`pa-btn pa-btn-sm ${isActive ? "deactivate" : "primary"}`} onClick={(event) => {
                              event.stopPropagation();
                              openEmploymentStatusConfirm(item);
                            }}>
                              {isActive ? "Desactivar usuario" : "Activar usuario"}
                            </button>
                          </div>
                        </article>;
                      })}
                </div>
              ) : (
                <div className="ps-table-wrap">
                  <table className="ps-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Correo</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingUsers ?
                        <tr><td colSpan={5} className="ps-table-empty">Cargando usuarios...</td></tr>
                        : filteredProfiles.length === 0 ?
                          <tr><td colSpan={5} className="ps-table-empty">No hay usuarios para mostrar.</td></tr>
                          : filteredProfiles.map(item => {
                            const isActive = isEmploymentActive(item);

                            return <tr key={item.id} className="row-hover" onClick={() => { setSelectedUser(item); setUserDetailModalOpen(true); }}>
                              <td className="td-pad td-name">
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div className="pa-user-avatar-mini">
                                    {getUserDisplayName(item).charAt(0).toUpperCase()}
                                  </div>
                                  <strong style={{ fontSize: 13 }}>{getUserDisplayName(item)}</strong>
                                </div>
                              </td>
                              <td className="td-pad">{item.email || "Sin correo"}</td>
                              <td className="td-pad"><RoleBadge role={item.role} /></td>
                              <td className="td-pad">
                                <span className={`pa-meta-badge ${isActive ? "active" : "inactive"}`}>
                                  {getEmploymentStatus(item)}
                                </span>
                              </td>
                              <td className="td-pad td-actions">
                                <div className="table-actions">
                                  <button className="table-action-btn view" onClick={(e) => { e.stopPropagation(); setSelectedUser(item); setUserDetailModalOpen(true); }} title="Ver detalles">
                                    <Icons.Eye />
                                  </button>
                                  <button className={`table-action-btn ${isActive ? "deactivate" : "activate"}`} onClick={(e) => { e.stopPropagation(); openEmploymentStatusConfirm(item); }} title={isActive ? "Desactivar usuario" : "Activar usuario"}>
                                    {isActive ? <Icons.X /> : <Icons.Check />}
                                  </button>
                                </div>
                              </td>
                            </tr>;
                          })}
                    </tbody>
                  </table>
                </div>
              )}
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
      <AssignModal
        open={!!assigningOrder}
        order={assigningOrder}
        role={assigningRole}
        title={assigningOrder?.order_design_type === "EXTERNAL_DESING" ? "Enviar a Cotización" : undefined}
        onClose={() => { setAssigningOrder(null); setAssigningRole(null); }}
        onConfirm={handleAssignOrder}
        loading={assigningLoading}
      />
      <ModalShell open={quotationModalOpen} onClose={() => setQuotationModalOpen(false)} title="Cotizar Orden" size="compact">
        <div style={{ minWidth: 320 }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text)" }}>
            {quotationOrder?.client_name}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
            {quotationOrder?.description?.slice(0, 60)}{quotationOrder?.description?.length > 60 ? "..." : ""}
          </p>

          <div className="pa-field" style={{ marginBottom: 16 }}>
            <span>Estado de Pago</span>
            <select
              value={quotationPaymentStatus}
              onChange={(e) => setQuotationPaymentStatus(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="Pending_Payment">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagado">Pagado</option>
            </select>
          </div>

          {quotationPaymentStatus === "pagado" && (
            <div className="pa-field" style={{ marginBottom: 20 }}>
              <span>Imagen de Recibo/Factura <span style={{ color: "#ef4444" }}>*</span></span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setQuotationInvoice(e.target.files?.[0] || null)}
                style={{
                  width: "100%",
                  padding: "10px 13px",
                  borderRadius: "var(--radius-sm)",
                  border: "1.5px solid var(--border)",
                  background: "var(--surface-alt)",
                  fontSize: 13,
                  fontFamily: "'Poppins', sans-serif",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
              {quotationInvoice && (
                <p style={{ fontSize: 12, color: "var(--success)", marginTop: 8 }}>
                  ✓ {quotationInvoice.name}
                </p>
              )}
            </div>
          )}

          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={() => setQuotationModalOpen(false)}>
              Cancelar
            </button>
            <button
              className="pa-btn primary"
              style={{ background: "#06B6D4", borderColor: "#06B6D4", flex: 2 }}
              onClick={handleQuotationOrder}
              disabled={quotationLoading || (quotationPaymentStatus === "pagado" && !quotationInvoice)}
            >
              {quotationLoading ? "Guardando..." : "Confirmar"}
            </button>
          </div>
        </div>
      </ModalShell>
      <ModalShell open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="Confirmar Cancelación" size="compact">
        <div className="pa-confirm-modal-body">
          <div className="pa-confirm-icon cancel">
            <Icons.Trash />
          </div>
          <div className="pa-confirm-copy">
            <h4>Cancelar orden</h4>
            <p className="pa-confirm-order-name">{cancelOrderData?.client_name}</p>
            <p className="pa-confirm-order-desc">{cancelOrderData?.description?.slice(0, 60)}{cancelOrderData?.description?.length > 60 ? "..." : ""}</p>
            <p className="pa-confirm-warning">⚠️ Esta acción no se puede deshacer</p>
          </div>
          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={() => setCancelModalOpen(false)}>
              Cerrar
            </button>
            <button className="pa-btn pa-confirm-btn-cancel" onClick={handleConfirmCancelOrder} disabled={cancelLoading}>
              {cancelLoading ? "Cancelando..." : "Sí, cancelar orden"}
            </button>
          </div>
        </div>
      </ModalShell>
      <ModalShell open={!!archivingOrder} onClose={() => setArchivingOrder(null)} title="Archivar Orden" size="compact">
        <div className="pa-confirm-modal-body">
          <div className="pa-confirm-icon archive">
            <Icons.Archive />
          </div>
          <div className="pa-confirm-copy">
            <h4>Archivar orden</h4>
            <p className="pa-confirm-order-name">{archivingOrder?.client_name}</p>
            <p className="pa-confirm-order-desc">La orden se ocultará de la vista activa, pero seguirá disponible en el filtro de archivadas.</p>
          </div>
          <div className="pa-modal-actions">
            <button className="pa-btn secondary" onClick={() => setArchivingOrder(null)} disabled={archiveLoading}>
              Cancelar
            </button>
            <button className="pa-btn pa-confirm-btn-archive" onClick={handleConfirmArchiveOrder} disabled={archiveLoading}>
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

function AdminTrackingLinkField({ orderId }) {
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
