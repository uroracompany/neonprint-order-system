/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OrderReviewBadge from "../components/orders/OrderReviewBadge";
import OrderReviewCard from "../components/orders/OrderReviewCard";
import { groupOrderEventReviews } from "../hooks/useOrderEventReviews";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

const pendingReview = {
  order_id: "order-1",
  label: "Editada por Admin",
  count: 2,
  reviews: [
    {
      id: "review-1",
      order_id: "order-1",
      actor_name: "Admin Uno",
      created_at: "2026-06-27T10:00:00.000Z",
      changed_fields: [
        { field: "client", label: "Cliente", old_value: "Juan", new_value: "Pedro" },
      ],
    },
    {
      id: "review-2",
      order_id: "order-1",
      actor_name: "Admin Dos",
      created_at: "2026-06-27T11:00:00.000Z",
      changed_fields: [
        { field: "payment", label: "Pago", old_value: "Pending_Payment", new_value: "pagado" },
      ],
    },
  ],
};

describe("order event review UI", () => {
  it("groups multiple pending edits by order and resolves actor names", () => {
    const grouped = groupOrderEventReviews([
      { ...pendingReview.reviews[1], metadata: { actor_id: "admin-2" } },
      { ...pendingReview.reviews[0], metadata: { actor_id: "admin-1" } },
    ], { "admin-1": "Admin Uno", "admin-2": "Admin Dos" });

    expect(grouped["order-1"].count).toBe(2);
    expect(grouped["order-1"].label).toBe("Editada por Admin");
    expect(grouped["order-1"].reviews.map((review) => review.actor_name)).toEqual([
      "Admin Uno",
      "Admin Dos",
    ]);
  });

  it("shows a persistent badge with the pending edit count", () => {
    render(<OrderReviewBadge review={pendingReview} />);
    expect(screen.getByText("Editada por Admin · 2")).toBeInTheDocument();
  });

  it("renders before and after values and only acknowledges from the explicit button", async () => {
    const onAcknowledge = vi.fn();
    const user = userEvent.setup();
    render(<OrderReviewCard pendingReview={pendingReview} onAcknowledge={onAcknowledge} />);

    expect(screen.getByText("2 ediciones")).toBeInTheDocument();
    expect(screen.getByText("Juan")).toBeInTheDocument();
    expect(screen.getByText("Pedro")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Pagado")).toBeInTheDocument();
    expect(screen.queryByText("Pending_Payment")).not.toBeInTheDocument();
    expect(onAcknowledge).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Entendido" }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("normalizes legacy payment aliases on both sides without exposing unknown keys", () => {
    const aliasReview = {
      ...pendingReview,
      reviews: [{
        ...pendingReview.reviews[1],
        changed_fields: [
          { field: "payment_status", label: "Pago", old_value: "pending payment", new_value: "paid" },
          { field: "payment", label: "Pago", old_value: "future_internal_key", new_value: null },
        ],
      }],
    };

    render(<OrderReviewCard pendingReview={aliasReview} />);

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Pagado")).toBeInTheDocument();
    expect(screen.getByText("Estado de pago no disponible")).toBeInTheDocument();
    expect(screen.getByText("Sin definir")).toBeInTheDocument();
    expect(screen.queryByText("future_internal_key")).not.toBeInTheDocument();
  });

  it("normalizes status values and hides legacy assignment UUIDs", () => {
    const technicalReview = {
      ...pendingReview,
      reviews: [{
        ...pendingReview.reviews[0],
        changed_fields: [
          { field: "status", label: "Estado", old_value: "Pending", new_value: "in_Quote" },
          {
            field: "assignment",
            label: "Responsable",
            old_value: "23f4c317-5b5a-4af7-8e86-e3124f2f6b90",
            new_value: "Caja: Ana Pérez",
          },
        ],
      }],
    };

    render(<OrderReviewCard pendingReview={technicalReview} />);

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Caja")).toBeInTheDocument();
    expect(screen.getByText("Responsable asignado")).toBeInTheDocument();
    expect(screen.getByText("Caja: Ana Pérez")).toBeInTheDocument();
    expect(screen.queryByText("23f4c317-5b5a-4af7-8e86-e3124f2f6b90")).not.toBeInTheDocument();
  });

  it("keeps long histories inside a shared scroll region with the action outside", () => {
    const longReview = {
      ...pendingReview,
      count: 8,
      reviews: Array.from({ length: 8 }, (_, index) => ({
        ...pendingReview.reviews[index % pendingReview.reviews.length],
        id: `review-${index + 1}`,
      })),
    };

    const { container } = render(
      <OrderReviewCard pendingReview={longReview} onAcknowledge={vi.fn()} />
    );
    const timeline = container.querySelector(".order-review-timeline");
    const acknowledgeButton = screen.getByRole("button", { name: "Entendido" });
    const reviewCss = readProjectFile("src/components/orders/OrderReview.css");

    expect(screen.getByText("8 ediciones")).toBeInTheDocument();
    expect(timeline.querySelectorAll(".order-review-entry")).toHaveLength(8);
    expect(timeline).not.toContainElement(acknowledgeButton);
    expect(reviewCss).toContain("max-height: min(380px, 45vh)");
    expect(reviewCss).toContain("overflow-y: auto");
    expect(reviewCss).toContain("overscroll-behavior: contain");
    expect(reviewCss).toContain("scrollbar-gutter: stable");
  });
});
