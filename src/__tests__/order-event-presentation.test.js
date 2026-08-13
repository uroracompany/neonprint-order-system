import { describe, expect, it } from "vitest";
import {
  getActivityChangeValue,
  getSafeOrderStatusLabel,
} from "../utils/orderEventPresentation";

describe("order event presentation", () => {
  it("muestra estados de orden en lenguaje legible", () => {
    expect(getSafeOrderStatusLabel("in_Design")).toBe("Diseño");
    expect(getActivityChangeValue("status", "in_Production")).not.toContain("in_Production");
  });

  it("no expone identificadores internos en los campos de asignacion", () => {
    expect(getActivityChangeValue("responsible", "0dce1de2-819a-4a8c-a82d-2d648eb0a9f4")).toBe("Responsable asignado");
  });
});
