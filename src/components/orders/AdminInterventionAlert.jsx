import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import useOrderEventReviews from "../../hooks/useOrderEventReviews";
import OrderReviewCard from "./OrderReviewCard";
import "./AdminInterventionAlert.css";

const PRIVATE_PANEL_PATHS = new Set([
  "/dashboard",
  "/designer",
  "/page-seller",
  "/quote",
  "/production",
  "/delivery",
]);

function AuthenticatedAdminInterventionAlert({ userId }) {
  const reviews = useOrderEventReviews(userId);
  const pending = useMemo(() => Object.values(reviews.pendingByOrder)
    .find((group) => group.reviews.some((review) => review.event_key === "admin_intervention")),
  [reviews.pendingByOrder]);

  if (!pending) return null;

  return (
    <div className="admin-intervention-alert-overlay" role="presentation">
      <div className="admin-intervention-alert" role="dialog" aria-modal="true" aria-label="Intervención administrativa recibida">
        <div className="admin-intervention-alert-title">
          <span>Acción administrativa</span>
          <h2>Esta orden cambió mientras trabajabas</h2>
          <p>Revisa el responsable, la etapa y el motivo antes de continuar.</p>
        </div>
        <OrderReviewCard
          pendingReview={pending}
          onAcknowledge={() => reviews.acknowledgeOrder(pending.order_id)}
          acknowledging={reviews.acknowledgingOrderId === pending.order_id}
          error={reviews.acknowledgeError}
        />
      </div>
    </div>
  );
}

export default function AdminInterventionAlert() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading || !user?.id || !PRIVATE_PANEL_PATHS.has(pathname)) return null;

  return <AuthenticatedAdminInterventionAlert key={user.id} userId={user.id} />;
}
