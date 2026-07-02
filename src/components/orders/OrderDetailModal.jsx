import { useEffect, useState } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import {
  ORDER_STATUS,
  getFileNameFromUrl,
  getOrderStatusConfig,
  isOrderStatusIn,
} from "../../utils/constants";
import { getOrderFiles, getReferenceImages, hasAnyOrderAsset } from "../../utils/orderAssets";
import { FlowTracker, FlowTrackerExternal } from "../FlowTracker";
import FileCard from "../FileCard";
import { PaymentBadge, StatusBadge as SharedStatusBadge } from "../ui/Badge";
import { Modal } from "./CreateOrderModal";
import OrderAssignmentAction from "./OrderAssignmentAction";
import OrderReviewCard from "./OrderReviewCard";
import "./OrderDetailModal.css";

const ACTIVE_WORKFLOW_STATUSES_FOR_SELLER = [
  ORDER_STATUS.IN_DESIGN,
  ORDER_STATUS.IN_QUOTE,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.IN_TERMINATION,
  ORDER_STATUS.IN_DELIVERED,
  ORDER_STATUS.IN_COMPLETED,
  ORDER_STATUS.CANCELLED,
];

const isReturnedOrder = (order) => {
  if (!order || !order.return_reason) return false;
  const validStatuses = order.order_design_type === "EXTERNAL_DESING"
    ? [ORDER_STATUS.PENDING]
    : [ORDER_STATUS.IN_DESIGN];
  return isOrderStatusIn(order.status, validStatuses);
};

function StatusBadge({ status, type = "status" }) {
  if (type === "payment") {
    return <PaymentBadge status={status} className="ps-badge" bordered />;
  }
  return <SharedStatusBadge status={status} className="ps-badge" showDot bordered />;
}

function ReturnedBadge({ compact = false }) {
  return (
    <span className={`ps-returned-badge${compact ? " compact" : ""}`} title="Orden devuelta desde caja">
      Devuelta
    </span>
  );
}

