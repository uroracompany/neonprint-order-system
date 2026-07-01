import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../../supabaseClient";
import { Icons } from "../../utils/icons";
import { StatusBadge } from "../ui/Badge";
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_COLORS } from "../../utils/constants";
import { buildPaymentReceiptPath, uploadOrderAsset } from "../../utils/uploadOrderAsset";
import { validateReceiptFile } from "../../utils/receiptValidation";
import PaymentFormModal from "../ui/PaymentFormModal";
import AdminAdvancedActionModal from "./AdminAdvancedActionModal";
import AdminManageFilesModal from "./AdminManageFilesModal";
import "./AdminAdvancedSettings.css";

const getUserDisplayName = (profile) => profile?.name || profile?.email || "Usuario";

const getCompactPaymentLabel = (status) => {
  const label = (PAYMENT_COLORS[status] || PAYMENT_COLORS[PAYMENT_STATUS.PENDING]).label;
  return label.replace(/^Pago\s+/i, "");
};

const ACTION_COPY = {
  route_quote: ["Enviar a Caja", "Mover la orden al flujo de caja", Icons.Money],
  set_quote_assignee: ["Gestionar usuario de Caja", "Asignar, cambiar o quitar responsable", Icons.Users],
  route_sales: ["Regresar orden a Ventas", "Elegir vendedor responsable", Icons.ArrowLeft],
  register_payment: ["Registrar pago", "Registrar o actualizar el pago de la orden", Icons.Receipt],
  route_production: ["Enviar a Producción", "Asignar responsables por área", Icons.Package],
  return_to_quote: ["Regresar a Caja", "Regresar la orden de Producción a Caja", Icons.ArrowLeft],
  reassign_production: ["Reasignar Producción", "Cambiar responsables de áreas de producción", Icons.Users],
  manage_files: ["Gestionar archivos", "Editar el estado de archivos de producción", Icons.File],
  mark_delivered: ["Marcar como entregado", "Pasar la orden a estado Entregado", Icons.CheckCircle],
  return_to_completed: ["Volver a Completado", "Regresar la orden de Entregado a Completado", Icons.ArrowLeft],
  route_design: ["Enviar a Diseño", "Mover la orden al flujo de diseño", Icons.Brush],
  set_designer_assignee: ["Gestionar diseñador", "Asignar, cambiar o quitar responsable de diseño", Icons.Users],
  return_to_design: ["Regresar a Diseño", "Regresar la orden de Caja a Diseño", Icons.ArrowLeft],
  assign_seller: ["Reasignar vendedor", "Cambiar el vendedor responsable", Icons.Users],
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

  const fetchActions = useCallback(async () => {
    if (!order?.id) return;
    setLoadingActions(true);
    setError("");
    const { data, error: requestError } = await supabase.rpc("get_admin_order_actions", { p_order_id: order.id });
    setAvailability(requestError ? null : data);
    if (requestError) setError(requestError.message);
    setLoadingActions(false);
  }, [order?.id]);

  useEffect(() => {
    if (!order?.id) return;
    setActiveModal(null);
    setError("");
    fetchActions();
  }, [order?.id, order?.updated_at, fetchActions]);

  const actionItems = availability?.actions || [];
  const orderNumber = order?.order_number || order?.order_code || order?.id?.slice(0, 8).toUpperCase();
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const quoteAssigneeName = order?.quote_id
    ? getUserDisplayName(profilesById.get(order.quote_id))
    : "Sin asignar";

  if (!order) return null;

  const handleActionClick = (key) => {
    setError("");
    if (key === "register_payment") {
      setPaymentOrder(order);
      return;
    }
    if (key === "manage_files") {
      setActiveModal("manage_files");
      return;
    }
    setActiveModal(key);
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

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: paymentStatus,
        invoice_payment: paymentStatus === PAYMENT_STATUS.PARTIAL ? null : paymentInvoiceUrl,
      })
      .eq("id", order.id);

    setPaymentLoading(false);
    if (updateError) throw new Error("Error al actualizar el pago.");

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
            <h3>Acciones disponibles</h3>
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
              <span>No hay ajustes avanzados disponibles en esta etapa.</span>
            </div>
          ) : (
            <div className="aas-action-list">
              {actionItems.map((item) => {
                const [title, description, Icon] = ACTION_COPY[item.key] || [item.label, "", Icons.Settings];
                return (
                  <button key={item.key} type="button" className={`aas-action is-${item.key}`} onClick={() => handleActionClick(item.key)}>
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
          {error && <div className="aas-error"><Icons.AlertCircle />{error}</div>}
        </div>

        <footer className="aas-footer">
          <span><Icons.Clock /> Cada cambio que realices quedará registrado en el historial de la orden.</span>
          <div>
            <button type="button" className="aas-button" onClick={onClose} disabled={loading}>Regresar al listado</button>
          </div>
        </footer>
      </section>

      {activeModal && activeModal !== "manage_files" && activeModal !== "register_payment" && (
        <AdminAdvancedActionModal
          open={true}
          actionKey={activeModal}
          order={order}
          profiles={profiles}
          currentUserId={currentUserId}
          onConfirm={handleSimpleActionConfirm}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === "manage_files" && (
        <AdminManageFilesModal
          open={true}
          order={order}
          profiles={profiles}
          onClose={handleManageFilesClose}
          onRefreshActions={fetchActions}
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
