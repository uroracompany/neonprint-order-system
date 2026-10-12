import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaymentFormModal from "../components/ui/PaymentFormModal";

vi.mock("../utils/receiptValidation", () => ({
  PAYMENT_RECEIPT_HINT: "PNG, JPG/JPEG, WebP o GIF. Max. 10 MB",
  validateReceiptFile: vi.fn().mockResolvedValue({ isValid: true, previewAvailable: true }),
}));

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

  it("keeps the normal-flow block reason visible and accessible", async () => {
    const user = userEvent.setup();
    render(<PaymentFormModal open order={order} onClose={vi.fn()} onConfirm={vi.fn()} canAssignInvoiceCode />);

    const blockReason = screen.getByRole("status");
    expect(blockReason).toHaveAttribute("aria-live", "polite");
    expect(blockReason).toHaveTextContent("El pago no puede confirmarse como Pendiente.");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toHaveAttribute("aria-describedby", "pfm-payment-block-reason");

    await user.selectOptions(screen.getByRole("combobox"), "parcial");
    expect(screen.getByRole("status")).toHaveTextContent("Para marcar la orden como pago parcial debes registrar el código de facturación.");

    await user.type(screen.getByLabelText("Código de facturación"), "FAC-NO-GUARDADA");
    expect(screen.getByRole("status")).toHaveTextContent("Para marcar la orden como pago parcial debes registrar el código de facturación.");
  });

  it("keeps Pending disabled and requires a saved billing code for partial payment", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PaymentFormModal open order={order} onClose={vi.fn()} onConfirm={vi.fn()} canAssignInvoiceCode />);

    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "parcial");
    expect(screen.getByRole("button", { name: "Confirmar pago parcial" })).toBeDisabled();

    const invoiceNumber = screen.getByLabelText("Código de facturación");
    await user.type(invoiceNumber, "FAC-NO-GUARDADA");
    expect(screen.getByRole("button", { name: "Confirmar pago parcial" })).toBeDisabled();

    rerender(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "parcial", invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar pago parcial" })).toBeEnabled());
  });

  it("requires a saved billing code and linked client for credit", async () => {
    const user = userEvent.setup();
    const creditOrder = { ...order, payment_status: "credito", invoice_number: "FAC-001" };
    const { rerender } = render(<PaymentFormModal open order={creditOrder} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Aprobar crédito" })).toBeDisabled();

    rerender(
      <PaymentFormModal
        open
        order={{ ...creditOrder, client_id: "client-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Aprobar crédito" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Aprobar crédito" }));
  });

  it("shows the locally confirmed billing code after saving it in credit flow", async () => {
    const user = userEvent.setup();
    const onAssignInvoiceCode = vi.fn().mockResolvedValue({ invoice_number: "FAC-002" });
    const creditOrder = { ...order, payment_status: "credito", invoice_number: "FAC-001", client_id: "client-001" };
    render(
      <PaymentFormModal
        open
        order={creditOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    expect(screen.getByText("Facturación:").parentElement).toHaveTextContent("FAC-001");
    const invoiceNumber = screen.getByLabelText("Código de facturación");
    await user.clear(invoiceNumber);
    await user.type(invoiceNumber, "FAC-002");
    await user.click(screen.getByRole("button", { name: "Guardar código" }));

    await waitFor(() => expect(onAssignInvoiceCode).toHaveBeenCalledWith(creditOrder, "FAC-002"));
    await waitFor(() => expect(screen.getByText("Facturación:").parentElement).toHaveTextContent("FAC-002"));
  });

  it("enables paid only with a saved billing code and new validated receipt", async () => {
    const paidOrder = { ...order, payment_status: "pagado", invoice_number: "FAC-001" };
    render(<PaymentFormModal open order={paidOrder} onClose={vi.fn()} onConfirm={vi.fn()} />);

    const confirmButton = screen.getByRole("button", { name: "Confirmar pago" });
    expect(confirmButton).toBeDisabled();

    await waitFor(() => expect(document.body.querySelector("input[type='file']")).toBeTruthy());
    fireEvent.change(document.body.querySelector("input[type='file']"), {
      target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(confirmButton).toBeEnabled());
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeEnabled());
  });

  it("preserves the correction exception from paid to Pending or partial", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const paidOrder = { ...order, payment_status: "pagado", invoice_number: "FAC-001" };
    render(<PaymentFormModal open order={paidOrder} correctionMode onClose={vi.fn()} onConfirm={onConfirm} />);

    await user.selectOptions(screen.getByRole("combobox"), "Pending_Payment");
    const confirmButton = screen.getByRole("button", { name: "Guardar corrección" });
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith({
      paymentStatus: "Pending_Payment",
      receiptFile: null,
      invoiceNumber: "FAC-001",
      isPaymentCorrection: true,
    });
  });
});
