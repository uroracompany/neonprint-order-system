import { describe, expect, it } from "vitest";
import { shouldMarkDesignerOrderEdited } from "../utils/designerOrderEdits";

const previousOrder = {
  id: "order-1",
  status: "in_Design",
  description: "Banner inicial",
  client_name: "Cliente",
  client_contact: "809-555-0000",
  order_type: "Diseño interno",
  created_at: "2026-08-31T10:00:00.000Z",
  material: "Lona",
};

describe("designer self-edit indicator", () => {
  it("does not label an order edited when the current designer saved the change", () => {
    const updatedOrder = {
      ...previousOrder,
      description: "Banner con archivos guardados",
      updated_by: "designer-1",
    };

    expect(shouldMarkDesignerOrderEdited(previousOrder, updatedOrder, "designer-1")).toBe(false);
  });

  it("keeps the edited label when another actor changes a tracked order field", () => {
    const updatedOrder = {
      ...previousOrder,
      description: "Banner actualizado por ventas",
      updated_by: "seller-1",
    };

    expect(shouldMarkDesignerOrderEdited(previousOrder, updatedOrder, "designer-1")).toBe(true);
  });

  it("does not mark a return as a generic edit", () => {
    const returnedOrder = {
      ...previousOrder,
      return_reason: "Corregir medidas",
      returned_to_designer_at: "2026-08-31T11:00:00.000Z",
      updated_by: "quote-1",
    };

    expect(shouldMarkDesignerOrderEdited(previousOrder, returnedOrder, "designer-1")).toBe(false);
  });
});
