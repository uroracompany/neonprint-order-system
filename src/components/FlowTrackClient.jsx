import { CLIENT_FLOW_STEPS, CLIENT_STATUS_MAP, ORDER_STATUS, normalizeOrderStatus, formatDate } from "../utils/constants";

export function FlowTrackClient({ status, events, order }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const clientStatus = CLIENT_STATUS_MAP[normalizedStatus];
  const currentStepIdx = CLIENT_FLOW_STEPS.findIndex((s) => s.key === clientStatus);
  const isCancelled = normalizedStatus === ORDER_STATUS.CANCELLED;

  const eventDates = {};
  if (events) {
    events.forEach((e) => {
      if (e.new_status && CLIENT_STATUS_MAP[e.new_status]) {
        const mapped = CLIENT_STATUS_MAP[e.new_status];
        if (!eventDates[mapped]) {
          eventDates[mapped] = e.created_at;
        }
      }
    });
  }

  return (
    <div className="ftc-wrap">
      {isCancelled && (
        <div className="ftc-cancelled">
          <div className="ftc-cancelled-icon">⚠️</div>
          <div className="ftc-cancelled-text">
            <strong>Orden cancelada</strong>
            {order?.cancellation_reason && <p>{order.cancellation_reason}</p>}
          </div>
        </div>
      )}

      {!isCancelled && currentStepIdx === -1 && (
        <div className="ftc-pending">
          <div className="ftc-pending-spinner" />
          <span>Preparando tu orden...</span>
        </div>
      )}

      <div className="ftc-timeline">
        {CLIENT_FLOW_STEPS.map((step, i) => {
          const isCompleted = currentStepIdx >= 0 && i < currentStepIdx;
          const isActive = i === currentStepIdx;
          const hasDate = !!eventDates[step.key];
          const isQuoteSub = isActive && normalizedStatus === ORDER_STATUS.IN_QUOTE;

          return (
            <div
              key={step.key}
              className={`ftc-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""}`}
            >
              <div className="ftc-step-indicator">
                <div className={`ftc-dot ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                  {isCompleted && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  {isActive && <div className="ftc-dot-pulse" />}
                </div>
                {i < CLIENT_FLOW_STEPS.length - 1 && (
                  <div className={`ftc-line ${isCompleted ? "done" : ""}`} />
                )}
              </div>
              <div className="ftc-step-body">
                <span className={`ftc-step-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                  {step.label}
                </span>
                <div className="ftc-step-meta">
                  {hasDate && <span className="ftc-step-date">{formatDate(eventDates[step.key])}</span>}
                  {isQuoteSub && <span className="ftc-step-sub">En proceso de cotización</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
