import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("Admin overview design-system contract", () => {
  it("keeps the overview carousel anchored to the admin palette and new layout contract", () => {
    const overview = readProjectFile("src/components/ui/AdminOverviewCarousel.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");

    expect(overview).toContain('kicker: "Resumen del negocio"');
    expect(overview).toContain('accent: "#091127"');
    expect(overview).toContain('accentBg: "#E8EDF8"');
    expect(overview).toContain('cta: { label: "Ver detalles", tab: "orders" }');
    expect(overview).toContain('className="pa-carousel-stats-grid"');
    expect(overview).toContain('className="pa-carousel-actions-grid"');

    expect(adminCss).toContain(".pa-carousel-stats-grid");
    expect(adminCss).toContain(".pa-carousel-actions-grid");
    expect(adminCss).toContain(".pa-carousel-cta:focus-visible");
    expect(adminCss).toContain("@media (max-width: 640px)");
    expect(adminCss).toContain("@media (max-width: 500px)");
  });

  it("keeps order row actions aligned with the shared admin action button base", () => {
    const orderActions = readProjectFile("src/components/orders/AdminOrderActions.jsx");
    const sellerCss = readProjectFile("src/css-components/page-seller.css");
    const adminCss = readProjectFile("src/css-components/page-admin.css");

    expect(orderActions).toContain('type="button"');
    expect(orderActions).toContain('data-action={action.key}');
    expect(sellerCss).toContain(".table-action-btn:focus-visible");
    expect(sellerCss).toContain(".table-action-btn:active");
    expect(sellerCss).toContain("transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;");
    expect(adminCss).toContain(".pa-orders-panel .acm-row-actions .table-action-btn.view");
    expect(adminCss).toContain(".pa-orders-panel .acm-row-actions .table-action-btn.advanced");
    expect(adminCss).toContain(".pa-orders-panel .acm-row-actions .table-action-btn:focus-visible");
  });
});
