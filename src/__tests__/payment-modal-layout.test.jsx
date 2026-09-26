import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaymentFormModal from "../components/ui/PaymentFormModal";

const order = {
  id: "00000000-0000-0000-0000-000000000001",
  client_name: "Cliente de prueba",
  description: "Orden para validar el modal de pago.",
  client_phone: "+595 981 123456",
  payment_status: "Pending_Payment",
  status: "in_Quote",
};

describe("PaymentFormModal layout", () => {
  it("uses the shared portal layout and closes from its backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PaymentFormModal open order={order} onClose={onClose} onConfirm={vi.fn()} />);

    const overlay = document.body.querySelector(".pfm-file-details-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByRole("dialog")).toHaveClass("ps-file-details-modal", "pfm-modal");
    expect(screen.queryByText("Registro de pago")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gestionar pago" })).toBeInTheDocument();
    expect(screen.getByText("ORDEN #00000000")).toBeInTheDocument();
    expect(screen.getByLabelText("Iniciales de Cliente de prueba")).toHaveTextContent("CD");
    expect(screen.queryByText("Orden para validar el modal de pago.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono del cliente")).toHaveTextContent("+595 981 123456");
    expect(document.querySelector(".pfm-order-info .pfm-client-name + .pfm-order-phone")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeInTheDocument();

    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses a higher layer for nested payment opened from order details", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PaymentFormModal open nested order={order} onClose={onClose} onConfirm={vi.fn()} />);

    const overlay = document.body.querySelector(".pfm-nested-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay).toHaveClass("pfm-file-details-overlay");
    expect(getComputedStyle(overlay).zIndex).toBe("1400");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requires a billing code and verified image instead of a receipt-number fallback", async () => {
    const user = userEvent.setup();
    render(<PaymentFormModal open order={order} onClose={vi.fn()} onConfirm={vi.fn()} canAssignInvoiceCode />);

    await user.selectOptions(screen.getByRole("combobox"), "pagado");

    const invoiceNumber = screen.getByLabelText("Código de facturación");
    expect(invoiceNumber).toHaveClass("pfm-receipt-number-input");
    expect(invoiceNumber).toHaveAttribute("aria-describedby", "pfm-invoice-number-hint");
    expect(screen.queryByLabelText("Número de comprobante")).not.toBeInTheDocument();
    expect(screen.getByText("Guarda el código antes de completar el pago.")).toHaveClass("pfm-invoice-code-hint");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
  });

  it("renders Caja billing-code emphasis without changing the payment flow", () => {
    const cashierOrder = { ...order, invoice_assignment_mode: "cashier" };
    render(
      <PaymentFormModal
        open
        order={cashierOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={vi.fn()}
      />,
    );

    expect(screen.getByText("Código de facturación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar código" })).toHaveClass("pfm-save-invoice-btn");
    expect(screen.getByRole("button", { name: "Guardar código" })).toBeDisabled();
    expect(screen.getByText("Guarda el código antes de completar el pago.")).toHaveClass("pfm-invoice-code-hint");
  });

  it("does not trust an invoice_payment URL without persisted image verification", async () => {
    const user = userEvent.setup();
    const paidCandidate = {
      ...order,
      invoice_number: "FAC-001",
      invoice_payment: "supabase://payment-invoice/orders/00000000-0000-0000-0000-000000000001/payment-1-receipt.png",
    };
    const { rerender } = render(<PaymentFormModal open order={paidCandidate} onClose={vi.fn()} onConfirm={vi.fn()} />);

    await user.selectOptions(screen.getByRole("combobox"), "pagado");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();

    rerender(<PaymentFormModal open order={paidCandidate} onClose={vi.fn()} onConfirm={vi.fn()} hasVerifiedPaymentReceipt />);
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeEnabled();
  });
});