function TrackingLinkField({ orderId }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
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
            onClick={(event) => event.target.select()}
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

export default function OrderDetailModal({
  open,
  onClose,
  order,
  user,
  responsibleName,
  designerName: designerNameProp,
  onSendToDesigner,
  onSendToQuotation,
  primaryActionLabel,
  showPrimaryAction = true,
  pendingReview = null,
  onAcknowledgeReview,
  reviewAcknowledging = false,
  reviewError = "",
  adminIntervention = null,
  adminActions = null,
}) {
  const hasOrder = Boolean(order);
  const created = hasOrder ? new Date(order.created_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "";
  const statusConfig = hasOrder ? getOrderStatusConfig(order.status) : getOrderStatusConfig(ORDER_STATUS.PENDING);
  const orderFileUrls = getOrderFiles(order);
  const referenceImageUrls = getReferenceImages(order);
  const hasAssets = hasAnyOrderAsset(order);
  const [designerName, setDesignerName] = useState("");

  useEffect(() => {
    if (designerNameProp) {
      setDesignerName(designerNameProp);
      return;
    }

    if (!order?.designer_id) {
      setDesignerName("");
      return;
    }

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
  }, [designerNameProp, order?.designer_id]);

  if (!hasOrder) return null;

  const isExternalDesign = order.order_design_type === "EXTERNAL_DESING";
  const primaryActionHandler = isExternalDesign ? onSendToQuotation : onSendToDesigner;
  const primaryLabel = primaryActionLabel || (isExternalDesign ? "Enviar a Caja" : "Enviar a Diseño");
  const shouldShowPrimaryAction = showPrimaryAction
    && !isOrderStatusIn(order.status, ACTIVE_WORKFLOW_STATUSES_FOR_SELLER);
  const displayResponsibleName = responsibleName || user?.displayName || "---";

  return (
    <Modal open={open} onClose={onClose} title={`Orden #${order.id?.slice(0, 8).toUpperCase()}`} wide className="order-detail-modal">
      <div className="order-detail-shell">
        <div className="order-detail-flow" role="region" aria-label="Progreso de la orden" tabIndex={0}>
          {isExternalDesign ? (
            <FlowTrackerExternal status={order.status} />
          ) : (
            <FlowTracker status={order.status} />
          )}
        </div>

        {adminActions && (
          <section className="order-detail-actions-panel" aria-label="Acciones de la orden">
            <div className="order-detail-actions-copy">
              <strong>Acciones de la orden</strong>
              <span>Gestiona esta orden sin volver al listado.</span>
            </div>
            {adminActions}
          </section>
        )}

        {adminIntervention}

      <div className="order-detail-content-grid">
        <div className="order-detail-column">
          <div className="order-detail-section" style={{
            background: "var(--surface)",
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
                borderRadius: "50%",
                background: "var(--pink)",
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

          <OrderReviewCard
            pendingReview={pendingReview}
            onAcknowledge={onAcknowledgeReview}
            acknowledging={reviewAcknowledging}
            error={reviewError}
          />

          <div className="order-detail-section" style={{
            background: "var(--surface)",
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
                { label: "Núm. Facturación", value: order.invoice_number || "---", icon: <Icons.FileText /> },
                {
                  label: "Diseño",
                  value: order.order_design_type === "INTERNAL_DESING" ? "Diseño interno" :
                    order.order_design_type === "EXTERNAL_DESING" ? "Diseño externo" : "---",
                  icon: <Icons.Edit />
                },
                { label: "Fecha entrega", value: order.delivery_date || "Indefinida", icon: <Icons.Calendar /> },
              ].map((item, index) => (
                <div key={item.label} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr auto",
                  gap: 10, alignItems: "center", paddingBottom: 11,
                  borderBottom: index < 5 ? "1px solid var(--border)" : "none"
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

        <div className="order-detail-column">
          <div className="order-detail-section" style={{
            background: "var(--surface)",
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
            }}>Estado & Pago</p>

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

            {shouldShowPrimaryAction && (
              <div style={{ marginTop: 16 }}>
                <OrderAssignmentAction
                  order={order}
                  label={primaryLabel}
                  onClick={primaryActionHandler}
                  bare
                />
              </div>
            )}
          </div>

          <div className="order-detail-section" style={{
            background: "var(--surface)",
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
                { label: "Responsable", value: displayResponsibleName, icon: <Icons.User /> },
                ...(order.designer_id ? [{ label: "Diseñador", value: designerName || "Asignado", icon: <Icons.Edit style={{ color: "#8B5CF6" }} /> }] : []),
              ].map((item) => (
                <div key={item.label} style={{
                  display: "grid", gridTemplateColumns: "20px 1fr auto",
                  gap: 8, alignItems: "center"
                }}>
                  <span style={{ color: "var(--text-muted)" }}>{item.icon}</span>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, margin: 0 }}>
                    {item.label}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, margin: 0, textAlign: "right" }}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="order-detail-section" style={{
            background: "var(--surface)",
            padding: 16,
            marginBottom: 18
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 8
            }}>
              <Icons.ExternalLink /> Link de Seguimiento
            </p>

            <TrackingLinkField orderId={order.id} />
          </div>
        </div>
      </div>

      {hasAssets && (
        <div className="order-detail-section" style={{
          background: "var(--surface)",
          padding: 20,
          boxShadow: "var(--shadow-sm)"
        }}>
          <p style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.07em",
            marginBottom: 16,
            display: "flex", alignItems: "center", gap: 8
          }}>
            <Icons.File /> Archivos Adjuntos
          </p>

          <div style={{ display: "grid", gridTemplateColumns: order.preview_image && orderFileUrls.length > 0 ? "1fr 1fr" : "1fr", gap: 16 }}>
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
                    onMouseEnter={(event) => { event.target.style.transform = "scale(1.02)"; event.target.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
                    onMouseLeave={(event) => { event.target.style.transform = "scale(1)"; event.target.style.boxShadow = "none"; }}
                  />
                </a>
              </div>
            )}

            {orderFileUrls.length > 0 && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icons.Brush /> Diseño del cliente
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {orderFileUrls.map((url, index) => (
                    <FileCard
                      key={`${url}-${index}`}
                      name={getFileNameFromUrl(url)}
                      url={url}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          {referenceImageUrls.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Icons.Image /> Imágenes de referencia
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {referenceImageUrls.map((url, index) => (
                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", flex: "0 0 auto" }}>
                    <img
                      src={url}
                      alt={`Ref ${index + 1}`}
                      style={{
                        width: 120,
                        height: 120,
                        objectFit: "cover",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        transition: "transform 0.2s, box-shadow 0.2s",
                      }}
                      onMouseEnter={(event) => { event.target.style.transform = "scale(1.05)"; event.target.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)"; }}
                      onMouseLeave={(event) => { event.target.style.transform = "scale(1)"; event.target.style.boxShadow = "none"; }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </Modal>
  );
}
