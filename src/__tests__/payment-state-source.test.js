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

  it("prepara el modal admin para completar pagos parciales como pagados", () => {
    const source = readSource("src/pages/dashboard.jsx");

    expect(source).toContain("setQuotationPaymentStatus(isPaymentPartial(order.payment_status) ? PAYMENT_STATUS.PAID");
    expect(source).toContain("const isQuotationCompletingPartialPayment = isPaymentPartial(quotationOrder?.payment_status)");
    expect(source).toContain("disabled={quotationLoading || isQuotationCompletingPartialPayment}");
    expect(source).toContain("<PaymentBadge status={quotationOrder.payment_status}");
  });
});
