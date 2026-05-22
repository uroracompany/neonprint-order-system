import { FLOW_STEPS, FLOW_STEPS_EXTERNAL, ORDER_STATUS, normalizeOrderStatus } from "../utils/constants";

export function FlowTracker({ status }) {
  const normalizedStatus = normalizeOrderStatus(status);
  const idx = FLOW_STEPS.findIndex(s => s.key === normalizedStatus);
  return (
    <div className="ps-flow">
      {FLOW_STEPS.map((step, i) => {
        const isCompleted = idx >= 0 && i < idx;
        const isActive = i === idx;
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
  const statusToIndex = {
    [ORDER_STATUS.PENDING]: 0,
    [ORDER_STATUS.IN_QUOTE]: 1,
    [ORDER_STATUS.IN_PRODUCTION]: 2,
    [ORDER_STATUS.IN_TERMINATION]: 3,
    [ORDER_STATUS.IN_DELIVERED]: 4,
    [ORDER_STATUS.IN_COMPLETED]: 5,
    [ORDER_STATUS.CANCELLED]: -1,
  };
  const idx = statusToIndex[normalizedStatus] ?? -1;
  return (
    <div className="ps-flow">
      {FLOW_STEPS_EXTERNAL.map((step, i) => {
        const isCompleted = idx >= 0 && i < idx;
        const isActive = i === idx;
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
