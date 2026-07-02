import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminOrderActions from "../components/orders/AdminOrderActions";
import { ORDER_STATUS } from "../utils/constants";

const activeOrder = {
  id: "order-1",
  status: ORDER_STATUS.PENDING,
  order_design_type: "INTERNAL_DESING",
};

describe("AdminOrderActions", () => {
  it("exposes every row operation in the modal and delegates to existing handlers", () => {
    const handlers = {
      onAdvanced: vi.fn(),
      onPayment: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(<AdminOrderActions order={activeOrder} variant="modal" {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Configuración avanzada" }));
    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar orden" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }));

    expect(handlers.onAdvanced).toHaveBeenCalledWith(activeOrder);
    expect(handlers.onPayment).toHaveBeenCalledWith(activeOrder);
    expect(handlers.onEdit).toHaveBeenCalledWith(activeOrder);
    expect(handlers.onCancel).toHaveBeenCalledWith(activeOrder);
  });

  it("preserves the row visibility rules for cancelled orders", () => {
    render(
      <AdminOrderActions
        order={{ ...activeOrder, status: ORDER_STATUS.CANCELLED }}
        variant="modal"
      />
    );

    expect(screen.getByRole("button", { name: "Editar orden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración avanzada" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument();
  });

  it("hides advanced settings for unsupported design types", () => {
    render(
      <AdminOrderActions
        order={{ ...activeOrder, order_design_type: "LEGACY" }}
        variant="modal"
      />
    );

    expect(screen.queryByRole("button", { name: "Configuración avanzada" })).not.toBeInTheDocument();
  });
});
