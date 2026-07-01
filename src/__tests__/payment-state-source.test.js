import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const readSource = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("payment state integration source guards", () => {
  it("no mantiene notificaciones frontend de exito que duplican el trigger de pagos", () => {
    const source = readSource("src/pages/page-quote.jsx");

    expect(source).not.toContain("partial_payment_confirmation");
    expect(source).not.toContain("paid_payment_confirmation");
    expect(source).not.toContain("Pago parcial registrado");
    expect(source).not.toContain("Pago confirmado");
  });

  it("muestra el estado de pago en las tarjetas de delivery", () => {
    const source = readSource("src/pages/page-delivery.jsx");
    const renderOrderCardStart = source.indexOf("const renderOrderCard = (order) => (");
    const renderOrderCardEnd = source.indexOf("return (", renderOrderCardStart);
    const renderOrderCardSource = source.slice(renderOrderCardStart, renderOrderCardEnd);

    expect(renderOrderCardStart).toBeGreaterThan(-1);
    expect(renderOrderCardSource).toContain("<PaymentBadge");
    expect(renderOrderCardSource).toContain("status={order.payment_status}");
    expect(renderOrderCardSource).not.toContain("labelOverride");
  });

  it("no expone el estado de pago en el modulo de diseno", () => {
    const source = readSource("src/pages/page-designer.jsx");

    expect(source).not.toContain("PaymentBadge");
    expect(source).not.toContain("order.payment_status");
    expect(source).not.toContain('"payment_status"');
    expect(source).not.toContain("<th>Pago</th>");
  });

  it("permite al admin elegir cualquier estado de pago sin restriccion de parcial", () => {
    const dashboard = readSource("src/pages/dashboard.jsx");
    const source = readSource("src/components/ui/PaymentFormModal.jsx");

    expect(dashboard).toContain("<PaymentFormModal");
    expect(source).not.toContain("isPaymentPartial(order.payment_status) ? PAYMENT_STATUS.PAID");
    expect(source).not.toContain("isCompletingPartialPayment");
    expect(source).toContain("<PaymentBadge status={order.payment_status}");
    expect(source).toContain('setPaymentStatus(orderPaymentStatus || "Pending_Payment")');
    expect(source).toContain("<option value={PAYMENT_STATUS.PENDING}>Pendiente</option>");
    expect(source).toContain("<option value={PAYMENT_STATUS.PARTIAL}>Pago parcial</option>");
    expect(source).toContain("<option value={PAYMENT_STATUS.CREDIT}>Pago a crédito</option>");
    expect(source).toContain("<option value={PAYMENT_STATUS.PAID}>Pagado</option>");
  });

  it("muestra comprobante de pago condicional en PAID con preview y boton estilo caja", () => {
    const source = readSource("src/components/ui/PaymentFormModal.jsx");

    expect(source).toContain("existingReceiptUrl");
    expect(source).toContain("receiptPreviewUrl");
    expect(source).toContain("receiptPreviewAvailable");
    expect(source).toContain("receiptZoneError");
    expect(source).toContain("receiptZoneErrorKey");
    expect(source).toContain("handleReceiptAccepted");
    expect(source).toContain("handleRemoveReceipt");
    expect(source).toContain("Comprobante de pago");
    expect(source).toContain("PAYMENT_RECEIPT_HINT");
    expect(source).toContain("file-upload-zone--hidden-picker");
    expect(source).toContain("> Cambiar");
    expect(source).toContain("Seleccionar desde el ordenador");
    expect(source).toContain("URL.createObjectURL(receiptFile)");
    expect(source).toContain("URL.revokeObjectURL");
    expect(source).toContain("!receiptFile && !order?.invoice_payment");
    expect(source).toContain("validateReceiptFile");
    expect(source).toContain("{paymentStatus === PAYMENT_STATUS.PAID && (");
    expect(source).not.toContain("No existe un comprobante de pago");
    expect(source).not.toContain("Imagen de Recibo/Factura");
    expect(source).not.toContain("variant=\"compact\"");
  });
});
