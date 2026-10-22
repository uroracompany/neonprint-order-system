import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sellerPage = readFileSync(resolve("src/pages/pages-seller.jsx"), "utf8");
const sellerStyles = readFileSync(resolve("src/css-components/page-seller.css"), "utf8");

describe("Sales order loading skeletons", () => {
  it("uses five skeleton rows for recent orders and fifteen for the main table", () => {
    expect(sellerPage).toContain("<OrderTableSkeletonRows columns={4} rows={5} />");
    expect(sellerPage).toContain("<OrderTableSkeletonRows columns={7} rows={SELLER_ORDER_PAGE_SIZE} />");
    expect(sellerPage).toContain("const SELLER_ORDER_PAGE_SIZE = 15;");
  });

  it("renders ten accessible skeleton cards in card mode", () => {
    expect(sellerPage).toContain("Array.from({ length: SELLER_CARD_PAGE_SIZE }, (_, index) => <OrderCardSkeleton");
    expect(sellerPage).toContain("const SELLER_CARD_PAGE_SIZE = 10;");
    expect(sellerPage).toContain("role=\"status\" aria-live=\"polite\">Cargando órdenes...");
    expect(sellerPage.match(/aria-busy=\{loading\}/g)).toHaveLength(3);
  });

  it("keeps existing error and empty branches after the loading branches", () => {
    expect(sellerPage).toContain(") : ordersError ? (");
    expect(sellerPage).toContain(") : recentOrders.length === 0 ? (");
    expect(sellerPage).toContain(") : orders.length === 0 ? (");
    expect(sellerPage).not.toContain("Cargando Ordenes...");
  });

  it("styles skeleton shimmer locally and respects reduced-motion preferences", () => {
    expect(sellerStyles).toContain(".ps-orders-skeleton-row td");
    expect(sellerStyles).toContain("@keyframes ps-orders-skeleton-shimmer");
    expect(sellerStyles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
