import { useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import useOrderEventReviews from "../../hooks/useOrderEventReviews";
import AdminInterventionNoticeModal from "./AdminInterventionNoticeModal";
import "./AdminInterventionAlert.css";

const PRIVATE_PANEL_PATHS = new Set([
  "/dashboard",
  "/designer",
  "/page-seller",
  "/quote",
  "/production",
  "/delivery",
]);

function AuthenticatedAdminInterventionAlert({ userId, profile }) {
  const reviews = useOrderEventReviews(userId);
  const pending = reviews.pendingNotices[0];

  if (!pending) return null;

  return (
    <AdminInterventionNoticeModal
      notice={pending}
      recipientName={profile?.name || profile?.email || ""}
      onAcknowledge={() => reviews.acknowledgeReview(pending.id)}
      acknowledging={reviews.acknowledgingOrderId === pending.id}
      error={reviews.acknowledgeError}
    />
  );
}

export default function AdminInterventionAlert() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading || !user?.id || !PRIVATE_PANEL_PATHS.has(pathname)) return null;

  return <AuthenticatedAdminInterventionAlert key={user.id} userId={user.id} profile={profile} />;
}
