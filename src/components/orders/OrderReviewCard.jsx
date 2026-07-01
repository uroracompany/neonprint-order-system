import { getOrderStatusLabel, getPaymentStatusLabel } from "../../utils/constants";
import "./OrderReview.css";

const PAYMENT_REVIEW_FIELDS = new Set(["payment", "payment_status"]);
const STATUS_REVIEW_FIELDS = new Set(["status", "order_status"]);
const ASSIGNMENT_REVIEW_FIELDS = new Set(["assignment", "responsible", "assignee"]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

const displayValue = (field, value) => {
  if (value == null || value === "") return "Sin definir";
  if (PAYMENT_REVIEW_FIELDS.has(field)) return getPaymentStatusLabel(value);
  if (STATUS_REVIEW_FIELDS.has(field)) return getOrderStatusLabel(value);
  if (ASSIGNMENT_REVIEW_FIELDS.has(field) && UUID_PATTERN.test(String(value))) {
    return "Responsable asignado";
  }
  return String(value);
};

const formatReviewDate = (value) => {
  if (!value) return "Fecha no disponible";
  return new Date(value).toLocaleString("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export default function OrderReviewCard({
  pendingReview,
  onAcknowledge,
  acknowledging = false,
  error = "",
}) {
  if (!pendingReview) return null;

  const reviews = Array.isArray(pendingReview.reviews)
    ? pendingReview.reviews
    : [pendingReview];

  return (
    <section className="order-review-card" aria-label="Cambios pendientes de la orden">
      <div className="order-review-head">
        <div>
          <span className="order-review-kicker">Cambios pendientes</span>
          <h3>{pendingReview.label || "Editada por Admin"}</h3>
        </div>
        <span className="order-review-count">{reviews.length} {reviews.length === 1 ? "edición" : "ediciones"}</span>
      </div>

      <div className="order-review-timeline">
        {reviews.map((review, index) => {
          const fields = Array.isArray(review.changed_fields) ? review.changed_fields : [];
          return (
            <article className="order-review-entry" key={review.id || `${review.order_id}-${index}`}>
              <div className="order-review-entry-head">
                <strong>Edición #{index + 1}</strong>
                <span>{review.actor_name || "Administrador"} · {formatReviewDate(review.created_at)}</span>
              </div>
              <div className="order-review-fields">
                {review.metadata?.reason_label ? (
                  <div className="order-review-reason">
                    <strong>{review.metadata.reason_label}</strong>
                    <p>{review.metadata.reason_detail}</p>
                  </div>
                ) : null}
                {fields.map((field, fieldIndex) => (
                  <div className="order-review-field" key={`${field.field || field.label}-${fieldIndex}`}>
                    <strong>{field.label || "Campo actualizado"}</strong>
                    <div className="order-review-values">
                      <div><span>Antes</span><p>{displayValue(field.field, field.old_value)}</p></div>
                      <div><span>Después</span><p>{displayValue(field.field, field.new_value)}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {error ? <p className="order-review-error" role="alert">{error}</p> : null}
      {onAcknowledge ? (
        <div className="order-review-actions">
          <button type="button" onClick={onAcknowledge} disabled={acknowledging}>
            {acknowledging ? "Confirmando..." : "Entendido"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
