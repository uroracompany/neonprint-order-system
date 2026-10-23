import { FLOW_STEPS, FLOW_STEPS_EXTERNAL, ORDER_STATUS, normalizeOrderStatus } from "../utils/constants";

function getStepStates(normalizedStatus, steps) {
  const idx = steps.findIndex(s => s.key === normalizedStatus);
  const isFinished = normalizedStatus === ORDER_STATUS.IN_COMPLETED || normalizedStatus === ORDER_STATUS.IN_DELIVERED;
  return steps.map((_, i) => ({
    isCompleted: idx >= 0 && (i < idx || (i === idx && isFinished)),
    isActive: idx >= 0 && i === idx && !isFinished,
  }));
}

function FlowStepsView({ status, steps, authorizationBadge }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const stepStates = getStepStates(normalizedStatus, steps);
  return (
    <div className="ps-flow">
      {steps.map((step, i) => {
        const { isCompleted, isActive } = stepStates[i];
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={`ps-flow-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>{step.label}</span>
              {step.key === ORDER_STATUS.IN_QUOTE && authorizationBadge && (
                <span className="ps-flow-authorization" role="status">Autorizada · Lista para enviar</span>
              )}
            </div>
            {i < steps.length - 1 && <div className={`ps-flow-line ${isCompleted ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function FlowTracker({ status, steps = FLOW_STEPS, authorizationBadge = false }) {
  return <FlowStepsView status={status} steps={steps} authorizationBadge={authorizationBadge} />;
}

export function FlowTrackerExternal({ status, steps = FLOW_STEPS_EXTERNAL, authorizationBadge = false }) {
  return <FlowStepsView status={status} steps={steps} authorizationBadge={authorizationBadge} />;
}
