import { FLOW_STEPS, FLOW_STEPS_EXTERNAL, ORDER_STATUS, normalizeOrderStatus } from "../utils/constants";

function getStepStates(normalizedStatus, steps) {
  const idx = steps.findIndex(s => s.key === normalizedStatus);
  const isFinished = normalizedStatus === ORDER_STATUS.IN_COMPLETED || normalizedStatus === ORDER_STATUS.IN_DELIVERED;
  return steps.map((_, i) => ({
    isCompleted: idx >= 0 && (i < idx || (i === idx && isFinished)),
    isActive: idx >= 0 && i === idx && !isFinished,
  }));
}

export function FlowTracker({ status }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const stepStates = getStepStates(normalizedStatus, FLOW_STEPS);
  return (
    <div className="ps-flow">
      {FLOW_STEPS.map((step, i) => {
        const { isCompleted, isActive } = stepStates[i];
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={`ps-flow-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>{step.label}</span>
            </div>
            {i < FLOW_STEPS.length - 1 && <div className={`ps-flow-line ${isCompleted ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function FlowTrackerExternal({ status }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const stepStates = getStepStates(normalizedStatus, FLOW_STEPS_EXTERNAL);
  return (
    <div className="ps-flow">
      {FLOW_STEPS_EXTERNAL.map((step, i) => {
        const { isCompleted, isActive } = stepStates[i];
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", flex: i < FLOW_STEPS_EXTERNAL.length - 1 ? 1 : "none" }}>
            <div className="ps-flow-step">
              <div className={`ps-flow-circle ${isCompleted ? "done" : isActive ? "active" : ""}`}>
                {isCompleted ? "✓" : i + 1}
              </div>
              <span className={`ps-flow-label ${isCompleted ? "done" : isActive ? "active" : ""}`}>{step.label}</span>
            </div>
            {i < FLOW_STEPS_EXTERNAL.length - 1 && <div className={`ps-flow-line ${isCompleted ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}
