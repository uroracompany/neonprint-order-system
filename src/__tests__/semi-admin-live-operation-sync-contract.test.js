import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOrdersSnapshot } from "../utils/orderRealtime";

const page = readFileSync("src/pages/pages-seller.jsx", "utf8");

describe("Semi-Admin design asset live reconciliation", () => {
  it("applies the confirmed save and authoritative detail to both open order consumers", () => {
    const handler = page.slice(page.indexOf("const handleOrderUpdated"), page.indexOf("const handleSemiAdminAssetSaved"));
    expect(handler).toContain("setSelectedOrder(applyConfirmedOrder)");
    expect(handler).toContain("setEditingOrder(applyConfirmedOrder)");
    expect(handler).toContain("runSellerOrderAction(\"detail\", { order_id: orderId })");
    expect(handler).toContain("setSelectedOrder((current) => current?.id === orderId ? refreshedOrder : current)");
    expect(handler).toContain("setEditingOrder((current) => current?.id === orderId ? refreshedOrder : current)");
    expect(handler).toContain("await fetchOrders({ nextPage: page, includeDashboard: true, silent: true })");
  });

  it("does not replace an open detailed order with a partial list row", () => {
    const fetcher = page.slice(page.indexOf("const fetchOrders"), page.indexOf("const openOrderDetail"));
    expect(fetcher).toContain("applyOrdersSnapshot({");
    expect(fetcher).not.toMatch(/setSelectedOrder\s*\(\s*\(current\)\s*=>\s*\{[\s\S]*?nextOrders\.find/);

    const detailOrder = {
      id: "order-with-files",
      updated_at: "2026-09-29T10:00:00.000Z",
      order_production_files: [{ id: "file-1", materials: ["Vinyl"] }, { id: "file-2", materials: ["Canvas"] }],
      order_file_url: ["design-a.pdf", "design-b.pdf"],
      preview_image: "work-order.png",
    };
    const partialListRow = { id: detailOrder.id, updated_at: "2026-09-29T10:01:00.000Z", status: "in_Design" };
    let selectedOrder = detailOrder;
    let listedOrders = [];

    applyOrdersSnapshot({
      orders: [partialListRow],
      setOrders: (value) => { listedOrders = value; },
      setSelectedOrder: (update) => {
        selectedOrder = typeof update === "function" ? update(selectedOrder) : update;
      },
      preserveMissingOpenOrders: true,
    });

    expect(listedOrders).toEqual([partialListRow]);
    expect(selectedOrder).toBe(detailOrder);
    expect(selectedOrder.order_production_files).toHaveLength(2);
    expect(selectedOrder.order_file_url).toEqual(["design-a.pdf", "design-b.pdf"]);
    expect(selectedOrder.preview_image).toBe("work-order.png");
  });

  it("uses the existing direct Caja assignment modal and its protected operation", () => {
    expect(page).toContain('if (action.key === "send_design_to_quote")');
    expect(page).toContain("setSemiAdminQuoteAssignment(order)");
    expect(page).toContain('handleSemiAdminOperation("send_design_to_quote", { quote_id: quoteId }, semiAdminQuoteAssignment)');
  });
});
