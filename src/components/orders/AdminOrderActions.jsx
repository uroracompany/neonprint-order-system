import { Icons } from "../../utils/icons";
import { getAdminOrderActionVisibility } from "../../utils/adminActionPresentation";
import { isOrderStatus, isPaymentProductionEligible, ORDER_STATUS } from "../../utils/constants";

const ADMIN_DESIGN_TYPES = ["EXTERNAL_DESING", "INTERNAL_DESING"];

export default function AdminOrderActions({
  order,
  onAdvanced,
  onPayment,
  onEdit,
  onCancel,
  onAuthorizeProduction,
  onProduction,
  loadingAction = false,
  operationalBusy = false,
  variant = "table",
  commandCatalog = null,
}) {
  if (!order) return null;

  const isModal = variant === "modal";
  const availability = getAdminOrderActionVisibility({ order, catalog: commandCatalog });
  const supportsAdvancedSettings = ADMIN_DESIGN_TYPES.includes(order.order_design_type);
  const isArchivedForAnyRole = Boolean(
    order.is_archived
    || order.is_archived_admin
    || order.is_archived_designer
    || order.is_archived_quote
    || order.is_archived_production
    || order.is_archived_delivery
  );
  const isOperationalBusy = Boolean(loadingAction || operationalBusy);
  const canAuthorizeProduction = Boolean(
    onAuthorizeProduction
    && isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
    && isPaymentProductionEligible(order.payment_status)
    && !isArchivedForAnyRole
    && order.operational_status !== "blocked"
    && !order.production_authorized_at
  );
  const canRouteToProduction = Boolean(
    onProduction
    && isOrderStatus(order.status, ORDER_STATUS.IN_QUOTE)
    && isPaymentProductionEligible(order.payment_status)
    && !isArchivedForAnyRole
    && order.operational_status !== "blocked"
    && Boolean(order.production_authorized_at && order.production_authorized_by)
    && ![ORDER_STATUS.IN_PRODUCTION, ORDER_STATUS.IN_TERMINATION, ORDER_STATUS.IN_COMPLETED, ORDER_STATUS.IN_DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status)
    && (!isModal || commandCatalog?.actions?.some((item) => item.key === "route_production") || commandCatalog === null)
  );
  // Las acciones del detalle comparten el mismo tratamiento visual que
  // "Enviar a producción". En la tabla conservamos las variantes compactas
  // (pago, cancelar, etc.) para distinguir rápidamente cada acción.
  const buttonClass = (action) => isModal
    ? "pa-order-action pa-order-action-production"
    : `table-action-btn ${action}`;

  const actions = [
    {
      key: "edit",
      label: "Editar orden",
      icon: <Icons.Edit />,
      onClick: onEdit,
      visible: availability.edit,
    },
    {
      key: "advanced",
      label: "Configuración avanzada",
      icon: <Icons.Settings />,
      onClick: onAdvanced,
      visible: supportsAdvancedSettings && availability.advanced,
    },
    {
      key: "cash",
      label: "Pago",
      icon: <Icons.Money />,
      onClick: onPayment,
      visible: availability.payment,
    },
    {
      key: "authorize-production",
      label: loadingAction ? "Autorizando Producción..." : "Autorizar Producción",
      icon: <Icons.Check />,
      onClick: onAuthorizeProduction,
      visible: canAuthorizeProduction,
      disabled: isOperationalBusy,
    },
    {
      key: "production",
      label: "Enviar a producción",
      icon: <Icons.Package />,
      onClick: onProduction,
      visible: canRouteToProduction,
      disabled: isOperationalBusy,
    },
    {
      key: "cancel",
      label: "Cancelar orden",
      icon: <Icons.Trash />,
      onClick: onCancel,
      visible: availability.cancel,
    },
  ];

  return (
    <div className={isModal ? "pa-order-actions" : "pa-order-table-actions"} aria-busy={isOperationalBusy || undefined}>
      {actions.filter(action => action.visible).map(action => {
        const disabled = Boolean(action.disabled || isOperationalBusy);
        return (
          <button
            key={action.key}
            type="button"
            className={buttonClass(action.key)}
            onClick={() => !disabled && action.onClick?.(order)}
            title={action.label}
            aria-label={action.label}
            aria-busy={disabled ? true : undefined}
            disabled={disabled}
            data-action={action.key}
          >
            <span className="pa-order-action-icon" aria-hidden="true">{action.icon}</span>
            {isModal && <span>{action.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
