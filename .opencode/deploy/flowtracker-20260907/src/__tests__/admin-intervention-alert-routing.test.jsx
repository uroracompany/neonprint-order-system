import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminInterventionAlert from "../components/orders/AdminInterventionAlert";

const { mockUseAuth, mockUseOrderEventReviews } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseOrderEventReviews: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({ useAuth: mockUseAuth }));
vi.mock("../hooks/useOrderEventReviews", () => ({ default: mockUseOrderEventReviews }));

const pendingReview = {
  order_id: "order-1",
  label: "Intervenida por Administracion",
  count: 1,
  reviews: [{
    id: "review-1",
    order_id: "order-1",
    event_key: "admin_intervention",
    actor_name: "Admin",
    created_at: "2026-06-30T12:00:00.000Z",
    changed_fields: [],
  }],
};

const reviewState = {
  pendingByOrder: { "order-1": pendingReview },
  pendingNotices: [{
    id: "review-1",
    order_id: "order-1",
    event_key: "admin_intervention_notice",
    label: "Administración te asignó como responsable",
    summary: "Hola, Vendedor. Administración te asignó como responsable de la orden #NP-1.",
    metadata: { requires_ack: true, order_code: "NP-1", client_name: "Cliente" },
    created_at: "2026-06-30T12:00:00.000Z",
  }],
  acknowledgingOrderId: null,
  acknowledgeError: "",
  acknowledgeOrder: vi.fn(),
  acknowledgeReview: vi.fn(),
};

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AdminInterventionAlert />
  </MemoryRouter>
);

describe("AdminInterventionAlert routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, loading: false });
    mockUseOrderEventReviews.mockReturnValue(reviewState);
  });

  it("never loads or displays administrative reviews on the login route", () => {
    renderAt("/");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUseOrderEventReviews).not.toHaveBeenCalled();
  });

  it("does not load reviews on a private route without an authenticated user", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderAt("/production");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUseOrderEventReviews).not.toHaveBeenCalled();
  });

  it("displays the review only inside an authenticated user panel", () => {
    renderAt("/production");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockUseOrderEventReviews).toHaveBeenCalledWith("user-1");
  });

  it("acknowledges only the displayed review", () => {
    renderAt("/production");

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));

    expect(reviewState.acknowledgeReview).toHaveBeenCalledWith("review-1");
    expect(reviewState.acknowledgeOrder).not.toHaveBeenCalled();
  });
});
