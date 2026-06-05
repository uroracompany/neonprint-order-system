import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS,
  formatUiTerms,
  getOrderStatusConfig,
  getOrderStatusLabel,
} from "../utils/constants";

describe("UI terminology", () => {
  it("shows Caja for cotizacion aliases without changing internal status values", () => {
    expect(getOrderStatusLabel("cotizacion")).toBe("Caja");
    expect(getOrderStatusLabel(ORDER_STATUS.IN_QUOTE)).toBe("Caja");
    expect(ORDER_STATUS.IN_QUOTE).toBe("in_Quote");
  });

  it("shows Caja in status badge config", () => {
    expect(getOrderStatusConfig(ORDER_STATUS.IN_QUOTE).label).toBe("Caja");
  });

  it("maps visible delivery text to Entrega", () => {
    expect(formatUiTerms("delivery")).toBe("Entrega");
    expect(formatUiTerms("Delivery")).toBe("Entrega");
  });

  it("maps old visible quote wording to Caja", () => {
    expect(formatUiTerms("Orden en cotización")).toBe("Orden en Caja");
    expect(formatUiTerms("Cotizador asignado")).toBe("Responsable de caja asignado");
  });
});
