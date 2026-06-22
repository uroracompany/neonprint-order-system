import { describe, expect, it } from "vitest";
import {
  PAYMENT_COLORS,
  PAYMENT_LABELS,
  PAYMENT_STATUS,
  isPaymentDeliveryEligible,
  isPaymentFinanciallySettled,
  isPaymentProductionEligible,
} from "../utils/constants";
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

  it("muestra el texto y reglas operativas para pago a credito", () => {
    expect(PAYMENT_LABELS[PAYMENT_STATUS.CREDIT]).toBe("Pago a crédito");
    expect(PAYMENT_COLORS[PAYMENT_STATUS.CREDIT].label).toBe("Pago a crédito");
    expect(getPaymentConfirmButtonLabel(PAYMENT_STATUS.CREDIT)).toBe("Aprobar crédito");
    expect(isPaymentProductionEligible(PAYMENT_STATUS.CREDIT)).toBe(true);
    expect(isPaymentDeliveryEligible(PAYMENT_STATUS.CREDIT)).toBe(true);
    expect(isPaymentFinanciallySettled(PAYMENT_STATUS.CREDIT)).toBe(false);
  });

  it("prioriza el estado de guardado", () => {
    expect(getPaymentConfirmButtonLabel(PAYMENT_STATUS.PARTIAL, true)).toBe("Confirmando...");
  });
});
