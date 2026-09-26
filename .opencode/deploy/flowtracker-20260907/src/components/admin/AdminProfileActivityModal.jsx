import { Modal } from "../orders/CreateOrderModal";
import { Icons } from "../../utils/icons";
import {
  getActivityChangeLabel,
  getActivityChangeValue,
  getSafeOrderStatusLabel,
} from "../../utils/orderEventPresentation";
import { getPaymentStatusLabel } from "../../utils/constants";

const formatDateTime = (value) => {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return date.toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
};

const hasTransition = (before, after) => before && after && before !== after;

function DetailField({ label, children }) {
  if (!children) return null;
  return <div className="apm-activity-detail-field"><span>{label}</span><strong>{children}</strong></div>;
}

export default function AdminProfileActivityModal({ activity, open, onClose }) {
  if (!activity) return null;

  const details = activity.details || {};
  const order = details.order || {};
  const statusChanged = hasTransition(details.old_status, details.new_status);
  const paymentChanged = hasTransition(details.old_payment_status, details.new_payment_status);
  const changedFields = Array.isArray(details.changed_fields) ? details.changed_fields : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Detalle de actividad"
      className="apm-activity-modal"
      closeOnBackdrop
      closeOnEscape
    >
      <div className="apm-activity-modal-copy">
        <span className="apm-activity-modal-kicker">Historial administrativo</span>
        <h3>{activity.label}</h3>
        <p>{activity.detail}</p>
      </div>

      <div className="apm-activity-detail-grid">
        <DetailField label="Administrador responsable">{details.actor_name}</DetailField>
        <DetailField label="Fecha y hora">{formatDateTime(activity.created_at)}</DetailField>
        <DetailField label="Orden relacionada">
          {order.id ? `#${String(order.id).slice(0, 8).toUpperCase()}` : null}
        </DetailField>
        <DetailField label="Cliente relacionado">{order.client_name}</DetailField>
      </div>

      {details.reason_label || details.reason_detail ? (
        <section className="apm-activity-reason">
          <span>{details.reason_label || "Motivo registrado"}</span>
          <p>{details.reason_detail || "Sin detalle adicional."}</p>
        </section>
      ) : null}

      {statusChanged || paymentChanged ? (
        <section className="apm-activity-transitions" aria-label="Cambios de estado">
          {statusChanged ? (
            <div><span>Estado de la orden</span><strong>{getSafeOrderStatusLabel(details.old_status)} <Icons.ChevronRight /> {getSafeOrderStatusLabel(details.new_status)}</strong></div>
          ) : null}
          {paymentChanged ? (
            <div><span>Estado de pago</span><strong>{getPaymentStatusLabel(details.old_payment_status)} <Icons.ChevronRight /> {getPaymentStatusLabel(details.new_payment_status)}</strong></div>
          ) : null}
        </section>
      ) : null}

      {changedFields.length ? (
        <section className="apm-activity-changes" aria-label="Campos actualizados">
          <h4>Campos actualizados</h4>
          {changedFields.map((field, index) => (
            <div className="apm-activity-change" key={`${field.field || field.label}-${index}`}>
              <strong>{getActivityChangeLabel(field.field, field.label)}</strong>
              <div><span><small>Antes</small>{getActivityChangeValue(field.field, field.old_value)}</span><Icons.ChevronRight /><span><small>Después</small>{getActivityChangeValue(field.field, field.new_value)}</span></div>
            </div>
          ))}
        </section>
      ) : null}
    </Modal>
  );
}
