/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("Delivery and Sales responsive UI contracts", () => {
  const deliveryCss = readProjectFile("src/css-components/page-delivery.css");
  const sellerCss = readProjectFile("src/css-components/page-seller.css");
  const sellerPage = readProjectFile("src/pages/pages-seller.jsx");

  it("keeps Delivery content, navigation, and long file names contained on narrow screens", () => {
    expect(deliveryCss).toContain(".pd-rework-file-toggle > span");
    expect(deliveryCss).toContain("flex: 1 1 auto;");
    expect(deliveryCss).toContain("max-height: min(92dvh, 860px)");
    expect(deliveryCss).toContain("padding-bottom: max(8px, env(safe-area-inset-bottom))");
    expect(deliveryCss).toContain(".pd-header-left > .pd-icon-btn");
    expect(deliveryCss).toContain("display: none;");
    expect(deliveryCss).toContain("@media (max-width: 360px)");
  });

  it("keeps Sales actions labelled while their mobile representation is compact", () => {
    expect(sellerPage).toContain('aria-label="Actualizar órdenes"');
    expect(sellerPage).toContain('aria-label="Nuevo cliente"');
    expect(sellerPage).toContain('aria-label="Nueva orden"');
    expect(sellerCss).toContain(".ps-topbar-client-inner,");
    expect(sellerCss).toContain("font-size: 0;");
  });

  it("contains the dense Sales table and workbench instead of overflowing the viewport", () => {
    expect(sellerCss).toContain(".ps-table-wrap {");
    expect(sellerCss).toContain("overscroll-behavior-inline: contain;");
    expect(sellerCss).toContain(".ps-table {\n  min-width: 760px;");
    expect(sellerCss).toContain(".ps-main .pp-workbench-tabs {");
    expect(sellerCss).toContain("max-width: calc(100vw - 108px);");
  });

  it("preserves existing operational handlers and shared status badges", () => {
    const deliveryPage = readProjectFile("src/pages/page-delivery.jsx");
    expect(deliveryPage).toContain('rpc("delivery_mark_order_delivered"');
    expect(deliveryPage).toContain('rpc("delivery_return_completed_files_to_production"');
    expect(sellerPage).toContain("<StatusBadge status={o.status} order={o} />");
    expect(sellerPage).toContain("<StatusBadge status={o.payment_status} type=\"payment\" />");
  });
});
