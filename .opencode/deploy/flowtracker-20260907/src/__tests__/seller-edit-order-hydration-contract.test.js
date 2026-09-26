import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sellerPage = readFileSync(
  resolve("src/pages/pages-seller.jsx"),
  "utf8",
);

describe("seller edit order hydration contract", () => {
  it("loads the authorized detail before opening an editable order", () => {
    expect(sellerPage).toContain("const handleEditOrder = useCallback(async (order) => {");
    expect(sellerPage).toContain('runSellerOrderAction("detail", { order_id: order.id })');
    expect(sellerPage).toContain("setEditingOrder(result.order);");
    expect(sellerPage).not.toContain("setEditingOrder(o)");
  });

  it("routes every seller edit control through the detail-loading handler", () => {
    const editHandlerCalls = sellerPage.match(/handleEditOrder\(o\)/g) || [];

    expect(editHandlerCalls).toHaveLength(3);
  });
});
