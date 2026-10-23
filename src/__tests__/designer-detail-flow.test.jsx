import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowTracker, FlowTrackerExternal } from "../components/FlowTracker";
import { FLOW_STEPS, FLOW_STEPS_EXTERNAL, ORDER_STATUS } from "../utils/constants";

describe("order flow tracker variants", () => {
  it("keeps the default internal and external route labels", () => {
    const { rerender } = render(<FlowTracker status={ORDER_STATUS.IN_DESIGN} />);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Diseño")).toBeInTheDocument();

    rerender(<FlowTrackerExternal status={ORDER_STATUS.IN_QUOTE} />);
    expect(screen.queryByText("Diseño")).not.toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("supports a designer-start route and only displays authorization when requested", () => {
    const designerSteps = FLOW_STEPS.filter((step) => step.key !== ORDER_STATUS.PENDING);
    const { rerender } = render(
      <FlowTracker status={ORDER_STATUS.IN_DESIGN} steps={designerSteps} authorizationBadge />,
    );

    expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
    expect(screen.getByText("Diseño")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Autorizada · Lista para enviar");

    rerender(<FlowTracker status={ORDER_STATUS.IN_DESIGN} steps={FLOW_STEPS} />);
    expect(screen.queryByText("Autorizada · Lista para enviar")).not.toBeInTheDocument();
    expect(FLOW_STEPS_EXTERNAL.some((step) => step.key === ORDER_STATUS.IN_DESIGN)).toBe(false);
  });

});
