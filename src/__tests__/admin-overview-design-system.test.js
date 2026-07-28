import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

const getCssBlock = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return match?.[1] || "";
};

describe("Admin overview design-system contract", () => {
  it("keeps the overview carousel anchored to the admin palette and new layout contract", () => {
    const overview = readProjectFile("src/components/ui/AdminOverviewCarousel.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminMainChildBlock = getCssBlock(adminCss, ".pa-main > *");
    const adminOverviewSectionBlock = getCssBlock(adminCss, ".pa-main > .pa-overview-section");
    const adminTableWrapBlock = getCssBlock(adminCss, ".pa-root .ps-table-wrap");

    expect(overview).toContain('kicker: "Resumen operativo"');
    expect(overview).toContain('kicker: "Seguimiento comercial"');
    expect(overview).toContain("const QUICK_ACTIONS = [");
    expect(overview).toContain('tab: "credits"');
    expect(overview).toContain('className="pa-carousel-summary-copy"');
    expect(overview).toContain('className="pa-carousel-quick-actions"');
    expect(overview).toContain('className="pa-carousel-quick-action-btn"');
    expect(overview).toContain('className="pa-carousel-status-strip"');
    expect(overview).toContain('className="pa-carousel-commercial-strip"');
    expect(overview).toContain('className="pa-carousel-actions-strip"');
    expect(overview).toContain('className="pa-carousel-reminder-strip"');

    expect(adminCss).toContain("--pa-carousel-content-height");
    expect(adminCss).toContain("grid-template-rows: var(--pa-carousel-copy-height) var(--pa-carousel-content-height) var(--pa-carousel-dots-height);");
    expect(adminCss).toContain(".pa-overview-carousel-compact .pa-carousel-summary-copy");
    expect(adminCss).toContain(".pa-carousel-quick-action-btn");
    expect(adminCss).toContain("background: #091127;");
    expect(adminCss).toContain("color: #ffffff;");
    expect(adminCss).toContain("font-weight: 600;");
    expect(adminCss).toContain(".pa-carousel-quick-action-btn > span:last-child");
    expect(adminCss).toContain("height: 100%;");
    expect(adminCss).toContain(".pa-carousel-commercial-strip {\n  grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(adminCss).toContain(".pa-carousel-actions-strip {\n  grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(adminCss).toContain("@media (max-width: 980px)");
    expect(adminCss).toContain("@media (max-width: 360px)");

    expect(dashboard).toContain("<span>Clientes</span>");
    expect(dashboard).not.toContain("<span>Clientes registrados</span>");
    expect(dashboard).toContain("const overviewActiveOrders = orders.filter");
    expect(dashboard).toContain("const overviewActiveOrderMetrics = [");
    expect(dashboard).toContain('label: "911 activas"');
    expect(dashboard).toContain('label: "Normales activas"');
    expect(dashboard).toContain('label: "Diseño interno"');
    expect(dashboard).toContain('label: "Diseño externo"');
    expect(dashboard).toContain("<h2>Carga activa</h2>");
    expect(dashboard).toContain('className="pa-overview-active-orders-grid"');
    expect(dashboard).toContain('className="pa-overview-active-order-card"');
    expect(dashboard).toContain('className="pa-section pa-overview-section"');
    expect(dashboard).toContain('className="pa-overview-secondary-grid"');
    expect(dashboard).toContain('className="pa-overview-main-column"');
    expect(dashboard).toContain("const paginatedCreditClientGroups = creditClientGroups.slice");
    expect(dashboard).toContain("const CREDIT_DETAIL_PAGE_SIZE = 7;");
    expect(dashboard).toContain("const paginatedInvoices = filteredInvoices.slice");
    expect(dashboard).toContain("<Pagination currentPage={safeDetailPage} totalPages={detailTotalPages} onPageChange={setDetailPage} />");
    expect(dashboard.indexOf('className="pa-panel pa-overview-flow-panel"')).toBeLessThan(dashboard.indexOf('className="pa-overview-secondary-grid"'));
    expect(adminCss).toContain(".pa-main > .pa-overview-section");
    expect(adminMainChildBlock).toContain("width: 100%;");
    expect(adminMainChildBlock).toContain("max-width: none;");
    expect(adminMainChildBlock).toContain("min-width: 0;");
    expect(adminMainChildBlock).not.toContain("max-width: 1440px;");
    expect(adminOverviewSectionBlock).toContain("width: 100%;");
    expect(adminOverviewSectionBlock).toContain("max-width: none;");
    expect(adminOverviewSectionBlock).not.toContain("max-width: 1800px;");
    expect(adminTableWrapBlock).toContain("width: 100%;");
    expect(adminTableWrapBlock).toContain("max-width: 100%;");
    expect(adminTableWrapBlock).toContain("overflow-x: auto;");
    expect(adminCss).toContain(".pa-overview-secondary-grid");
    expect(adminCss).toContain("grid-template-columns: minmax(760px, 1fr) minmax(360px, 520px);");
    expect(adminCss).toContain("grid-template-columns: 112px minmax(160px, 1.2fr) minmax(128px, 0.85fr) minmax(150px, 1fr) minmax(128px, 0.75fr);");
    expect(adminCss).toContain("align-items: stretch;");
    expect(adminCss).toContain(".pa-overview-active-orders-panel");
    expect(adminCss).toContain(".pa-overview-active-orders-grid");
    expect(adminCss).toContain(".pa-overview-active-order-card");
    expect(adminCss).toContain("grid-auto-rows: minmax(96px, 1fr);");
    expect(adminCss).toContain(".pa-overview-flow-panel {\n  grid-column: 1 / -1;\n}");
    expect(adminCss).toContain(".pa-overview-flow-panel .pa-overview-card-head");
    expect(adminCss).toContain("padding: 6px 24px 20px;");
    expect(adminCss).not.toContain(".pa-overview-flow-step::after");
    expect(adminCss).toMatch(/\.pa-overview-flow-step\s*\{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*justify-content: space-between;/);
    expect(adminCss).toMatch(/\.pa-overview-flow-step-label\s*\{[\s\S]*font-weight: 600;[\s\S]*text-align: left;/);
    expect(adminCss).toMatch(/\.pa-overview-flow-step-value\s*\{[\s\S]*flex-direction: row-reverse;[\s\S]*justify-content: space-between;/);
    expect(adminCss).toContain("font-size: 30px;");
    expect(adminCss).toContain("margin: 4px 24px 24px;");
    expect(adminCss).toContain(".pa-credit-filter-panel .acm-filter-row .acm-search input:hover");
    expect(adminCss).toMatch(/\.pa-credit-filter-panel \.acm-filter-row \.acm-search input\s*\{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
    expect(adminCss).toMatch(/\.pa-credit-detail-toolbar select\s*\{[\s\S]*flex: none;[\s\S]*height: 42px;/);
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
