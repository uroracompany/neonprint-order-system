import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildPaymentReceiptPath } from "../utils/uploadOrderAsset";

const orderId = "c2eb9744-c24b-4772-a865-1e2c82b116e6";
const gateway = readFileSync(resolve("server/storage-gateway.js"), "utf8");
const quotePage = readFileSync(resolve("src/pages/page-quote.jsx"), "utf8");
const dashboard = readFileSync(resolve("src/pages/dashboard.jsx"), "utf8");
const advancedSettings = readFileSync(resolve("src/components/orders/AdminAdvancedSettings.jsx"), "utf8");

describe("payment receipt upload path", () => {
  it("builds the order-scoped key required by the secure upload gateway", () => {
    vi.spyOn(Date, "now").mockReturnValue(1788060343974);

    expect(buildPaymentReceiptPath(orderId, "comprobante.png"))
      .toBe(`orders/${orderId}/payment-1788060343974-comprobante.png`);

    vi.restoreAllMocks();
  });

  it("keeps the gateway policy and every payment caller on the shared path helper", () => {
    expect(gateway).toContain('=== `orders/${orderId}`');
    expect(quotePage).toContain("buildPaymentReceiptPath(order.id, receiptFile.name)");
    expect(dashboard).toContain("buildPaymentReceiptPath(currentOrder.id, receiptFile.name)");
    expect(advancedSettings).toContain("buildPaymentReceiptPath(order.id, receiptFile.name)");
  });
});
