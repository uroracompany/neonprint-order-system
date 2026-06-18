import { describe, expect, it } from "vitest";
import { PAYMENT_COLORS, PAYMENT_LABELS, PAYMENT_STATUS } from "../utils/constants";
import { getPaymentConfirmButtonLabel } from "../utils/paymentUi";

describe("getPaymentConfirmButtonLabel", () => {
  it("usa Pago parcial como etiqueta operativa global", () => {
    expect(PAYMENT_LABELS[PAYMENT_STATUS.PARTIAL]).toBe("Pago parcial");
    expect(PAYMENT_COLORS[PAYMENT_STATUS.PARTIAL].label).toBe("Pago parcial");
  });

  it("muestra el texto de pago parcial cuando el selector esta en parcial", () => {
    expect(getPaymentConfirmButtonLabel(PAYMENT_STATUS.PARTIAL)).toBe("Confirmar pago parcial");
  });

  it("muestra el texto de pago completo cuando el selector esta en pagado", () => {
    expect(getPaymentConfirmButtonLabel(PAYMENT_STATUS.PAID)).toBe("Confirmar pago");
  });

  it("prioriza el estado de guardado", () => {
    expect(getPaymentConfirmButtonLabel(PAYMENT_STATUS.PARTIAL, true)).toBe("Confirmando...");
  });
});
