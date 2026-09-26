import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminOrderActions from "../components/orders/AdminOrderActions";
import { ORDER_STATUS } from "../utils/constants";

const activeOrder = {
  id: "order-1",
  status: ORDER_STATUS.PENDING,
  order_design_type: "INTERNAL_DESING",
};
const cashOrder = { ...activeOrder, status: ORDER_STATUS.IN_QUOTE };

describe("AdminOrderActions", () => {
  it("exposes every row operation in the modal and delegates to existing handlers", () => {
    const handlers = {
      onAdvanced: vi.fn(),
      onPayment: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
    };

    render(<AdminOrderActions order={cashOrder} variant="modal" {...handlers} />);

    fireEvent.click(screen.getByRole("button", { name: "Configuración avanzada" }));
    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar orden" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }));

    expect(handlers.onAdvanced).toHaveBeenCalledWith(cashOrder);
    expect(handlers.onPayment).toHaveBeenCalledWith(cashOrder);
    expect(handlers.onEdit).toHaveBeenCalledWith(cashOrder);
    expect(handlers.onCancel).toHaveBeenCalledWith(cashOrder);
  });

  it("preserves the row visibility rules for cancelled orders", () => {
    render(
      <AdminOrderActions
        order={{ ...activeOrder, status: ORDER_STATUS.CANCELLED }}
        variant="modal"
      />
    );

    expect(screen.queryByRole("button", { name: "Editar orden" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración avanzada" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument();
  });

  it("hides direct edit, payment, and cancellation for delivered orders", () => {
    render(
      <AdminOrderActions
        order={{ ...activeOrder, status: ORDER_STATUS.IN_DELIVERED }}
        variant="modal"
      />
    );

    expect(screen.queryByRole("button", { name: "Editar orden" })).not.toBeInTheDocument();
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

  it("leaves only the safe advanced route while an order is blocked", () => {
    render(
      <AdminOrderActions
        order={{ ...cashOrder, operational_status: "blocked" }}
        variant="modal"
      />
    );

    expect(screen.queryByRole("button", { name: "Editar orden" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configuración avanzada" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument();
  });

  it("uses the supplied command catalogue for commercial and lifecycle availability", () => {
    render(
      <AdminOrderActions
        order={cashOrder}
        variant="modal"
        commandCatalog={{ actions: [{ key: "return_to_quote" }] }}
      />
    );

    expect(screen.getByRole("button", { name: "Configuración avanzada" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar orden" })).not.toBeInTheDocument();
  });
});
