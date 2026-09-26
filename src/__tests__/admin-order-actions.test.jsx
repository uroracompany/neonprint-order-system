import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminOrderActions from "../components/orders/AdminOrderActions";
import { ORDER_STATUS, PAYMENT_STATUS } from "../utils/constants";

const activeOrder = {
  id: "order-1",
  status: ORDER_STATUS.PENDING,
  order_design_type: "INTERNAL_DESING",
};
const cashOrder = { ...activeOrder, status: ORDER_STATUS.IN_QUOTE };
const paidCashOrder = {
  ...cashOrder,
  payment_status: PAYMENT_STATUS.PAID,
  production_authorized_at: "2026-09-26T12:00:00.000Z",
  production_authorized_by: "cashier-1",
};

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

  it("shows direct production routing only for a paid order when the handler is provided", () => {
    const onProduction = vi.fn();
    const { rerender } = render(
      <AdminOrderActions
        order={paidCashOrder}
        onProduction={onProduction}
        variant="table"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Enviar a producción" }));
    expect(onProduction).toHaveBeenCalledWith(paidCashOrder);

    rerender(
      <AdminOrderActions
        order={cashOrder}
        onProduction={onProduction}
        variant="table"
      />
    );
    expect(screen.queryAllByRole("button", { name: "Enviar a producción" })).toHaveLength(0);
  });

  it("delegates the production action from the detail-modal variant", () => {
    const onProduction = vi.fn();
    render(
      <AdminOrderActions
        order={paidCashOrder}
        onProduction={onProduction}
        variant="modal"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Enviar a producción" }));
    expect(onProduction).toHaveBeenCalledWith(paidCashOrder);
  });

  it("disables production actions while authorization or assignment is busy", () => {
    const onAuthorizeProduction = vi.fn();
    const { rerender } = render(
      <AdminOrderActions
        order={{ ...paidCashOrder, production_authorized_at: null, production_authorized_by: null }}
        onAuthorizeProduction={onAuthorizeProduction}
        loadingAction
        variant="modal"
      />
    );

    const authorizingButton = screen.getByRole("button", { name: "Autorizando Producción..." });
    expect(authorizingButton).toBeDisabled();
    expect(authorizingButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(authorizingButton);
    expect(onAuthorizeProduction).not.toHaveBeenCalled();

    rerender(
      <AdminOrderActions
        order={paidCashOrder}
        onProduction={vi.fn()}
        operationalBusy
        variant="modal"
      />
    );

    const productionButton = screen.getByRole("button", { name: "Enviar a producción" });
    expect(productionButton).toBeDisabled();
    expect(productionButton).toHaveAttribute("aria-busy", "true");
  });

  it("hides authorization and routing for any archived queue state", () => {
    const archiveFields = [
      "is_archived",
      "is_archived_admin",
      "is_archived_designer",
      "is_archived_quote",
      "is_archived_production",
      "is_archived_delivery",
    ];

    for (const archiveField of archiveFields) {
      const { unmount } = render(
        <AdminOrderActions
          order={{ ...paidCashOrder, [archiveField]: true }}
          onAuthorizeProduction={vi.fn()}
          onProduction={vi.fn()}
          variant="modal"
        />
      );

      expect(screen.queryByRole("button", { name: "Autorizar Producción" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enviar a producción" })).not.toBeInTheDocument();
      unmount();
    }
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
