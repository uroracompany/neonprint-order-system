import { CLIENT_FLOW_STEPS, CLIENT_FLOW_STEPS_EXTERNAL, CLIENT_STATUS_MAP, ORDER_STATUS, normalizeOrderStatus, formatDate } from "../utils/constants";

export function FlowTrackClient({ status, events, order, designType }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const clientStatus = CLIENT_STATUS_MAP[normalizedStatus];
  const isExternal = designType === "EXTERNAL_DESING";
  const steps = isExternal ? CLIENT_FLOW_STEPS_EXTERNAL : CLIENT_FLOW_STEPS;
  const currentStepIdx = steps.findIndex((s) => s.key === clientStatus);
  const isCancelled = normalizedStatus === ORDER_STATUS.CANCELLED;
  const paymentStatus = order?.payment_status;
  const isPaymentPending = paymentStatus && paymentStatus !== "pagado";

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

  const getStepState = (step, i) => {
    const isFinishedStatus = normalizedStatus === ORDER_STATUS.IN_COMPLETED || normalizedStatus === ORDER_STATUS.IN_DELIVERED;
    const isCompleted = currentStepIdx >= 0 && (i < currentStepIdx || (i === currentStepIdx && isFinishedStatus));
    const isActive = currentStepIdx >= 0 && i === currentStepIdx && !isFinishedStatus;
    const isQuoteBlocked = isActive && step.key === ORDER_STATUS.IN_QUOTE && isPaymentPending;
    const isQuoteConfirmed = step.key === ORDER_STATUS.IN_QUOTE && i <= currentStepIdx && paymentStatus === "pagado";
    return { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed };
  };

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

      {/* ====== Desktop: Horizontal Timeline ====== */}
      {!isCancelled && currentStepIdx >= 0 && (
        <div className="ftc-timeline-horizontal">
          {steps.map((step, i) => {
            const { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed } = getStepState(step, i);
            const hasDate = !!eventDates[step.key];

            return (
              <div key={step.key} className="ftc-h-step-wrap">
                <div className={`ftc-h-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""} ${isQuoteBlocked ? "blocked" : ""}`}>
                  <div className={`ftc-h-circle ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuoteBlocked ? "blocked" : isActive ? "active" : ""}`}>
                    {isCompleted && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                    {isQuoteBlocked && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    )}
                    {!isCompleted && isQuoteConfirmed && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                    {!isCompleted && !isQuoteBlocked && isActive && <div className="ftc-h-pulse" />}
                    {!isCompleted && !isActive && <span className="ftc-h-num">{i + 1}</span>}
                  </div>
                  <span className={`ftc-h-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                    {step.label}
                  </span>
                  {hasDate && <span className="ftc-h-date">{formatDate(eventDates[step.key])}</span>}
                  {isQuoteBlocked && (
                    <span className="ftc-h-badge">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      Pago pendiente
                    </span>
                  )}
                  {isQuoteConfirmed && (
                    <span className="ftc-h-badge confirmed">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      Pago confirmado
                    </span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className={`ftc-h-line ${isCompleted ? "done" : isQuoteConfirmed ? "done" : isQuoteBlocked ? "pending-payment" : ""}`} />
                )}
              </div>
            );
          })}
          {steps.some((_, i) => {
            const { isQuoteBlocked } = getStepState(steps[i], i);
            return isQuoteBlocked;
          }) && (
            <div className="ftc-h-message">
              El proceso continuará cuando el pago sea confirmado
            </div>
          )}
  
        </div>
      )}

      {/* ====== Mobile: Vertical Timeline ====== */}
      {!isCancelled && currentStepIdx >= 0 && (
        <div className="ftc-timeline-vertical">
          {steps.map((step, i) => {
            const { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed } = getStepState(step, i);
            const hasDate = !!eventDates[step.key];

            return (
              <div key={step.key} className={`ftc-v-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""} ${isQuoteBlocked ? "blocked" : ""}`}>
                <div className="ftc-v-indicator">
                  <div className={`ftc-v-dot ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuoteBlocked ? "blocked" : isActive ? "active" : ""}`}>
                    {isCompleted && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    {isQuoteBlocked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    )}
                    {!isCompleted && isQuoteConfirmed && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                    {isActive && !isQuoteBlocked && <div className="ftc-v-pulse" />}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`ftc-v-line ${isCompleted ? "done" : isQuoteConfirmed ? "done" : isQuoteBlocked ? "pending-payment" : ""}`} />
                  )}
                </div>
                <div className="ftc-v-body">
                  <span className={`ftc-v-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                    {step.label}
                  </span>
                  <div className="ftc-v-meta">
                    {hasDate && <span className="ftc-v-date">{formatDate(eventDates[step.key])}</span>}
                    {/* Badge que aparece cuando la cotización está bloqueada */}
                    {isQuoteBlocked && (
                      <span className="ftc-v-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        Pago pendiente
                      </span>
                    )}
                    {/* Etiqueta que aparece cuando la cotización está confirmada como pagada */}
                    {isQuoteConfirmed && (
                      <span className="ftc-v-badge confirmed">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Pago confirmado
                      </span>
                    )}
                  </div>
                  {/* Mensaje que aparece cuando la cotización está bloqueada */}
                  {isQuoteBlocked && (
                    <span className="ftc-v-message">El proceso continuará cuando el pago sea confirmado</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
