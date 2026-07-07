import { Icons } from "../../utils/icons";
import { ORDER_STATUS, isOrderStatus, isOrderStatusIn } from "../../utils/constants";

const ADMIN_DESIGN_TYPES = ["EXTERNAL_DESING", "INTERNAL_DESING"];

export default function AdminOrderActions({
  order,
  onAdvanced,
  onPayment,
  onEdit,
  onCancel,
  variant = "table",
}) {
  if (!order) return null;

  const isModal = variant === "modal";
  const isCancelled = isOrderStatusIn(order.status, [ORDER_STATUS.CANCELLED]);
  const supportsAdvancedSettings = ADMIN_DESIGN_TYPES.includes(order.order_design_type);
  const buttonClass = (action) => isModal
    ? `pa-order-action pa-order-action-${action}`
    : `table-action-btn ${action}`;

  const actions = [
    {
      key: "edit",
      label: "Editar orden",
      icon: <Icons.Edit />,
      onClick: onEdit,
      visible: true,
    },
    {
      key: "advanced",
      label: "Configuración avanzada",
      icon: <Icons.Settings />,
      onClick: onAdvanced,
      visible: supportsAdvancedSettings,
    },
    {
      key: "cash",
      label: "Pago",
      icon: <Icons.Money />,
      onClick: onPayment,
      visible: !isCancelled,
    },
    {
      key: "cancel",
      label: "Cancelar orden",
      icon: <Icons.Trash />,
      onClick: onCancel,
      visible: !isOrderStatus(order.status, ORDER_STATUS.CANCELLED),
    },
  ];

  return (
    <div className={isModal ? "pa-order-actions" : "pa-order-table-actions"}>
      {actions.filter(action => action.visible).map(action => (
        <button
          key={action.key}
          type="button"
          className={buttonClass(action.key)}
          onClick={() => action.onClick?.(order)}
          title={action.label}
          aria-label={action.label}
          data-action={action.key}
        >
          <span className="pa-order-action-icon" aria-hidden="true">{action.icon}</span>
          {isModal && <span>{action.label}</span>}
        </button>
      ))}
    </div>
  );
}
