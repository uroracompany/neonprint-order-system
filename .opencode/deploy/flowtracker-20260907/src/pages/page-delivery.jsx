import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import "../css-components/page-delivery.css";
import "../css-components/page-seller.css";
import "../css-components/page-production.css";
import "../components/ui/FilterSelect.css";
import Sidebar from "../components/Sidebar";
import NotificationCenter from "../components/NotificationCenter";
import { useAuth } from "../hooks/useAuth";
import useNotifications from "../hooks/useNotifications";
import useNewOrderAssignments from "../hooks/useNewOrderAssignments";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";
import { Icons } from "../utils/icons";
import { FilterSelect } from "../components/ui/FilterSelect";
import {
  ARCHIVE_MODULES,
  DELIVERY_STATUS_OPTIONS,
  getOrderStatusConfig,
  ORDER_STATUS,
  PRODUCTION_AREA_LABELS,
  isOrderStatus,
  isPaymentCredit,
  isPaymentDeliveryEligible,
  isPaymentPartial,
  resolveSellerId,
} from "../utils/constants";
import { PaymentBadge, StatusBadge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { ClientFilterSelect } from "../components/ui/ClientCombobox";
import { loadClients, orderMatchesClientFilter } from "../utils/clients";
import { applyOrdersSnapshot } from "../utils/orderRealtime";
import ArchiveOrderModal from "../components/ui/ArchiveOrderModal";
import NewOrderBadge from "../components/orders/NewOrderBadge";
import DeliveryProfileModule from "../components/delivery/DeliveryProfileModule";
import DesignerNotificationsModule from "../components/designer/DesignerNotificationsModule";
import {
  archiveOrder,
  canArchiveOrder,
  canRestoreOrder,
  restoreOrder,
} from "../utils/archive";
import { isOrderOverdue } from "../utils/orderDeadline";
import { SecureImageLink } from "../components/ui/SecureImage";
import { getFileNameFromUrl } from "../utils/constants";

const PAYMENT_DELIVERY_BLOCKED_MESSAGE = "No se puede entregar la orden hasta que esté totalmente pagada o aprobada a crédito.";
const PER_PAGE = 15;
const DELIVERY_PAGE_TITLES = {
  dashboard: "Panel de Entrega",
  orders: "Órdenes",
  notifications: "Notificaciones",
  profile: "Mi Perfil",
};

const formatOrderDate = (value, fallback = "Por definir") => {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatOrderDateTime = (value, fallback = "Por definir") => {
  if (!value) return fallback;
  return new Date(value).toLocaleString("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getOrderCode = (order) => `#${order?.id?.slice(0, 8).toUpperCase() || "---"}`;

const getSellerName = (order, sellerDirectory = {}) => (
  sellerDirectory[resolveSellerId(order)] || order?.seller_name || "Vendedor"
);

const CARD_ACCENTS = [
  { color: "#0f1e40", bg: "#F1F5F9", glow: "#F1F5F9" },
  { color: "#10B981", bg: "#DCFCE7", glow: "#DCFCE7" },
  { color: "#991b1b", bg: "#fef2f2", glow: "#fef2f2" },
  { color: "#1E40AF", bg: "#dbeafe", glow: "#dbeafe" },
  { color: "#7e22ce", bg: "#faf5ff", glow: "#faf5ff" },
];

function SummaryCard({ icon, label, value, sub, accentIdx = 0 }) {
  const acc = CARD_ACCENTS[accentIdx];
  return (
    <div className="dlv-card">
      <div className="dlv-card-glow" style={{ background: acc.glow }} />
      <div className="dlv-card-icon" style={{ background: acc.bg, color: acc.color }}>{icon}</div>
      <div className="dlv-card-value">{value}</div>
      <div className="dlv-card-label">{label}</div>
      {sub && <div className="dlv-card-sub" style={{ color: acc.color }}>{sub}</div>}
    </div>
  );
}

export function OrderDetailModal({ onClose, order, onUpdateStatus, onBlockedAction, deliveryUserId }) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [sellerName, setSellerName] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [quoteName, setQuoteName] = useState("");
  const [prodAssignments, setProdAssignments] = useState([]);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkFiles, setReworkFiles] = useState([]);
  const [reworkSelections, setReworkSelections] = useState({});
  const [reworkLoading, setReworkLoading] = useState(false);
  const [reworkError, setReworkError] = useState("");
  const [reworkSuccess, setReworkSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const reworkDialogRef = useRef(null);
  const reworkCloseRef = useRef(null);
  const reworkTriggerRef = useRef(null);
  const reworkLoadingRef = useRef(false);

  useEffect(() => {
    reworkLoadingRef.current = reworkLoading;
  }, [reworkLoading]);

  useEffect(() => {
    if (order?.seller_name) {
      setSellerName(order.seller_name);
      return;
    }
    const sellerId = resolveSellerId(order);
    if (!sellerId) {
      setSellerName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", sellerId).single()
      .then(({ data }) => setSellerName(data?.name || ""));
  }, [order]);

  useEffect(() => {
    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", order.designer_id).single()
      .then(({ data }) => setDesignerName(data?.name || ""));
  }, [order?.designer_id]);

  useEffect(() => {
    const quoteId = order?.quote_id || order?.quotation_id || order?.quote_user_id;
    if (!quoteId) {
      setQuoteName("");
      return;
    }
    supabase.from("profiles").select("name").eq("id", quoteId).single()
      .then(({ data }) => setQuoteName(data?.name || ""));
  }, [order?.quote_id, order?.quotation_id, order?.quote_user_id]);

  useEffect(() => {
    if (!order?.id) return;
    let active = true;

    Promise.all([
      supabase.from("order_production_assignments")
        .select("assigned_to, production_area_code")
        .eq("order_id", order.id),
      supabase.from("order_production_files")
        .select("production_area_code, status, assigned_to")
        .eq("order_id", order.id),
    ]).then(async ([assignRes, filesRes]) => {
      if (!active) return;
      const assignments = assignRes.data || [];
      const files = filesRes.data || [];
      if (assignments.length === 0) {
        setProdAssignments([]);
        return;
      }

      const assignedUserIds = [...new Set(assignments.map((item) => item.assigned_to).filter(Boolean))];
      const fileUserIds = [...new Set(files.map((item) => item.assigned_to).filter(Boolean))];
      const allUserIds = [...new Set([...assignedUserIds, ...fileUserIds])];
      const { data: profiles } = allUserIds.length > 0
        ? await supabase.from("profiles").select("id, name").in("id", allUserIds)
        : { data: [] };
      if (!active) return;

      const nameMap = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.name]));
      const filesByArea = {};
      files.forEach((file) => {
        const area = file.production_area_code;
        if (!filesByArea[area]) filesByArea[area] = { total: 0 };
        filesByArea[area].total += 1;
      });

      setProdAssignments(assignments.map((assignment) => {
        const count = filesByArea[assignment.production_area_code]?.total || 0;
        return {
          area: assignment.production_area_code,
          fileCount: count,
          name: nameMap[assignment.assigned_to] || "Asignado",
        };
      }));
    });

    return () => {
      active = false;
    };
  }, [order?.id]);

  useEffect(() => {
    setReworkOpen(false);
    setReworkFiles([]);
    setReworkSelections({});
    setReworkError("");
    setReworkSuccess("");
    setActionError("");
  }, [order?.id]);

  useEffect(() => {
    if (!reworkOpen || !order?.id) return undefined;
    let active = true;
    setReworkLoading(true);
    setReworkError("");
    setReworkSuccess("");
    supabase.from("order_production_files")
      .select("id, filename, url, production_area_code, assigned_to, status")
      .eq("order_id", order.id)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setReworkFiles([]);
          setReworkError("No se pudieron cargar los archivos de la orden.");
          return;
        }
        setReworkFiles(Array.isArray(data) ? data : []);
      })
      .finally(() => { if (active) setReworkLoading(false); });
    return () => { active = false; };
  }, [reworkOpen, order?.id]);

  useEffect(() => {
    if (!reworkOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !reworkLoadingRef.current) {
        event.preventDefault();
        setReworkOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = reworkDialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    reworkCloseRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      reworkTriggerRef.current?.focus();
    };
  }, [reworkOpen]);

  const getReworkErrorMessage = (error) => {
    const message = error?.message || "No se pudo devolver los archivos a producción.";
    return message.includes("ORDER_STALE")
      ? "La orden cambió en otro lugar. Actualiza la lista e inténtalo de nuevo."
      : message;
  };

  const handleUpdateStatus = async (newStatus) => {
    if (order.is_archived_delivery) return;

    if (newStatus === ORDER_STATUS.IN_DELIVERED && !isPaymentDeliveryEligible(order.payment_status)) {
      onBlockedAction?.(order, PAYMENT_DELIVERY_BLOCKED_MESSAGE);
      return;
    }

    setUpdating(true);
    setActionError("");
    try {
      const isDelivery = newStatus === ORDER_STATUS.IN_DELIVERED;
      const isReversal = newStatus === ORDER_STATUS.IN_COMPLETED;
      if (!isDelivery && !isReversal) throw new Error("Transición de Delivery no permitida.");
      const { data: updatedOrder, error } = isDelivery
        ? await supabase.rpc("delivery_mark_order_delivered", {
          p_order_id: order.id,
          p_delivery_note: deliveryMessage.trim() || null,
        })
        : await supabase.rpc("delivery_revert_order_to_completed", {
          p_order_id: order.id,
          p_expected_updated_at: order.updated_at,
        });

      if (error) throw error;
      if (!updatedOrder) throw new Error("La orden ya no esta asignada a tu perfil de Delivery.");

      if (isDelivery && deliveryMessage.trim()) {
        await supabase.from("order_events").insert({
          order_id: order.id,
          user_id: deliveryUserId,
          event_type: "delivery_note",
          message: deliveryMessage.trim(),
        });
      }

      setUpdateSuccess(true);
      if (isReversal) {
        await onUpdateStatus?.();
        onClose();
        return;
      }
      setTimeout(() => {
        setUpdateSuccess(false);
        onUpdateStatus?.();
        onClose();
      }, 1100);
    } catch (err) {
      console.error("Error updating status:", err);
      setActionError(getReworkErrorMessage(err));
    } finally {
      setUpdating(false);
    }
  };

  const truncateFilename = (name) => {
    if (!name || name.length <= 32) return name;
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex < name.length - 1) {
      const ext = name.slice(dotIndex);
      const base = name.slice(0, dotIndex);
      const maxBase = 24;
      if (base.length > maxBase) return `${base.slice(0, maxBase)}…${ext}`;
    }
    return `${name.slice(0, 28)}…`;
  };

  const formatAreaLabel = (label) => {
    const lower = String(label).toLowerCase();
    if (lower.startsWith("área") || lower.startsWith("area")) return label;
    return `Área ${label}`;
  };

  const toggleReworkFile = (fileId) => {
    setReworkSelections((current) => {
      const next = { ...current };
      if (Object.prototype.hasOwnProperty.call(next, fileId)) delete next[fileId];
      else next[fileId] = "";
      return next;
    });
  };

  const updateReworkNote = (fileId, note) => {
    setReworkSelections((current) => ({ ...current, [fileId]: note }));
  };

  const selectedReworkItems = reworkFiles
    .filter((file) => Object.prototype.hasOwnProperty.call(reworkSelections, file.id))
    .map((file) => ({ file, correction_note: String(reworkSelections[file.id] || "").trim() }));
  const hasInvalidReworkNote = selectedReworkItems.some(({ correction_note }) => correction_note.length < 1 || correction_note.length > 1000);

  const handleReturnFilesToProduction = async () => {
    if (selectedReworkItems.length === 0 || hasInvalidReworkNote || reworkLoading) return;
    setReworkLoading(true);
    setReworkError("");
    try {
      const { error } = await supabase.rpc("delivery_return_completed_files_to_production", {
        p_order_id: order.id,
        p_items: selectedReworkItems.map(({ file, correction_note }) => ({ file_id: file.id, correction_note })),
        p_expected_updated_at: order.updated_at,
      });
      if (error) throw error;
      setReworkOpen(false);
      setReworkSelections({});
      setReworkSuccess("La devolución fue enviada correctamente a Producción.");
      await onUpdateStatus?.();
    } catch (error) {
      console.error("Error returning delivery files to production:", error);
      setReworkError(getReworkErrorMessage(error));
    } finally {
      setReworkLoading(false);
    }
  };

  if (!order) return null;

  const isCompleted = isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED);
  const isDelivered = isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED);
  const hasPartialPayment = isPaymentPartial(order.payment_status);
  const hasCreditPayment = isPaymentCredit(order.payment_status);
  const deliveryBlockedByPayment = !isPaymentDeliveryEligible(order.payment_status);

  return (
    <>
    <div className="pd-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()} aria-hidden={reworkOpen || undefined} inert={reworkOpen}>
      <section className="pd-modal" role="dialog" aria-modal="true" aria-labelledby="pd-detail-title">
        <div className="pd-sheet-handle" />
        <header className="pd-modal-header">
          <div className="pd-modal-title">
            <span>{getOrderCode(order)}</span>
            <h3 id="pd-detail-title">Detalle de entrega</h3>
          </div>
          <button className="pd-icon-btn" type="button" onClick={onClose} aria-label="Cerrar detalle">
            <Icons.Close />
          </button>
        </header>

        <div className="pd-modal-body">
          {updateSuccess && (
            <div className="pd-alert success">
              <Icons.Check />
              Orden actualizada correctamente
            </div>
          )}

          {actionError && (
            <div className="pd-alert warning" role="alert"><Icons.AlertCircle />{actionError}</div>
          )}

          {reworkSuccess && (
            <div className="pd-alert success" role="status"><Icons.Check />{reworkSuccess}</div>
          )}

          {order.is_archived_delivery && (
            <div className="pd-alert warning">
              <Icons.AlertCircle />
              Esta orden está archivada. No se pueden cambiar sus estados.
            </div>
          )}

          {hasPartialPayment && (
            <div className="pd-alert warning">
              <Icons.AlertCircle />
              {PAYMENT_DELIVERY_BLOCKED_MESSAGE}
            </div>
          )}

          {hasCreditPayment && (
            <div className="pd-alert credit">
              <Icons.AlertCircle />
              Esta orden puede entregarse, pero queda como crédito pendiente de cobro.
            </div>
          )}

          <div className="pd-detail-status-row">
            <StatusBadge status={order.status} className="pd-badge" showDot={false} order={order} />
            <PaymentBadge status={order.payment_status} className="pd-badge" />
            {order.order_type === "orden 911" ? (
              <span className="pd-badge-911">911</span>
            ) : (
              <span className="pd-badge-normal">Normal</span>
            )}
          </div>

          <section className="pd-detail-section">
            <div className="pd-detail-section-title">
              <Icons.User />
              <h4>Cliente</h4>
            </div>
            <strong className="pd-detail-client">{order.client_name || "Cliente sin nombre"}</strong>
            {order.client_contact && <span className="pd-detail-muted">{order.client_contact}</span>}
          </section>

          <section className="pd-detail-section">
            <div className="pd-detail-section-title">
              <Icons.Orders />
              <h4>Orden</h4>
            </div>
            <dl className="pd-detail-grid">
              <div className="full">
                <dt>Descripción</dt>
                <dd>{order.description || "Sin descripción"}</dd>
              </div>
              <div>
                <dt>Fecha de entrega</dt>
                <dd>{formatOrderDateTime(order.delivery_date)}</dd>
              </div>
              <div>
                <dt>Creada</dt>
                <dd>{formatOrderDateTime(order.created_at, "Sin fecha")}</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>{order.material || "No especificado"}</dd>
              </div>
              {order.quantity && (
                <div>
                  <dt>Cantidad</dt>
                  <dd>{order.quantity} unidades</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="pd-detail-section">
            <div className="pd-detail-section-title">
              <Icons.Users />
              <h4>Equipo</h4>
            </div>
            <dl className="pd-detail-grid compact">
              <div>
                <dt>Vendedor</dt>
                <dd>{sellerName || "No especificado"}</dd>
              </div>
              <div>
                <dt>Diseñador</dt>
                <dd>{order?.designer_id ? (designerName || "Asignado") : "No aplica"}</dd>
              </div>
              <div>
                <dt>Caja</dt>
                <dd>{quoteName || "No asignado"}</dd>
              </div>
              {prodAssignments.map((assignment) => (
                <div key={assignment.area}>
                  <dt>{PRODUCTION_AREA_LABELS[assignment.area] || assignment.area}</dt>
                  <dd>{assignment.name} · {assignment.fileCount} archivo{assignment.fileCount === 1 ? "" : "s"}</dd>
                </div>
              ))}
            </dl>
          </section>

          {order.preview_image && (
            <section className="pd-detail-section">
              <div className="pd-detail-section-title">
                <Icons.Eye />
                <h4>Orden de trabajo</h4>
              </div>
              <SecureImageLink
                url={order.preview_image}
                fileName={getFileNameFromUrl(order.preview_image)}
                className="pd-preview-link"
              >
                Ver archivo de la orden
                <Icons.ExternalLink />
              </SecureImageLink>
            </section>
          )}
        </div>

        <footer className="pd-modal-footer">
          {isCompleted && showMessage && (
            <div className="pd-delivery-message">
              <div className="pd-delivery-message-header">
                <label htmlFor="delivery-message">Mensaje de entrega (opcional)</label>
                <button
                  className="pd-icon-btn"
                  type="button"
                  onClick={() => { setShowMessage(false); setDeliveryMessage(""); }}
                >
                  <Icons.X />
                </button>
              </div>
              <textarea
                id="delivery-message"
                className="pd-delivery-textarea"
                placeholder="Escribe un mensaje sobre la entrega..."
                value={deliveryMessage}
                onChange={(e) => setDeliveryMessage(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
          )}
          {isCompleted && (
            <div className="pd-modal-footer-actions">
              <button
                className="pd-btn pd-btn-primary"
                type="button"
                onClick={() => handleUpdateStatus(ORDER_STATUS.IN_DELIVERED)}
                disabled={updating || order.is_archived_delivery || deliveryBlockedByPayment}
                title={deliveryBlockedByPayment ? PAYMENT_DELIVERY_BLOCKED_MESSAGE : "Marcar entregado"}
              >
                {updating ? <span className="pd-btn-spinner" /> : <Icons.Check />}
                {deliveryBlockedByPayment ? "Entrega bloqueada" : "Marcar entregado"}
              </button>
              {!showMessage && (
                <button
                  className="pd-btn pd-link-btn"
                  type="button"
                  onClick={() => setShowMessage(true)}
                >
                  <Icons.Edit /> Agregar mensaje
                </button>
              )}
              <button className="pd-btn pd-btn-secondary" type="button" onClick={(event) => { reworkTriggerRef.current = event.currentTarget; setReworkOpen(true); }} disabled={updating || order.is_archived_delivery}>
                <Icons.Refresh /> Devolver archivos a producción
              </button>
              <button className="pd-btn pd-btn-secondary" type="button" onClick={onClose}>
                Cerrar
              </button>
            </div>
          )}

          {isDelivered && (
            <div className="pd-modal-footer-actions">
              <button
                className="pd-btn pd-btn-primary"
                type="button"
                onClick={() => handleUpdateStatus(ORDER_STATUS.IN_COMPLETED)}
                disabled={updating || order.is_archived_delivery}
                title={order.is_archived_delivery ? "No se pueden cambiar estados de órdenes archivadas" : "Devolver a completada"}
              >
                {updating ? <span className="pd-btn-spinner" /> : <Icons.Refresh />}
                Devolver a completada
              </button>
              <button className="pd-btn pd-btn-secondary" type="button" onClick={onClose}>
                Cerrar
              </button>
            </div>
          )}

          {!isCompleted && !isDelivered && (
            <div className="pd-modal-footer-actions">
              <button className="pd-btn pd-btn-secondary" type="button" onClick={onClose}>
                Cerrar
              </button>
            </div>
          )}
        </footer>
      </section>
      </div>
      {reworkOpen && (
      <div className="pd-modal-overlay pd-rework-overlay">
        <section className="pd-rework-modal" ref={reworkDialogRef} role="dialog" aria-modal="true" aria-labelledby="pd-rework-title" aria-describedby="pd-rework-description">
          <header className="pd-modal-header">
            <div className="pd-modal-title"><span>{getOrderCode(order)}</span><h3 id="pd-rework-title">Devolver archivos a producción</h3></div>
            <button className="pd-icon-btn" ref={reworkCloseRef} type="button" onClick={() => setReworkOpen(false)} disabled={reworkLoading} aria-label="Cerrar devolución de archivos"><Icons.Close /></button>
          </header>
          <div className="pd-rework-body">
            <p id="pd-rework-description" className="pd-rework-intro">Selecciona solo los archivos con inconvenientes e indica qué debe corregirse en cada uno.</p>
            {reworkError && <div className="pd-alert warning" role="alert"><Icons.AlertCircle />{reworkError}</div>}
            {reworkLoading && reworkFiles.length === 0 ? <p role="status">Cargando archivos…</p> : (
              <div className="pd-rework-list">
                {reworkFiles.map((file) => {
                  const selected = Object.prototype.hasOwnProperty.call(reworkSelections, file.id);
                  const completed = file.status === "completed";
                  const note = reworkSelections[file.id] || "";
                  const noteInvalid = selected && (note.trim().length < 1 || note.trim().length > 1000);
                  const rawName = file.filename || getFileNameFromUrl(file.url) || "Archivo sin nombre";
                  const displayName = truncateFilename(rawName);
                  const areaLabel = formatAreaLabel(PRODUCTION_AREA_LABELS[file.production_area_code] || file.production_area_code || "Área sin asignar");
                  return (
                    <article className="pd-rework-file" key={file.id}>
                      <label className="pd-rework-file-toggle">
                        <input type="checkbox" checked={selected} onChange={() => toggleReworkFile(file.id)} disabled={!completed || reworkLoading} />
                        <span><strong className="pd-rework-filename" title={rawName}>{displayName}</strong><small className="pd-rework-area">{areaLabel}</small></span>
                      </label>
                      {!completed && <p className="pd-rework-correct">Este archivo no está completado y no puede devolverse.</p>}
                      {completed && !selected && <p className="pd-rework-correct pd-rework-correct--warning">Correcto: permanecerá completado si no lo seleccionas.</p>}
                      {selected && <div className="pd-rework-note">
                        <label htmlFor={`rework-note-${file.id}`}>Motivo de devolución para <span className="pd-rework-filename-green">{file.filename || "este archivo"}</span></label>
                        <textarea id={`rework-note-${file.id}`} value={note} onChange={(event) => updateReworkNote(file.id, event.target.value)} maxLength={1000} rows={3} disabled={reworkLoading} aria-invalid={noteInvalid || undefined} aria-describedby={noteInvalid ? `rework-note-error-${file.id}` : undefined} />
                        <span>{note.trim().length}/1000</span>
                        {noteInvalid && <p id={`rework-note-error-${file.id}`} className="pd-rework-note-error">Escribe una explicación de 1 a 1000 caracteres.</p>}
                      </div>}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          <footer className="pd-modal-footer"><div className="pd-modal-footer-actions">
            <button className="pd-btn pd-btn-secondary" type="button" onClick={() => setReworkOpen(false)} disabled={reworkLoading}>Cancelar</button>
            <button className="pd-btn pd-btn-primary pd-btn-rework" type="button" onClick={handleReturnFilesToProduction} disabled={reworkLoading || selectedReworkItems.length === 0 || hasInvalidReworkNote}>
              {reworkLoading ? <span className="pd-btn-spinner" /> : <Icons.ArrowLeft />}Devolver {selectedReworkItems.length || ""} archivo{selectedReworkItems.length === 1 ? "" : "s"}
            </button>
          </div></footer>
        </section>
      </div>
      )}
    </>
  );
}

export default function PageDelivery() {
  const navigate = useNavigate();
  const { user: authUser, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterArchive, setFilterArchive] = useState("active");
  const [filterOverdue, setFilterOverdue] = useState("all");
  const [clients, setClients] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [archivingOrder, setArchivingOrder] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sellerDirectory, setSellerDirectory] = useState({});
  const [returnedFromProduction, setReturnedFromProduction] = useState({});
  const notif = useNotifications(user?.id);
  const newOrderAssignments = useNewOrderAssignments(user?.id, "delivery");
  const pendingNewAssignments = newOrderAssignments.pendingByOrder;

  const refreshOrders = useCallback(async (silent = false) => {
    if (!user?.id) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", DELIVERY_STATUS_OPTIONS)
      .eq("delivery_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder });
      const orderIds = data.map((order) => order.id).filter(Boolean);
      if (orderIds.length === 0) {
        setReturnedFromProduction({});
      } else {
        const { data: returnedBadges, error: returnedBadgesError } = await supabase
          .rpc("get_pending_delivery_rework_return_badges", { p_order_ids: orderIds });
        if (returnedBadgesError) {
          console.error("Error loading returned production badges:", returnedBadgesError);
        } else {
          setReturnedFromProduction(Object.fromEntries(
            (returnedBadges || []).map((handoff) => [handoff.order_id, handoff]),
          ));
        }
      }
    }
    if (!silent) setLoading(false);
  }, [user]);

  useEffect(() => {
    setUser(authUser || null);
  }, [authUser]);

  useEffect(() => {
    loadClients(supabase).then(setClients);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    refreshOrders();
  }, [user?.id, refreshOrders]);

  useEffect(() => {
    const sellerIds = [...new Set(orders.map((order) => resolveSellerId(order)).filter(Boolean))];
    if (sellerIds.length === 0) return;

    const missingIds = sellerIds.filter((id) => !sellerDirectory[id]);
    if (missingIds.length === 0) return;

    supabase
      .from("profiles")
      .select("id, name")
      .in("id", missingIds)
      .then(({ data }) => {
        if (!data) return;
        setSellerDirectory((prev) => ({
          ...prev,
          ...Object.fromEntries(data.map((profile) => [profile.id, profile.name || "Vendedor"])),
        }));
      });
  }, [orders, sellerDirectory]);

  const refreshDeliveryOrdersSilently = useCallback(() => refreshOrders(true), [refreshOrders]);
  useOrdersRealtimeSync({
    userId: user?.id,
    scope: "delivery",
    refreshOrders: refreshDeliveryOrdersSilently,
  });

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const filteredOrders = orders.filter((order) => {
    const q = search.toLowerCase();
    const sellerName = getSellerName(order, sellerDirectory).toLowerCase();
    const matchesSearch = !q
      || order.client_name?.toLowerCase().includes(q)
      || order.description?.toLowerCase().includes(q)
      || order.id?.toLowerCase().includes(q)
      || sellerName.includes(q);
    const matchesStatus = filterStatus === "all" || isOrderStatus(order.status, filterStatus);
    const matchesClient = orderMatchesClientFilter(order, filterClient);
    const matchesOverdue = filterOverdue === "all" || isOrderOverdue(order);
    const matchesArchive =
      (filterArchive === "active" && !order.is_archived_delivery)
      || (filterArchive === "archived" && order.is_archived_delivery);

    return matchesSearch && matchesStatus && matchesClient && matchesArchive && matchesOverdue;
  });

  const totalPages = Math.ceil(filteredOrders.length / PER_PAGE) || 1;
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const activeOrders = orders.filter((order) => !order.is_archived_delivery);

  useEffect(() => {
    setPage(1);
  }, [search, filterStatus, filterClient, filterArchive, filterOverdue]);

  const metrics = [
    {
      icon: <Icons.Package />,
      label: "Listas",
      sub: "Órdenes listas",
      accentIdx: 0,
      value: activeOrders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)).length,
    },
    {
      icon: <Icons.CheckCircle />,
      label: "Entregadas",
      sub: "Entregadas al cliente",
      accentIdx: 1,
      value: activeOrders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.IN_DELIVERED)).length,
    },
    {
      icon: <Icons.AlertCircle />,
      label: "Bloqueadas",
      sub: "Pendientes de revisión",
      accentIdx: 2,
      value: activeOrders.filter((order) => (
        isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)
        && !isPaymentDeliveryEligible(order.payment_status)
      )).length,
    },
    {
      icon: <Icons.Clock />,
      label: "Pago parcial",
      sub: "Pendientes de saldo",
      accentIdx: 3,
      value: activeOrders.filter((order) => isPaymentPartial(order.payment_status)).length,
    },
    {
      icon: <Icons.Money />,
      label: "Pago a crédito",
      sub: "Pendientes de cobro",
      accentIdx: 4,
      value: activeOrders.filter((order) => isPaymentCredit(order.payment_status)).length,
    },
  ];

  const notifyPartialPaymentBlocked = (order, message = PAYMENT_DELIVERY_BLOCKED_MESSAGE) => {
    notif.showActionNotification({
      type: "order_cancelled",
      label: "Entrega bloqueada",
      orderTitle: order?.client_name || order?.description || getOrderCode(order),
      orderId: order?.id || null,
      message,
      metadata: { event_kind: "partial_payment_delivery_blocked" },
    });
  };

  const handleQuickMarkDelivered = async (event, orderId) => {
    event.stopPropagation();
    const order = orders.find((item) => item.id === orderId);
    if (!isPaymentDeliveryEligible(order?.payment_status)) {
      notifyPartialPaymentBlocked(order);
      return;
    }

    setUpdatingOrderId(orderId);
    try {
      const { data: updatedOrder, error } = await supabase.rpc("delivery_mark_order_delivered", {
        p_order_id: orderId,
        p_delivery_note: null,
      });

      if (error) throw error;
      if (!updatedOrder) throw new Error("La orden ya no esta asignada a tu perfil de Delivery.");

      const { data, error: fetchError } = await supabase
        .from("orders")
        .select("*")
        .in("status", DELIVERY_STATUS_OPTIONS)
        .eq("delivery_id", user.id)
        .order("created_at", { ascending: false });

      if (!fetchError && data) {
        applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder });
      }
    } catch (err) {
      console.error("Error marking order as delivered:", err);
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Entrega bloqueada",
        orderTitle: order?.client_name || order?.description || getOrderCode(order),
        orderId,
        message: err?.message?.includes("totalmente pagada") || err?.message?.includes("credito")
          ? PAYMENT_DELIVERY_BLOCKED_MESSAGE
          : "No se pudo marcar la orden como entregada.",
        metadata: { event_kind: "delivery_update_failed" },
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleArchiveOrder = (order) => {
    if (!canArchiveOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id)) return;
    setArchivingOrder(order);
  };

  const handleConfirmArchiveOrder = async () => {
    if (!archivingOrder) return;
    setArchiveLoading(true);
    const { error } = await archiveOrder(archivingOrder, ARCHIVE_MODULES.DELIVERY);
    setArchiveLoading(false);
    if (!error) {
      setArchivingOrder(null);
      refreshOrders();
    } else {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al archivar",
        orderTitle: archivingOrder.client_name || archivingOrder.description || getOrderCode(archivingOrder),
        message: "No se pudo archivar la orden.",
      });
    }
  };

  const handleUnarchiveOrder = async (orderId) => {
    const { error } = await restoreOrder({ id: orderId }, ARCHIVE_MODULES.DELIVERY);
    if (!error) {
      refreshOrders();
    } else {
      notif.showActionNotification({
        type: "order_cancelled",
        label: "Error al restaurar",
        orderTitle: getOrderCode({ id: orderId }),
        message: "No se pudo restaurar la orden.",
      });
    }
  };

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
    if (pendingNewAssignments[order.id]) {
      void newOrderAssignments.acknowledgeOrder(order.id);
    }
    if (returnedFromProduction[order.id]) {
      void supabase
        .rpc("acknowledge_delivery_rework_return", { p_order_id: order.id })
        .then(({ data, error }) => {
          if (error) {
            console.error("Error acknowledging returned production order:", error);
            return;
          }
          if (data) {
            setReturnedFromProduction((current) => {
              const next = { ...current };
              delete next[order.id];
              return next;
            });
          }
        });
    }
  };

  const renderOrderCard = (order) => {
    const canDeliver = !order.is_archived_delivery
      && isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)
      && isPaymentDeliveryEligible(order.payment_status);
    const deliverBlocked = !order.is_archived_delivery
      && isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)
      && !isPaymentDeliveryEligible(order.payment_status);

    return (
      <article
        key={order.id}
        className={`pd-order-card ${deliverBlocked ? "blocked" : ""}`}
        onClick={() => handleViewOrder(order)}
      >
        <header className="pd-order-card-header">
          <div className="pd-order-card-identity">
            <span className="pd-order-card-id">{getOrderCode(order)}</span>
            <span className="pd-order-card-date">
              <Icons.Calendar />
              {formatOrderDate(order.delivery_date, "Por definir")}
            </span>
          </div>
          <div className="pd-order-card-badges">
            {pendingNewAssignments[order.id] && <NewOrderBadge compact />}
            {returnedFromProduction[order.id] && (
              <span className="pd-returned-production-badge" role="status">Regresada de Producción</span>
            )}
            <StatusBadge status={order.status} className="pd-badge" showDot={false} order={order} />
            <PaymentBadge status={order.payment_status} className="pd-badge" />
          </div>
        </header>

        <div className="pd-order-card-body">
          <h3>{order.client_name || "Cliente sin nombre"}</h3>
          <p>{order.description || "Sin descripción"}</p>
        </div>

        <div className="pd-order-card-meta">
          <span><Icons.User /> {getSellerName(order, sellerDirectory)}</span>
          {order.order_type === "orden 911" ? (
            <span className="urgent">911</span>
          ) : (
            <span>Normal</span>
          )}
        </div>

        {deliverBlocked && (
          <div className="pd-card-warning">
            <Icons.AlertCircle />
            Entrega bloqueada por pago pendiente
          </div>
        )}

        <footer className="pd-order-card-footer">
          {filterArchive === "archived" && canRestoreOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id) ? (
            <button
              className="pd-card-main-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleUnarchiveOrder(order.id);
              }}
              title="Restaurar orden"
            >
              <Icons.Refresh />
              Restaurar
            </button>
          ) : (
            <button
              className="pd-card-main-btn"
              type="button"
              onClick={(event) => handleQuickMarkDelivered(event, order.id)}
              disabled={!canDeliver || updatingOrderId === order.id}
              title={deliverBlocked ? PAYMENT_DELIVERY_BLOCKED_MESSAGE : "Marcar entregado"}
            >
              {updatingOrderId === order.id ? <span className="pd-btn-spinner" /> : <Icons.Check />}
              {deliverBlocked ? "Entrega bloqueada" : "Marcar entregado"}
            </button>
          )}

          <div className="pd-order-card-actions">
            <button
              className="pd-icon-btn soft"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleViewOrder(order);
              }}
              title="Ver detalles"
              aria-label="Ver detalles"
            >
              <Icons.Eye />
              <span>Ver detalles</span>
            </button>

            {canArchiveOrder(order, ARCHIVE_MODULES.DELIVERY, user?.id) && (
              <button
                className="pd-icon-btn soft"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleArchiveOrder(order);
                }}
                title="Archivar orden"
              aria-label="Archivar orden"
              >
                <Icons.Archive />
                <span>Archivar</span>
              </button>
            )}
          </div>
        </footer>
      </article>
    );
  };

  const renderOrderList = (items, emptyTitle, emptySubtitle) => {
    if (loading) {
      return (
        <div className="pd-skeleton-grid">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="pd-skeleton-card">
              <div className="pd-skeleton-line w40" />
              <div className="pd-skeleton-line w60" />
              <div className="pd-skeleton-line w80" />
              <div className="pd-skeleton-block" />
            </div>
          ))}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="pd-empty">
          <div className="pd-empty-icon"><Icons.Package /></div>
          <div className="pd-empty-title">{emptyTitle}</div>
          <div className="pd-empty-sub">{emptySubtitle}</div>
        </div>
      );
    }

    return <div className="pd-orders-grid">{items.map((order) => renderOrderCard(order))}</div>;
  };

  return (
    <div className="pd-root">
      <Sidebar
        isOpen={sidebarOpen}
        userName={user?.user_metadata?.display_name || user?.email}
        role="Entrega"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        menuItems={[
          { id: "dashboard", label: "Panel de Entrega", icon: <Icons.Truck /> },
          { id: "orders", label: "Órdenes", icon: <Icons.Orders /> },
          { id: "notifications", label: "Notificaciones", icon: <Icons.Bell />, badge: notif.unreadCount || undefined },
          { id: "profile", label: "Mi Perfil", icon: <Icons.User /> },
        ]}
        onLogout={handleLogout}
      />

      <main className="pd-main">
        <header className="pd-header">
          <div className="pd-header-left">
            <button
              className="pd-icon-btn"
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Abrir menú"
            >
              {sidebarOpen ? <Icons.ChevronLeft /> : <Icons.ChevronRight />}
            </button>
            <div className="pd-header-title">
              <div className="pd-page-title">{DELIVERY_PAGE_TITLES[activeTab] || DELIVERY_PAGE_TITLES.orders}</div>
              <div className="pd-page-date">{new Date().toLocaleDateString("es-DO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
            </div>
          </div>
          <div className="pd-header-right">
            <button className="pd-icon-btn" type="button" onClick={() => refreshOrders()} aria-label="Actualizar">
              <Icons.Refresh />
            </button>
            <button className="pd-dark-btn" type="button" onClick={() => setActiveTab("orders")}>
              <Icons.Orders /> Gestionar Órdenes
            </button>
            <NotificationCenter
              notifications={notif.notifications}
              unreadCount={notif.unreadCount}
              toasts={notif.toasts}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDismissToast={notif.dismissToast}
              onViewAll={() => setActiveTab("notifications")}
            />
          </div>
        </header>

        <nav className="pd-mobile-nav" aria-label="Navegacion Delivery">
          <button
            className={`pd-mobile-nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("dashboard")}
          >
            <Icons.Truck />
            <span>Panel de Entrega</span>
          </button>
          <button
            className={`pd-mobile-nav-btn ${activeTab === "notifications" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("notifications")}
            aria-label={notif.unreadCount > 0 ? `Notificaciones, ${notif.unreadCount} sin leer` : "Notificaciones"}
          >
            <span className="pd-mobile-nav-icon-wrap">
              <Icons.Bell />
              {notif.unreadCount > 0 && <span className="pd-mobile-notification-badge" aria-hidden="true">{notif.unreadCount > 99 ? "99+" : notif.unreadCount}</span>}
            </span>
            <span>Notificaciones</span>
          </button>
          <button
            className={`pd-mobile-nav-btn ${activeTab === "profile" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("profile")}
          >
            <Icons.User />
            <span>Perfil</span>
          </button>
          <button
            className={`pd-mobile-nav-btn ${activeTab === "orders" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("orders")}
          >
            <Icons.Orders />
            <span>Órdenes</span>
          </button>
          <button className="pd-mobile-nav-icon" type="button" onClick={() => refreshOrders()} aria-label="Actualizar">
            <Icons.Refresh />
          </button>
          <button className="pd-mobile-nav-icon danger" type="button" onClick={handleLogout} aria-label="Cerrar sesión">
            <Icons.Logout />
          </button>
        </nav>

        <div className="pd-content">
          {activeTab === "dashboard" && (
            <div className="dlv-greeting">
              <div className="dlv-greeting-copy">
                <h2>Bienvenido, <span>{user?.user_metadata?.display_name || "Delivery"}</span></h2>
                <p style={{ fontWeight: 600, color: "#1E40AF" }}>Aqui tienes el resumen de tu actividad de hoy.</p>
                <div className="dlv-greeting-badges" aria-label="Resumen de entregas">
                  <div className="dlv-greeting-count" aria-label={`${metrics[0].value} órdenes listas`}>
                    <Icons.Package />
                    <strong>{metrics[0].value}</strong> Listas
                  </div>
                  <div className="dlv-greeting-count dlv-greeting-count--delivered" aria-label={`${metrics[1].value} órdenes entregadas`}>
                    <Icons.CheckCircle />
                    <strong>{metrics[1].value}</strong> Entregadas
                  </div>
                  <div className="dlv-greeting-count dlv-greeting-count--blocked" aria-label={`${metrics[2].value} órdenes bloqueadas`}>
                    <Icons.AlertCircle />
                    <strong>{metrics[2].value}</strong> Bloqueadas
                  </div>
                  <div className="dlv-greeting-count dlv-greeting-count--partial" aria-label={`${activeOrders.filter(o => isPaymentPartial(o.payment_status)).length} órdenes con pago parcial`}>
                    <Icons.Clock />
                    <strong>{activeOrders.filter(o => isPaymentPartial(o.payment_status)).length}</strong> Pago parcial
                  </div>
                  <div className="dlv-greeting-count dlv-greeting-count--credit" aria-label={`${activeOrders.filter(o => isPaymentCredit(o.payment_status)).length} órdenes con pago a crédito`}>
                    <Icons.Money />
                    <strong>{activeOrders.filter(o => isPaymentCredit(o.payment_status)).length}</strong> Pago a crédito
                  </div>
                </div>
              </div>
              <div className="dlv-greeting-actions">
                <button type="button" className="pd-dark-btn" onClick={() => setActiveTab("orders")}>
                  <Icons.Orders /> Gestionar Órdenes
                </button>
              </div>
            </div>
          )}

          {activeTab === "dashboard" && (
            <div className="pd-summary-grid">
              {metrics.map((metric) => (
                <SummaryCard key={metric.label} {...metric} />
              ))}
            </div>
          )}

          {activeTab === "profile" && (
            <DeliveryProfileModule authUser={user} fallbackProfile={authUser} />
          )}

          {activeTab === "notifications" && (
            <DesignerNotificationsModule
              notifications={notif.notifications}
              archivedNotifications={notif.archivedNotifications}
              unreadCount={notif.unreadCount}
              loading={notif.loading}
              archivedLoading={notif.archivedLoading}
              onMarkAsRead={notif.markAsRead}
              onMarkAllAsRead={notif.markAllAsRead}
              onArchive={notif.archive}
              onDelete={notif.deleteNotification}
              onDeleteAll={notif.deleteNotificationsByScope}
              notificationSoundEnabled={notif.notificationSoundEnabled}
              notificationSoundLoading={notif.notificationSoundLoading}
              moduleLabel="Entrega"
              moduleIcon={Icons.Truck}
              moduleTone="delivery"
              onNotificationSoundChange={notif.setNotificationSoundEnabled}
            />
          )}

          {activeTab === "dashboard" && (
            <section className="pd-panel">
              <div className="pd-panel-header">
                <div>
                  <h2>Listas para entregar</h2>
                  <p style={{ fontWeight: 600, color: "#1E40AF" }}>Órdenes activas que requieren una acción de entrega.</p>
                </div>
                <button className="pd-link-btn" type="button" onClick={() => setActiveTab("orders")}>
                  Ver órdenes
                  <Icons.ArrowRight />
                </button>
              </div>
              {renderOrderList(
                activeOrders.filter((order) => isOrderStatus(order.status, ORDER_STATUS.IN_COMPLETED)).slice(0, 6),
                "No hay órdenes listas",
                "Cuando producción complete una orden, aparecerá aquí."
              )}
            </section>
          )}

          {activeTab === "orders" && (
            <>
              <div className="pp-filters">
                <label className="pp-filter-control pp-filter-search">
                  <span className="pp-filter-search-icon"><Icons.Search /></span>
                  <input placeholder="Buscar por cliente, descripcion o ID..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </label>
                <FilterSelect
                  icon={<Icons.FileText />}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  options={[
                    { value: "all", label: "Todos los estados" },
                    ...DELIVERY_STATUS_OPTIONS.map(status => {
                      const cfg = getOrderStatusConfig(status);
                      return { value: status, label: cfg.label };
                    }),
                  ]}
                  placeholder="Todos los estados"
                />
                <FilterSelect
                  icon={<Icons.Users />}
                  value={filterClient}
                  onChange={setFilterClient}
                  options={[
                    { value: "all", label: "Todos los clientes" },
                    ...clients.map(c => ({ value: c.id, label: c.name })),
                  ]}
                  placeholder="Todos los clientes"
                />
                <FilterSelect
                  icon={<Icons.Archive />}
                  value={filterArchive}
                  onChange={setFilterArchive}
                  options={[
                    { value: "active", label: "Activas" },
                    { value: "archived", label: "Archivadas" },
                  ]}
                  placeholder="Activas"
                />
                <FilterSelect
                  icon={<Icons.AlertCircle />}
                  value={filterOverdue}
                  onChange={setFilterOverdue}
                  options={[
                    { value: "all", label: "Todas las fechas de entrega" },
                    { value: "overdue", label: "Atrasadas" },
                  ]}
                  placeholder="Todas las fechas de entrega"
                />
                <span className="pp-filters-count"><Icons.Clipboard /> {filteredOrders.length} resultado{filteredOrders.length === 1 ? "" : "s"}</span>
              </div>

              {renderOrderList(
                paginatedOrders,
                "No se encontraron órdenes",
                "Ajusta los filtros o busca con otro término."
              )}

              <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </div>
      </main>

      <ArchiveOrderModal
        open={!!archivingOrder}
        onClose={() => setArchivingOrder(null)}
        onConfirm={handleConfirmArchiveOrder}
        order={archivingOrder}
        loading={archiveLoading}
      />

      <OrderDetailModal
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        onUpdateStatus={refreshOrders}
        onBlockedAction={notifyPartialPaymentBlocked}
        deliveryUserId={user?.id}
      />
    </div>
  );
}
