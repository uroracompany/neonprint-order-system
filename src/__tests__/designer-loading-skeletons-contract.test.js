import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(resolve(path), "utf8");
const page = read("src/pages/page-designer.jsx");
const designerCss = read("src/css-components/page-designer.css");
const sellerCss = read("src/css-components/page-seller.css");
const notifications = read("src/components/designer/DesignerNotificationsModule.jsx");
const notificationsCss = read("src/components/designer/DesignerNotificationsModule.css");

describe("Designer loading skeleton contracts", () => {
  it("renders four dashboard counters, four metrics and five recent rows while orders load", () => {
    const dashboard = page.slice(page.indexOf('{activeTab === "dashboard" && ('), page.indexOf('{activeTab === "orders" && ('));
    const metricDefinitions = page.slice(page.indexOf("const metrics = ["), page.indexOf("const effectivePerPage"));

    expect((dashboard.match(/className="pd-greeting-count/g) || [])).toHaveLength(4);
    expect((dashboard.match(/className="pd-skeleton-counter/g) || []).length).toBeGreaterThanOrEqual(4);
    expect((metricDefinitions.match(/label:/g) || [])).toHaveLength(4);
    expect(dashboard).toContain('aria-busy={initialOrdersPending}');
    expect(dashboard).toContain("<DesignerOrderTableSkeleton rows={5} columns={5}");
  });

  it("renders fifteen six-column table rows and ten cards, with initial error/retry and quiet refresh", () => {
    expect(page).toContain("<DesignerOrderTableSkeleton rows={PER_PAGE} columns={6}");
    expect(page).toContain("const DESIGNER_CARD_PAGE_SIZE = 10;");
    expect(page).toContain("Array.from({ length: DESIGNER_CARD_PAGE_SIZE }");
    expect(page).toContain("initialOrdersFailed ? (");
    expect(page).toContain("<OrdersLoadError onRetry={fetchOrders} />");
    expect(page).toContain("if (isInitialLoad) {");
    expect(page).toMatch(/finally\s*\{\s*if \(isInitialLoad\) setLoading\(false\);/);
    expect(page).toContain("console.warn(\"No se pudieron actualizar las órdenes de Diseño:");
  });

  it("opens order details from cached row data, guards stale responses and scopes history loading locally", () => {
    const handler = page.slice(page.indexOf("const handleViewOrder"), page.indexOf("const handleOpenProductionAssignment"));
    expect(handler.indexOf("setSelectedOrder(order)")).toBeLessThan(handler.indexOf("void supabase"));
    expect(handler).toContain("requestId !== detailRequestRef.current");
    expect(handler).toContain("current?.id === order.id ? data : current");
    expect(page).toContain("detailRequestRef.current += 1; setSelectedOrder(null);");
    expect(page).toContain("participation.loading ? <DesignerHistorySkeleton />");
    expect(page).toContain('sectionClassName="designer-order-modal__history"');
    expect(designerCss).toContain(".designer-order-modal__history.pd-history-skeleton");
  });

  it("keeps first-load notifications per tab and exposes loading semantics", () => {
    expect(notifications).toContain("const hasResolvedTab = resolvedTabs[tab]");
    expect(notifications).toContain("const showSkeleton = isLoading && !hasResolvedTab");
    expect(notifications).toContain("Array.from({ length: 15 }");
    expect(notifications).toContain('aria-busy={showSkeleton}');
    expect(notifications).toContain('role="status" aria-live="polite"');
    expect(notifications).toContain('className="dnm-skeleton-list" aria-hidden="true"');
  });

  it("keeps skeleton shimmer motion reduced and profile layout classes aligned to existing breakpoints", () => {
    expect(designerCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(designerCss).toMatch(/\.pd-skeleton-shape,\s*\.pd-profile-skeleton-avatar \{ animation: none/);
    expect(designerCss).not.toContain(".pd-profile-skeleton-analytics { grid-template-columns: 1fr;");
    expect(designerCss).toContain(".pd-profile-skeleton-metrics .ps-profile-metric-card");
    expect(designerCss).toContain(".pd-profile-skeleton-analytics .ps-profile-card-heading");
    expect(sellerCss).toMatch(/\.ps-profile-analytics-grid\s*\{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(sellerCss).toMatch(/@media \(max-width: 1040px\)[\s\S]*?\.ps-profile-analytics-grid\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(sellerCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.ps-profile-analytics-grid\s*\{\s*grid-template-columns: 1fr/);
    expect(notificationsCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
