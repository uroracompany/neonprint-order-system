import {
  CLIENT_FLOW_STEPS,
  CLIENT_FLOW_STEPS_EXTERNAL,
  CLIENT_STATUS_MAP,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PRODUCTION_FILE_STATUS,
  PRODUCTION_FILE_STATUS_LABELS,
  isPaymentPaid,
  isPaymentCredit,
  isPaymentPartial,
  normalizeOrderStatus,
  formatDate,
} from "../utils/constants";

const PRODUCTION_FILE_STEP_MAP = {
  [PRODUCTION_FILE_STATUS.PENDING]: ORDER_STATUS.IN_PRODUCTION,
  [PRODUCTION_FILE_STATUS.IN_PRODUCTION]: ORDER_STATUS.IN_PRODUCTION,
  [PRODUCTION_FILE_STATUS.IN_TERMINATION]: ORDER_STATUS.IN_TERMINATION,
  [PRODUCTION_FILE_STATUS.COMPLETED]: ORDER_STATUS.IN_COMPLETED,
};

const PRODUCTION_FILE_STATUS_CLASS = {
  [PRODUCTION_FILE_STATUS.PENDING]: "pending",
  [PRODUCTION_FILE_STATUS.IN_PRODUCTION]: "production",
  [PRODUCTION_FILE_STATUS.IN_TERMINATION]: "termination",
  [PRODUCTION_FILE_STATUS.COMPLETED]: "completed",
};

const PRODUCTION_PART_COLUMNS = [
  { key: ORDER_STATUS.IN_PRODUCTION, label: "Producción" },
  { key: ORDER_STATUS.IN_TERMINATION, label: "Terminación" },
  { key: ORDER_STATUS.IN_COMPLETED, label: "Lista para entrega" },
];

const normalizePublicProductionFiles = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getProductionFileStepKey = (file) => (
  PRODUCTION_FILE_STEP_MAP[file?.status] || ORDER_STATUS.IN_PRODUCTION
);

const getProductionFileStatusLabel = (status) => (
  status === PRODUCTION_FILE_STATUS.PENDING
    ? "Por iniciar"
    : PRODUCTION_FILE_STATUS_LABELS[status] || "Por iniciar"
);

const getProductionFileStatusClass = (status) => (
  PRODUCTION_FILE_STATUS_CLASS[status] || PRODUCTION_FILE_STATUS_CLASS[PRODUCTION_FILE_STATUS.PENDING]
);

const groupProductionFilesByStep = (files) => (
  files.reduce((acc, file) => {
    const stepKey = getProductionFileStepKey(file);
    if (!acc[stepKey]) acc[stepKey] = [];
    acc[stepKey].push(file);
    return acc;
  }, {})
);

const renderProductionFileBadge = (file, mode) => {
  const status = file?.status || PRODUCTION_FILE_STATUS.PENDING;
  const fallbackLabel = file?.file_index ? `Parte ${file.file_index} del pedido` : "Parte del pedido";
  const label = file?.display_label || fallbackLabel;
  const area = file?.production_area_label || "Sin clasificar";
  const statusLabel = getProductionFileStatusLabel(status);

  return (
    <span
      key={`${mode}-${file?.file_index || label}-${status}`}
      className={`ftc-file-chip ${mode} ${getProductionFileStatusClass(status)}`}
    >
      <span className="ftc-file-dot" />
      <span className="ftc-file-name">{label}</span>
      <span className="ftc-file-area">{area}</span>
      <span className="ftc-file-status">{statusLabel}</span>
    </span>
  );
};

