import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaymentFormModal from "../components/ui/PaymentFormModal";
import { validateReceiptFile } from "../utils/receiptValidation";

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
  updated_at: "2026-06-11T10:00:00.000Z",
};

const paymentModalCss = readFileSync("src/components/ui/PaymentFormModal.css", "utf8");

function cssRule(source, selector) {
  const selectorStart = source.indexOf(`${selector} {`);
  if (selectorStart < 0) return "";
  const ruleStart = source.indexOf("{", selectorStart) + 1;
  const ruleEnd = source.indexOf("}", ruleStart);
  return source.slice(ruleStart, ruleEnd).trim();
}

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

  it("guides Caja to save a billing code before enabling the payment flow", async () => {
    const user = userEvent.setup();
    const onAssignInvoiceCode = vi.fn().mockResolvedValue({ invoice_number: "FAC-001" });
    render(
      <PaymentFormModal
        open
        order={order}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    const invoiceNumber = screen.getByLabelText("Código de facturación");
    const hint = screen.getByText(/Paso 1: registra y guarda el código/);
    const invoiceLabel = screen.getByText("Código de facturación");
    expect(invoiceNumber.closest(".pfm-receipt-number-field").compareDocumentPosition(screen.getByRole("combobox")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(invoiceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(invoiceNumber).toHaveClass("pfm-receipt-number-input");
    expect(invoiceNumber).toHaveAttribute("aria-describedby", "pfm-invoice-number-hint");
    expect(invoiceNumber.closest(".pfm-receipt-number-field")).toHaveClass("pfm-invoice-pending", "pfm-invoice-pending--editable");
    await waitFor(() => expect(invoiceNumber).toHaveFocus());
    expect(hint).toHaveClass("pfm-invoice-code-hint");
    expect(screen.getByRole("combobox")).toBeDisabled();

    await user.type(invoiceNumber, "FAC-001");
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByLabelText("Número de comprobante")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Guardar código" }));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.getByRole("combobox")).not.toHaveAttribute("disabled");
    expect(invoiceNumber).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Editar código" })).toBeInTheDocument();
    expect(screen.getByText(/Código guardado\. Puedes elegir el estado del pago/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "pagado");
    expect(await screen.findByText("Comprobante de pago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
    expect(onAssignInvoiceCode).toHaveBeenCalledWith(order, "FAC-001", expect.any(Function));
  });

  it("edits a saved pending invoice code only after choosing Editar código, then returns to read-only", async () => {
    const user = userEvent.setup();
    let acknowledgeSavedOrder;
    const onAssignInvoiceCode = vi.fn(async (_currentOrder, invoiceNumber, acknowledge) => {
      acknowledgeSavedOrder = acknowledge;
      const updated = { ...order, invoice_number: invoiceNumber, updated_at: "2026-06-11T10:01:00.000Z" };
      acknowledge(updated);
      return updated;
    });
    render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    const input = screen.getByLabelText("Código de facturación");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue("FAC-001");
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    expect(input).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "FAC-002");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onAssignInvoiceCode).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id, invoice_number: "FAC-001" }),
      "FAC-002",
      expect.any(Function),
    ));
    await waitFor(() => expect(input).toHaveAttribute("readonly"));
    expect(input).toHaveValue("FAC-002");
    expect(screen.getByRole("button", { name: "Editar código" })).toBeInTheDocument();
    expect(acknowledgeSavedOrder).toEqual(expect.any(Function));
  });

  it.each(["parcial", "credito", "pagado"])("keeps a saved cashier invoice read-only after confirming status %s", async (paymentStatus) => {
    const onAssignInvoiceCode = vi.fn();
    render(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: paymentStatus, invoice_assignment_mode: "cashier", invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    expect(screen.getByLabelText("Código de facturación")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Editar código" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(onAssignInvoiceCode).not.toHaveBeenCalled();
  });

  it("keeps the missing-code blocker after a rejected or unconfirmed save", async () => {
    const user = userEvent.setup();
    const onAssignInvoiceCode = vi.fn().mockRejectedValue(new Error("No se pudo guardar en el servidor."));
    render(<PaymentFormModal open order={order} onClose={vi.fn()} onConfirm={vi.fn()} canAssignInvoiceCode onAssignInvoiceCode={onAssignInvoiceCode} />);

    const invoiceNumber = screen.getByLabelText("Código de facturación");
    await user.type(invoiceNumber, "FAC-BORRADOR");
    expect(screen.getByRole("combobox")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Guardar código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar en el servidor.");
    expect(invoiceNumber).toHaveValue("FAC-BORRADOR");
    expect(screen.getByRole("combobox")).toBeDisabled();

    onAssignInvoiceCode.mockResolvedValueOnce({});
    await user.click(screen.getByRole("button", { name: "Guardar código" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El servidor no confirmó el código de facturación.");
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("keeps the saved invoice and editable draft after an edit save error", async () => {
    const user = userEvent.setup();
    const onAssignInvoiceCode = vi.fn()
      .mockRejectedValueOnce(new Error("No se pudo guardar la edición."));
    render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    const input = screen.getByLabelText("Código de facturación");
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    await user.clear(input);
    await user.type(input, "FAC-BORRADOR");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar la edición.");
    expect(input).toHaveValue("FAC-BORRADOR");
    expect(input).not.toHaveAttribute("readonly");
    expect(onAssignInvoiceCode).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id, invoice_number: "FAC-001" }),
      "FAC-BORRADOR",
      expect.any(Function),
    );
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  });

  it("retains an edited invoice draft and blocks writes after the server reports ORDER_STALE", async () => {
    const user = userEvent.setup();
    const staleError = Object.assign(new Error("ORDER_STALE"), { code: "ORDER_STALE" });
    const onAssignInvoiceCode = vi.fn().mockRejectedValue(staleError);
    render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    const input = screen.getByLabelText("Código de facturación");
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    await user.clear(input);
    await user.type(input, "FAC-BORRADOR");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/la orden cambió en otro lugar/i);
    expect(input).toHaveValue("FAC-BORRADOR");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(onAssignInvoiceCode).toHaveBeenCalledOnce();
  });

  it("does not show the initial Pending blocker until Caja selects Pendiente", async () => {
    const user = userEvent.setup();
    const invoiceOrder = { ...order, invoice_number: "FAC-001" };
    render(<PaymentFormModal open order={invoiceOrder} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.queryByText("El pago no puede confirmarse como Pendiente.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).not.toHaveAttribute("aria-describedby", "pfm-payment-block-reason");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Pending_Payment" } });
    expect(await screen.findByRole("status")).toHaveTextContent("El pago no puede confirmarse como Pendiente.");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toHaveAttribute("aria-describedby", "pfm-payment-block-reason");
    await user.selectOptions(screen.getByRole("combobox"), "parcial");
    expect(screen.queryByText("El pago no puede confirmarse como Pendiente.")).not.toBeInTheDocument();
  });

  it("keeps seller-assigned invoice codes read-only but allows payment status when a code exists", () => {
    const sellerOrder = { ...order, invoice_assignment_mode: "seller", invoice_number: "FAC-VEN-001" };
    const sellerView = render(<PaymentFormModal open order={sellerOrder} onClose={vi.fn()} onConfirm={vi.fn()} canManagePayment />);

    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByLabelText("Código de facturación")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar código" })).not.toBeInTheDocument();
    sellerView.unmount();
  });

  it("gives the seller-assigned invoice a next step and preserves read-only permissions", () => {
    const sellerView = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_assignment_mode: "seller" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode={false}
        canManagePayment
      />,
    );

    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByLabelText("Código de facturación")).toBeDisabled();
    expect(screen.getByText(/Caja no puede asignar este código\. Solicita a Ventas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar código" })).not.toBeInTheDocument();
    sellerView.unmount();

    const readOnly = render(
      <PaymentFormModal
        open
        order={order}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        canManagePayment={false}
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar código" })).not.toBeInTheDocument();
    expect(screen.getByText(/Modo lectura: solicita al responsable de la orden/)).toBeInTheDocument();
    readOnly.unmount();

    const noPaymentPermission = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canManagePayment={false}
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
    noPaymentPermission.unmount();
  });

  it("enables partial payment only when the order already has a saved billing code", () => {
    const invoiceOrder = { ...order, payment_status: "parcial", invoice_number: "FAC-001" };
    render(<PaymentFormModal open order={invoiceOrder} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Confirmar pago parcial" })).toBeEnabled();
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

  it("keeps an already-confirmed credit invoice locked in Caja", async () => {
    const onAssignInvoiceCode = vi.fn();
    const creditOrder = { ...order, payment_status: "credito", invoice_assignment_mode: "cashier", invoice_number: "FAC-001", client_id: "client-001" };
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
    expect(screen.getByLabelText("Código de facturación")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Editar código" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(onAssignInvoiceCode).not.toHaveBeenCalled();
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

  it.each([
    ["smooth", false],
    ["auto", true],
  ])("scrolls the modal body on every transition to Pagado (%s)", async (behavior, reducedMotion) => {
    const user = userEvent.setup();
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    const windowScrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollTo");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: reducedMotion }),
    });
    const windowScroll = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: windowScroll });

    const view = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const modalBody = document.querySelector(".pfm-modal .ps-modal-body");
    const bodyScroll = vi.fn();
    Object.defineProperty(modalBody, "scrollTop", { configurable: true, writable: true, value: 20 });
    Object.defineProperty(modalBody, "scrollTo", { configurable: true, value: bodyScroll });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect() {
      if (this === modalBody) return { top: 30 };
      if (this.classList?.contains("pfm-receipt-section")) return { top: 180 };
      return { top: 0 };
    });

    try {
      await user.selectOptions(screen.getByRole("combobox"), "pagado");
      expect(await screen.findByText("Comprobante de pago")).toBeInTheDocument();
      await waitFor(() => expect(bodyScroll).toHaveBeenCalledOnce());
      expect(bodyScroll).toHaveBeenCalledWith({ top: 170, behavior });
      expect(windowScroll).not.toHaveBeenCalled();

      await user.selectOptions(screen.getByRole("combobox"), "parcial");
      await user.selectOptions(screen.getByRole("combobox"), "pagado");
      await waitFor(() => expect(bodyScroll).toHaveBeenCalledTimes(2));
      expect(bodyScroll).toHaveBeenNthCalledWith(2, { top: 170, behavior });
    } finally {
      view.unmount();
      rectSpy.mockRestore();
      if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
      else delete window.matchMedia;
      if (windowScrollDescriptor) Object.defineProperty(window, "scrollTo", windowScrollDescriptor);
      else delete window.scrollTo;
    }
  });

  it("does not auto-scroll when opened as already paid or in correction mode", async () => {
    const paidView = render(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "pagado", invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const paidBody = document.querySelector(".pfm-modal .ps-modal-body");
    const paidScroll = vi.fn();
    Object.defineProperty(paidBody, "scrollTo", { configurable: true, value: paidScroll });
    await waitFor(() => expect(document.querySelector(".pfm-receipt-section")).toBeTruthy());
    expect(paidScroll).not.toHaveBeenCalled();
    paidView.unmount();

    const correctionView = render(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "pagado", invoice_number: "FAC-001" }}
        correctionMode
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const correctionBody = document.querySelector(".pfm-modal .ps-modal-body");
    const correctionScroll = vi.fn();
    Object.defineProperty(correctionBody, "scrollTo", { configurable: true, value: correctionScroll });
    expect(screen.getByLabelText("Código de facturación")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Editar código" })).not.toBeInTheDocument();
    expect(document.querySelector(".pfm-receipt-section")).not.toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "Pending_Payment");
    expect(correctionScroll).not.toHaveBeenCalled();
    correctionView.unmount();
  });

  it("adds attention only to the enabled empty receipt uploader and keeps replacement/error states distinct", async () => {
    const user = userEvent.setup();
    const view = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox"), "pagado");
    const emptyUploader = document.querySelector(".pfm-receipt-section .file-upload-zone");
    expect(emptyUploader).toHaveClass("pfm-receipt-upload-attention");
    expect(emptyUploader).not.toHaveClass("is-disabled", "is-error");

    validateReceiptFile.mockResolvedValueOnce({
      isValid: false,
      error: "La imagen no es válida.",
      previewAvailable: false,
    });
    fireEvent.change(emptyUploader.querySelector("input[type='file']"), {
      target: { files: [new File(["not image"], "receipt.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(emptyUploader).toHaveClass("is-error"));
    expect(emptyUploader).not.toHaveClass("pfm-receipt-upload-attention");

    view.rerender(
      <PaymentFormModal
        open
        loading
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const disabledUploader = document.querySelector(".pfm-receipt-section .file-upload-zone");
    expect(disabledUploader).toHaveClass("is-disabled");
    expect(disabledUploader).not.toHaveClass("pfm-receipt-upload-attention");

    view.unmount();
    validateReceiptFile.mockResolvedValue({ isValid: true, previewAvailable: true });
    const replacementView = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "pagado");
    const uploadInput = document.querySelector(".pfm-receipt-section .file-upload-zone input[type='file']");
    fireEvent.change(uploadInput, {
      target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(document.querySelector(".pfm-receipt-card")).toBeInTheDocument());
    const replacementPicker = document.querySelector(".pfm-receipt-card .file-upload-zone");
    expect(replacementPicker).toHaveClass("file-upload-zone--hidden-picker");
    expect(replacementPicker).not.toHaveClass("pfm-receipt-upload-attention");
    replacementView.unmount();

  });

  it("keeps receipt attention brief, state-aware, and disabled for reduced motion", () => {
    const attentionRule = paymentModalCss.match(/\.pfm-modal\s+\.file-upload-zone\.pfm-receipt-upload-attention[^{]*\{[^}]*\}/s)?.[0] || "";
    const reducedMotionRule = paymentModalCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*(?:\}[^}]*)?)\}/s)?.[0] || "";

    expect(attentionRule).toContain(":not(.is-disabled)");
    expect(attentionRule).toContain(":not(.is-error)");
    expect(attentionRule).toContain(":not(.is-focused)");
    expect(attentionRule).toContain(":not(.is-drag-over)");
    expect(attentionRule).toContain(":not(:focus-visible)");
    expect(attentionRule).toMatch(/animation:\s*pfm-receipt-upload-attention-pulse\s+1\.1s\s+ease-out\s+1/);
    expect(paymentModalCss).toMatch(/@keyframes\s+pfm-receipt-upload-attention-pulse/);
    expect(reducedMotionRule).toContain("prefers-reduced-motion: reduce");
    expect(reducedMotionRule).toMatch(/animation:\s*none/);
  });

  it("preserves the current saved-code confirmation message", async () => {
    const user = userEvent.setup();
    render(
      <PaymentFormModal
        open
        order={order}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={vi.fn().mockResolvedValue({ invoice_number: "FAC-001" })}
      />,
    );

    await user.type(screen.getByLabelText("Código de facturación"), "FAC-001");
    await user.click(screen.getByRole("button", { name: "Guardar código" }));
    const savedMessage = await screen.findByText("Código guardado. Puedes elegir el estado del pago o editar el código mientras siga pendiente.");
    const savedHintRule = paymentModalCss.match(/\.pfm-invoice-code-hint\.pfm-invoice-code-hint--saved\s*\{[^}]*\}/i)?.[0] || "";

    expect(savedMessage).toHaveClass("pfm-receipt-number-hint", "pfm-invoice-code-hint", "pfm-invoice-code-hint--saved");
    expect(paymentModalCss).toMatch(/\.pfm-invoice-code-hint\s*\{[^}]*color:\s*#f43f5e/i);
    expect(savedHintRule).toMatch(/color:\s*#166534/i);
  });

  it("keeps the initial step and edit instruction pink instead of marking them as saved", async () => {
    const user = userEvent.setup();
    const view = render(
      <PaymentFormModal
        open
        order={order}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={vi.fn()}
      />,
    );

    const initialStep = screen.getByText(/Paso 1: registra y guarda el código/);
    expect(initialStep).toHaveClass("pfm-invoice-code-hint");
    expect(initialStep).not.toHaveClass("pfm-invoice-code-hint--saved");
    expect(paymentModalCss).toMatch(/\.pfm-invoice-code-hint\s*\{[^}]*color:\s*#f43f5e/i);

    view.unmount();
    render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    const editInstruction = screen.getByText("Guarda los cambios antes de confirmar el pago.");
    expect(editInstruction).toHaveClass("pfm-invoice-code-hint");
    expect(editInstruction).not.toHaveClass("pfm-invoice-code-hint--saved");
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
    expect(screen.getByText(/Paso 1: registra y guarda el código/)).toHaveClass("pfm-invoice-code-hint");
  });

  it("keeps invoice and status controls on a simple shared rhythm and places the pink step hint first", () => {
    render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_assignment_mode: "cashier" }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={vi.fn()}
      />,
    );
    const hint = screen.getByText(/Paso 1: registra y guarda el código/);
    const invoiceLabel = screen.getByText("Código de facturación");
    const invoiceSurfaceRules = paymentModalCss.match(/\.pfm-receipt-number-field\s*\{[^}]*\}/g) || [];
    const invoiceSurfaceRule = invoiceSurfaceRules.at(-1) || "";
    const flatFieldRule = paymentModalCss.match(/\.pfm-field,\s*\.pfm-receipt-number-field\s*\{([^}]*)\}/)?.[1] || "";
    const receiptSectionRules = paymentModalCss.match(/\.pfm-receipt-section\s*\{[^}]*\}/g) || [];
    const receiptSectionRule = receiptSectionRules.at(-1) || "";
    const hintRules = paymentModalCss.match(/\.pfm-invoice-code-hint\s*\{[^}]*\}/g) || [];
    const pinkHintRule = hintRules.find((rule) => /color:\s*#f43f5e/i.test(rule));

    expect(hint.compareDocumentPosition(invoiceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinkHintRule).toBeTruthy();
    expect(invoiceSurfaceRule).toMatch(/padding:\s*0/i);
    expect(invoiceSurfaceRule).toMatch(/border:\s*0/i);
    expect(invoiceSurfaceRule).toMatch(/background:\s*transparent/i);
    expect(flatFieldRule).toMatch(/padding:\s*0/i);
    expect(flatFieldRule).toMatch(/border:\s*0/i);
    expect(flatFieldRule).toMatch(/background:\s*transparent/i);
    expect(receiptSectionRule).toMatch(/padding:\s*17px/i);
    expect(receiptSectionRule).toMatch(/border:\s*1px solid #dbe5f2/i);
    expect(receiptSectionRule).toMatch(/border-radius:\s*14px/i);
    expect(receiptSectionRule).toMatch(/background:\s*#fbfdff/i);
    expect(paymentModalCss).not.toMatch(/\.pfm-invoice-pending(?:--editable)?\s*\{/i);
    expect(paymentModalCss).not.toContain("pfm-invoice-attention");
    expect(invoiceSurfaceRule).not.toMatch(/#(?:fff7ed|fffbeb|fef3c7|fde68a|f59e0b)/i);
  });

  it("limits the muted payment-control treatment to disabled state and retains responsive gutters", () => {
    const disabledSelectRule = cssRule(paymentModalCss, ".ps-file-details-modal.pfm-modal .pfm-select-wrap select:disabled");
    const activeSelectBlock = paymentModalCss.match(/\.ps-file-details-modal\.pfm-modal \.pfm-select-wrap select,\s*\.ps-file-details-modal\.pfm-modal \.pfm-receipt-number-input\s*\{([^}]*)\}/s)?.[1] || "";

    expect(disabledSelectRule).toMatch(/opacity:\s*0\.74/);
    expect(activeSelectBlock).toMatch(/background:\s*#f5f7fb/);
    expect(activeSelectBlock).not.toMatch(/opacity\s*:/);
    expect(paymentModalCss).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(paymentModalCss).toMatch(/\.pfm-modal\s+\.ps-modal-body\s*\{[^}]*padding-inline:\s*20px/s);
    expect(paymentModalCss).not.toMatch(/\.pfm-modal\s+\.pfm-receipt-number-field\s*\{/);
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

  it("retains local payment, invoice, and receipt drafts and blocks writes after a remote version change", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onAssignInvoiceCode = vi.fn();
    const { rerender } = render(
      <PaymentFormModal
        open
        order={{ ...order, invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox"), "pagado");
    const invoiceInput = screen.getByLabelText("Código de facturación");
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    await user.clear(invoiceInput);
    await user.type(invoiceInput, "FAC-BORRADOR");
    const receipt = new File(["receipt"], "comprobante-local.png", { type: "image/png" });
    fireEvent.change(document.body.querySelector("input[type='file']"), { target: { files: [receipt] } });
    await waitFor(() => expect(document.querySelector(".pfm-receipt-card")).toHaveTextContent("comprobante-local.png"));

    rerender(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "parcial", invoice_number: "FAC-REMOTA", updated_at: "2026-06-11T10:05:00.000Z" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/la orden cambió en otro lugar/i);
    expect(screen.getByRole("combobox")).toHaveValue("pagado");
    expect(invoiceInput).toHaveValue("FAC-BORRADOR");
    expect(document.querySelector(".pfm-receipt-card")).toHaveTextContent("comprobante-local.png");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    expect(onAssignInvoiceCode).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the modal draft and blocks writes when a successful snapshot omits the order", async () => {
    const onConfirm = vi.fn();
    const onAssignInvoiceCode = vi.fn();
    render(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "parcial", invoice_number: "FAC-001" }}
        remoteOrderMissing
        onClose={vi.fn()}
        onConfirm={onConfirm}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/cierra y vuelve a abrir/i);
    expect(screen.getByLabelText("Código de facturación")).toHaveValue("FAC-001");
    expect(screen.getByLabelText("Código de facturación")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Editar código" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pago parcial" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago parcial" }));
    expect(onAssignInvoiceCode).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("accepts its own invoice save without flagging conflict or dropping the receipt draft", async () => {
    const user = userEvent.setup();
    const pendingOrder = { ...order, invoice_number: "FAC-001" };
    const updatedOrder = { ...pendingOrder, invoice_number: "FAC-002", updated_at: "2026-06-11T10:01:00.000Z" };
    const onAssignInvoiceCode = vi.fn(async (_currentOrder, _invoiceNumber, acknowledge) => {
      acknowledge(updatedOrder);
      return updatedOrder;
    });
    const { rerender } = render(
      <PaymentFormModal
        open
        order={pendingOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    const invoiceInput = screen.getByLabelText("Código de facturación");
    await user.click(screen.getByRole("button", { name: "Editar código" }));
    await user.clear(invoiceInput);
    await user.type(invoiceInput, "FAC-002");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onAssignInvoiceCode).toHaveBeenCalled());
    rerender(
      <PaymentFormModal
        open
        order={updatedOrder}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        canAssignInvoiceCode
        onAssignInvoiceCode={onAssignInvoiceCode}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("Pending_Payment");
    expect(screen.getByLabelText("Código de facturación")).toHaveValue("FAC-002");
    expect(screen.getByLabelText("Código de facturación")).toHaveAttribute("readonly");
  });

  it("retains the receipt draft and reports ORDER_STALE returned by the server", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue({ ok: false, code: "ORDER_STALE" });
    render(
      <PaymentFormModal
        open
        order={{ ...order, payment_status: "pagado", invoice_number: "FAC-001" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await waitFor(() => expect(document.body.querySelector("input[type='file']")).toBeTruthy());
    const receipt = new File(["receipt"], "stale-receipt.png", { type: "image/png" });
    fireEvent.change(document.body.querySelector("input[type='file']"), { target: { files: [receipt] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/la orden cambió en otro lugar/i);
    expect(document.querySelector(".pfm-receipt-card")).toHaveTextContent("stale-receipt.png");
    expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeDisabled();
  });
});
