import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { StatusBadge } from "../ui/Badge";
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_COLORS } from "../../utils/constants";
import { buildPaymentReceiptPath, uploadOrderAsset } from "../../utils/uploadOrderAsset";
import { validateReceiptFile } from "../../utils/receiptValidation";
import { executeAdminOrderCommand } from "../../utils/adminOrderCommands";
import { getAdminActionPresentation, hasAdminCapability } from "../../utils/adminActionPresentation";
import PaymentFormModal from "../ui/PaymentFormModal";
import AdminAdvancedActionModal from "./AdminAdvancedActionModal";
import AdminManageFilesModal from "./AdminManageFilesModal";
import "./AdminAdvancedSettings.css";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

const getCompactPaymentLabel = (status) => {
  const label = (PAYMENT_COLORS[status] || PAYMENT_COLORS[PAYMENT_STATUS.PENDING]).label;
  return label.replace(/^Pago\s+/i, "");
};

export default function AdminAdvancedSettings({
  order,
  profiles = [],
  onClose,
  onRunAction,
  onRefreshOrder,
  loading = false,
  currentUserId = null,
}) {
  const [availability, setAvailability] = useState(null);
  const [loadingActions, setLoadingActions] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [error, setError] = useState("");
  const orderId = order?.id;

  const fetchActions = useCallback(async () => {
    if (!orderId) return;
    setLoadingActions(true);
    setError("");
    const { data, error: requestError } = await supabase.rpc("admin_get_order_command_catalog", { p_order_id: orderId });
    setAvailability(requestError ? null : data);
    if (requestError) setError(requestError.message);
    setLoadingActions(false);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    setActiveModal(null);
    setError("");
    fetchActions();
  }, [orderId, order?.updated_at, fetchActions]);

  const actionItems = availability?.actions || [];
  const unavailableActionItems = availability?.unavailable_actions || [];
  const prerequisiteItems = unavailableActionItems.filter((item) => item.next_safe_step);
  const orderNumber = order?.order_number || order?.order_code || order?.id?.slice(0, 8).toUpperCase();
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const quoteAssigneeName = order?.quote_id
    ? getUserDisplayName(profilesById.get(order.quote_id))
    : "Sin asignar";

  if (!order) return null;

  const handleActionClick = (item) => {
    setError("");
    if (item.key === "register_payment") {
      setPaymentOrder(order);
      return;
    }
    if (item.key === "manage_files" || ["manage_design_assets", "manage_production_files", "reassign_production_file_area"].some((capability) => hasAdminCapability(item, capability))) {
      setActiveModal(item);
      return;
    }
    setActiveModal(item);
  };

  const handleSimpleActionConfirm = async (actionData) => {
    await onRunAction(actionData);
    setActiveModal(null);
    await fetchActions();
  };

  const handlePaymentInAdvanced = async ({ paymentStatus, receiptFile }) => {
    if (!order) return;

    if (paymentStatus === PAYMENT_STATUS.PENDING && (
      order.status === ORDER_STATUS.IN_PRODUCTION ||
      order.status === ORDER_STATUS.IN_TERMINATION ||
      order.status === ORDER_STATUS.IN_COMPLETED ||
      order.status === ORDER_STATUS.IN_DELIVERED
    )) {
      throw new Error("Una orden en Producción, Terminación, Completado o Entregado no puede volver a pago Pendiente.");
    }

    if (paymentStatus === PAYMENT_STATUS.CREDIT) {
      setPaymentLoading(true);
        const { error: creditError } = await supabase.rpc("mark_order_as_credit", {
          p_order_id: order.id,
          p_due_date: null,
          p_expected_updated_at: order.updated_at,
        });
      setPaymentLoading(false);
      if (creditError) throw new Error(creditError.message || "No se pudo aprobar el crédito.");
      setPaymentOrder(null);
      await onRefreshOrder?.();
      await fetchActions();
      return;
    }

    setPaymentLoading(true);
    let paymentInvoiceUrl = null;

    if (receiptFile) {
      const validation = await validateReceiptFile(receiptFile);
      if (!validation.isValid) {
        setPaymentLoading(false);
        throw new Error(validation.error || "La imagen no es válida.");
      }
      try {
        const filePath = buildPaymentReceiptPath(order.id, receiptFile.name);
        const publicUrl = await uploadOrderAsset({
          bucket: "payment-invoice",
          path: filePath,
          file: receiptFile,
        });
        if (publicUrl) {
          paymentInvoiceUrl = publicUrl;
        } else {
          setPaymentLoading(false);
          throw new Error("Error al subir la imagen de pago.");
        }
      } catch (uploadError) {
        setPaymentLoading(false);
        throw new Error(uploadError?.message || "Error al subir la imagen de pago.");
      }
    }

    let updateError;
    try {
      await executeAdminOrderCommand(supabase, {
        orderId: order.id,
        action: "register_payment",
        payload: { payment_status: paymentStatus, invoice_payment: paymentInvoiceUrl },
        reasonCategory: "workflow_correction",
        reasonDetail: "Pago registrado por Administración desde Configuración avanzada.",
        expectedUpdatedAt: order.updated_at,
      });
    } catch (error) {
      updateError = error;
    }

    setPaymentLoading(false);
    if (updateError) throw new Error(updateError.message || "Error al actualizar el pago.");

    setPaymentOrder(null);
    await onRefreshOrder?.();
    await fetchActions();
  };

  const handleManageFilesClose = async () => {
    setActiveModal(null);
    await onRefreshOrder?.();
    await fetchActions();
  };

  return (
    <>
      <section className={`aas-container${loading ? ' is-loading' : ''}`} aria-labelledby="aas-title" aria-busy={loading || loadingActions}>
        <header className="aas-header">
          <div>
            <h2 id="aas-title">Configuración avanzada</h2>
            <p>Orden #{orderNumber}</p>
          </div>
          <button className="aas-back-btn" type="button" onClick={onClose}>
            <Icons.ChevronLeft />
            Volver a órdenes
          </button>
        </header>

        <div className="aas-summary-card" aria-label="Resumen de la orden">
          {availability?.operational_status === "blocked" && (
            <div className="aas-summary-item aas-summary-item-blocked">
              <span className="aas-summary-icon"><Icons.AlertCircle /></span>
              <span className="aas-summary-copy">
                <strong>Orden bloqueada</strong>
                <small>{availability.blocked_reason_detail || "Incidencia operativa activa"}</small>
              </span>
            </div>
          )}
          <div className="aas-summary-item">
            <span className="aas-summary-icon"><Icons.File /></span>
            <span className="aas-summary-copy">
              <strong>{order?.order_design_type === "INTERNAL_DESING" ? "Diseño interno" : "Diseño externo"}</strong>
              <small>Tipo de diseño</small>
            </span>
          </div>
          <div className="aas-summary-item">
            <span className="aas-summary-copy">
              <StatusBadge status={order.status} className="ps-badge" bordered />
              <small>Estado actual</small>
            </span>
          </div>
          <div className="aas-summary-item">
            <span className="aas-summary-icon"><Icons.User /></span>
            <span className="aas-summary-copy">
              <strong>{order.client_name || "Sin cliente"}</strong>
              <small>Cliente</small>
            </span>
          </div>
          <div className="aas-summary-item">
            <span className="aas-summary-icon"><Icons.User /></span>
            <span className="aas-summary-copy">
              <strong>{quoteAssigneeName}</strong>
              <small>Usuario de Caja</small>
            </span>
          </div>
        </div>

        <div className="aas-body">
          <div className="aas-section-heading">
            <h3>{actionItems.length === 0 && prerequisiteItems.length > 0 ? "Antes de continuar" : "Acciones disponibles"}</h3>
          </div>
          {loadingActions ? (
            <div className="aas-skeleton" aria-hidden="true">
              <div className="aas-skeleton-row">
                <div className="aas-skeleton-icon" />
                <div className="aas-skeleton-lines">
                  <div className="aas-skeleton-line" />
                  <div className="aas-skeleton-line short" />
                </div>
              </div>
              <div className="aas-skeleton-row">
                <div className="aas-skeleton-icon" />
                <div className="aas-skeleton-lines">
                  <div className="aas-skeleton-line" />
                  <div className="aas-skeleton-line short" />
                </div>
              </div>
              <div className="aas-skeleton-row">
                <div className="aas-skeleton-icon" />
                <div className="aas-skeleton-lines">
                  <div className="aas-skeleton-line" />
                  <div className="aas-skeleton-line short" />
                </div>
              </div>
            </div>
          ) : actionItems.length === 0 ? (
            <div className="aas-empty">
              <Icons.Settings className="aas-empty-icon" />
              <span>{prerequisiteItems.length > 0 ? "Hay pasos previos que debes completar antes de continuar." : "No hay ajustes avanzados disponibles en esta etapa."}</span>
            </div>
          ) : (
            <div className="aas-action-list">
              {actionItems.map((item) => {
                const { title, description, Icon } = getAdminActionPresentation(item);
                return (
                  <button key={item.key} type="button" className={`aas-action is-${item.key}`} onClick={() => handleActionClick(item)}>
                    <span className={`aas-action-icon is-${item.key}`}><Icon /></span>
                    <span className="aas-action-copy"><strong>{title}</strong><small>{description}</small></span>
                    {item.key === "register_payment" && (
                      <span className="aas-action-status">
                        {getCompactPaymentLabel(order.payment_status)}
                      </span>
                    )}
                    <Icons.ChevronRight />
                  </button>
                );
              })}
            </div>
          )}
          {prerequisiteItems.length > 0 && (
            <section className="aas-prerequisite-section" aria-labelledby="aas-prerequisite-title">
              <div className="aas-prerequisite-heading">
                <span aria-hidden="true"><Icons.AlertCircle /></span>
                <div>
                  <h4 id="aas-prerequisite-title">Requieren un paso previo</h4>
                  <p>Estas opciones todavía no están disponibles para esta orden.</p>
                </div>
              </div>
              <div className="aas-action-list aas-action-list-unavailable" aria-label="Acciones que requieren un paso previo">
              {prerequisiteItems.map((item) => {
                const { title, description, Icon } = getAdminActionPresentation(item);
                return (
                  <div key={item.key} className={`aas-action is-${item.key} is-unavailable`} aria-disabled="true" aria-describedby={`aas-prerequisite-copy-${item.key}`}>
                    <span className={`aas-action-icon is-${item.key}`}><Icon /></span>
                    <span className="aas-action-copy"><strong>{title}</strong><small id={`aas-prerequisite-copy-${item.key}`}>{item.next_safe_step || description}</small></span>
                  </div>
                );
              })}
              </div>
            </section>
          )}
          {error && <div className="aas-error"><Icons.AlertCircle />{error}</div>}
        </div>

        <footer className="aas-footer">
          <span><Icons.Clock /> Cada cambio que realices quedará registrado en el historial de la orden.</span>
          <div>
            <button type="button" className="aas-button" onClick={onClose} disabled={loading}>Regresar al listado</button>
          </div>
        </footer>
      </section>

      {activeModal && activeModal.key !== "manage_files" && !["manage_design_assets", "manage_production_files", "reassign_production_file_area"].some((capability) => hasAdminCapability(activeModal, capability)) && (
        <AdminAdvancedActionModal
          open={true}
          actionKey={activeModal.key}
          action={activeModal}
          order={order}
          profiles={profiles}
          currentUserId={currentUserId}
          onConfirm={handleSimpleActionConfirm}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal && (activeModal.key === "manage_files" || ["manage_design_assets", "manage_production_files", "reassign_production_file_area"].some((capability) => hasAdminCapability(activeModal, capability))) && (
        <AdminManageFilesModal
          open={true}
          order={order}
          profiles={profiles}
          onClose={handleManageFilesClose}
          onRefreshActions={fetchActions}
          capabilities={activeModal.requirements?.capabilities || [activeModal.requirements?.capability].filter(Boolean)}
          nextSafeStep={activeModal.next_safe_step || ""}
        />
      )}

      <PaymentFormModal
        open={!!paymentOrder}
        order={paymentOrder}
        loading={paymentLoading}
        onClose={() => setPaymentOrder(null)}
        onConfirm={handlePaymentInAdvanced}
      />
    </>
  );
}