export function FlowTrackClient({ status, events, order, designType, productionFiles: productionFilesProp }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const clientStatus = CLIENT_STATUS_MAP[normalizedStatus];
  const isExternal = designType === "EXTERNAL_DESING";
  const steps = isExternal ? CLIENT_FLOW_STEPS_EXTERNAL : CLIENT_FLOW_STEPS;
  const currentStepIdx = steps.findIndex((s) => s.key === clientStatus);
  const isCancelled = normalizedStatus === ORDER_STATUS.CANCELLED;
  const paymentStatus = order?.payment_status;
  const isPaymentPending = !paymentStatus || paymentStatus === PAYMENT_STATUS.PENDING;
  const isPartialPayment = isPaymentPartial(paymentStatus);
  const isCreditPayment = isPaymentCredit(paymentStatus);
  const productionFiles = normalizePublicProductionFiles(productionFilesProp ?? order?.production_files);
  const productionFilesByStep = groupProductionFilesByStep(productionFiles);
  const productionPartColumns = PRODUCTION_PART_COLUMNS.map((column) => ({
    ...column,
    files: productionFilesByStep[column.key] || [],
  }));

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
    const isQuoteConfirmed = step.key === ORDER_STATUS.IN_QUOTE && i <= currentStepIdx && isPaymentPaid(paymentStatus);
    const isQuotePartial = step.key === ORDER_STATUS.IN_QUOTE && i <= currentStepIdx && isPartialPayment;
    const isQuoteCredit = step.key === ORDER_STATUS.IN_QUOTE && i <= currentStepIdx && isCreditPayment;
    return { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed, isQuotePartial, isQuoteCredit };
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
        <div className={`ftc-timeline-horizontal ${productionFiles.length > 0 ? "with-files" : ""}`}>
          <div className="ftc-h-track">
            {steps.map((step, i) => {
              const { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed, isQuotePartial, isQuoteCredit } = getStepState(step, i);
              const hasDate = !!eventDates[step.key];

              return (
                <div key={step.key} className="ftc-h-step-wrap">
                  <div className={`ftc-h-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""} ${isQuoteBlocked ? "blocked" : ""} ${isQuotePartial ? "partial" : ""}`}>
                    <div className={`ftc-h-circle ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuotePartial ? "partial" : isQuoteBlocked ? "blocked" : isActive ? "active" : ""}`}>
                      {isCompleted && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                      {isQuoteBlocked && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      )}
                      {!isCompleted && isQuoteConfirmed && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                      {!isCompleted && !isQuoteBlocked && !isQuotePartial && isActive && <div className="ftc-h-pulse" />}
                      {!isCompleted && !isActive && <span className="ftc-h-num">{i + 1}</span>}
                    </div>
                    <span className={`ftc-h-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                      {step.label}
                    </span>
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
                    {isQuotePartial && (
                      <span className="ftc-h-badge partial">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Pago parcial
                      </span>
                    )}
                    {isQuoteCredit && (
                      <span className="ftc-h-badge partial">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Pago a crédito
                      </span>
                    )}
                    {hasDate && <span className="ftc-h-date">{formatDate(eventDates[step.key])}</span>}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`ftc-h-line ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuoteBlocked ? "pending-payment" : ""}`} />
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
            {isPartialPayment && (
              <div className="ftc-h-message partial">
                No se puede entregar la orden hasta que esté totalmente pagada.
              </div>
            )}
          </div>

          {productionFiles.length > 0 && (
            <div className="ftc-part-band" aria-label="Partes del pedido por fase">
              {productionPartColumns.map((column) => (
                <section className="ftc-part-column" key={column.key}>
                  <div className="ftc-part-column-head">
                    <span>{column.label}</span>
                    <strong>{column.files.length}</strong>
                  </div>
                  <div className="ftc-part-list">
                    {column.files.length > 0 ? (
                      column.files.map((file) => renderProductionFileBadge(file, "horizontal"))
                    ) : (
                      <span className="ftc-part-empty">Sin partes en esta fase</span>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ====== Mobile: Vertical Timeline ====== */}
      {!isCancelled && currentStepIdx >= 0 && (
        <div className="ftc-timeline-vertical">
          {steps.map((step, i) => {
            const { isCompleted, isActive, isQuoteBlocked, isQuoteConfirmed, isQuotePartial, isQuoteCredit } = getStepState(step, i);
            const hasDate = !!eventDates[step.key];

            return (
              <div key={step.key} className={`ftc-v-step ${isCompleted ? "completed" : ""} ${isActive ? "active" : ""} ${isQuoteBlocked ? "blocked" : ""} ${isQuotePartial ? "partial" : ""}`}>
                <div className="ftc-v-indicator">
                  <div className={`ftc-v-dot ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuotePartial ? "partial" : isQuoteBlocked ? "blocked" : isActive ? "active" : ""}`}>
                    {isCompleted && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    {isQuoteBlocked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    )}
                    {!isCompleted && isQuoteConfirmed && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                    {isActive && !isQuoteBlocked && !isQuotePartial && <div className="ftc-v-pulse" />}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`ftc-v-line ${isCompleted ? "done" : isQuoteConfirmed ? "confirmed" : isQuoteBlocked ? "pending-payment" : ""}`} />
                  )}
                </div>
                <div className="ftc-v-body">
                  <span className={`ftc-v-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                    {step.label}
                  </span>
                  <div className="ftc-v-meta">
                    {isQuoteBlocked && (
                      <span className="ftc-v-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        Pago pendiente
                      </span>
                    )}
                    {isQuoteConfirmed && (
                      <span className="ftc-v-badge confirmed">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Pago confirmado
                      </span>
                    )}
                    {isQuotePartial && (
                      <span className="ftc-v-badge partial">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Pago parcial
                      </span>
                    )}
                    {isQuoteCredit && (
                      <span className="ftc-v-badge partial">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Pago a crédito
                      </span>
                    )}
                    {hasDate && <span className="ftc-v-date">{formatDate(eventDates[step.key])}</span>}
                  </div>
                  {/* Mensaje que aparece cuando la cotización está bloqueada */}
                  {isQuoteBlocked && (
                    <span className="ftc-v-message">El proceso continuará cuando el pago sea confirmado</span>
                  )}
                  {isQuotePartial && (
                    <span className="ftc-v-message partial">No se puede entregar la orden hasta que esté totalmente pagada.</span>
                  )}
                  {productionFilesByStep[step.key]?.length > 0 && (
                    <div className="ftc-v-files" aria-label={`Partes del pedido en ${step.label}`}>
                      {productionFilesByStep[step.key].map((file) => renderProductionFileBadge(file, "vertical"))}
                    </div>
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
