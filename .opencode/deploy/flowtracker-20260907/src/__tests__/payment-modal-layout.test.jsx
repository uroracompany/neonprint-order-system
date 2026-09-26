import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaymentFormModal from "../components/ui/PaymentFormModal";

const order = {
  id: "00000000-0000-0000-0000-000000000001",
  client_name: "Cliente de prueba",
  description: "Orden para validar el modal de pago.",
  payment_status: "Pending_Payment",
  status: "in_Quote",
};

describe("PaymentFormModal layout", () => {
  it("uses the shared nested portal layout without closing from its backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PaymentFormModal open order={order} onClose={onClose} onConfirm={vi.fn()} />);

    const overlay = document.body.querySelector(".pfm-file-details-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay.parentElement).toBe(document.body);
    expect(screen.getByRole("dialog")).toHaveClass("ps-file-details-modal", "pfm-modal");
    expect(screen.getByText("Registro de pago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeInTheDocument();

    await user.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the receipt number as an independent labelled field", async () => {
    const user = userEvent.setup();
    render(<PaymentFormModal open order={order} onClose={vi.fn()} onConfirm={vi.fn()} allowReceiptNumber />);

    await user.selectOptions(screen.getByRole("combobox"), "pagado");

    const receiptNumber = screen.getByLabelText("Número de comprobante");
    expect(receiptNumber).toHaveClass("pfm-receipt-number-input");
    expect(receiptNumber).toHaveAttribute("aria-describedby", "pfm-receipt-number-hint");
    expect(screen.getByText("Adjunta un comprobante o registra este número para confirmar el pago.")).toHaveClass("pfm-receipt-number-hint");
  });
});
