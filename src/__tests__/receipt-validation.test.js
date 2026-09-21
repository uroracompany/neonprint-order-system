import { describe, expect, it } from "vitest";
import {
  PAYMENT_RECEIPT_HINT,
  isReceiptPreviewUnavailable,
  validateReceiptFile,
} from "../utils/receiptValidation";

describe("receiptValidation", () => {
  it("expone el hint de formatos y limite de factura", () => {
    expect(PAYMENT_RECEIPT_HINT).toContain("PNG");
    expect(PAYMENT_RECEIPT_HINT).toContain("GIF");
    expect(PAYMENT_RECEIPT_HINT).not.toMatch(/HEIC|HEIF/i);
    expect(PAYMENT_RECEIPT_HINT).toContain("10 MB");
  });

  it("rechaza archivos no imagen para factura", async () => {
    const result = await validateReceiptFile(new File(["pdf"], "factura.pdf", { type: "application/pdf" }));

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/formato|imagen|soportado/i);
  });

  it("rechaza imagenes mayores al limite de payment-invoice", async () => {
    const file = new File([new Uint8Array(11 * 1024 * 1024)], "recibo.png", { type: "image/png" });
    const result = await validateReceiptFile(file);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain("10 MB");
  });

  it("rechaza HEIC e indica que debe convertirse", async () => {
    const file = new File(["heic"], "recibo.heic", { type: "image/heic" });
    const result = await validateReceiptFile(file);

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/convierte.*PNG.*JPG.*WebP.*GIF/i);
    expect(isReceiptPreviewUnavailable(file)).toBe(true);
  });
});
