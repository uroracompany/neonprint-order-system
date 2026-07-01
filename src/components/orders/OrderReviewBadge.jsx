import "./OrderReview.css";

export default function OrderReviewBadge({ review, className = "" }) {
  if (!review) return null;
  const count = Number(review.count || review.reviews?.length || 1);

  return (
    <span className={`order-review-badge ${className}`.trim()}>
      {review.label || "Editada por Admin"}{count > 1 ? ` · ${count}` : ""}
    </span>
  );
}
