import { describe, expect, it } from "vitest";
import { areOrderTimestampsEquivalent } from "../utils/orderTimestamp";
import { readProjectFile } from "../test-utils/read-project-file.js";

const page = readProjectFile("src/pages/pages-seller.jsx");
const styles = readProjectFile("src/css-components/page-seller.css");

describe("Semi-Admin actions in order assignment records", () => {
  it("renders catalog-approved assignment and production controls in recent, table, and card records", () => {
    expect(page).toContain("renderSemiAdminRowActions(o)");
    expect(page).toContain('renderSemiAdminRowActions(o, "card")');
    expect(page).toContain("const getSemiAdminRowActions = (order)");
    expect(page).toContain("!areOrderTimestampsEquivalent(catalog.order_updated_at, order.updated_at)");
    expect(page).toContain('if (action.key === "send_to_designer")');
    expect(page).toContain('if (action.key === "send_to_quote")');
    expect(page).toContain('if (action.key === "send_design_to_quote")');
    expect(page).toContain('if (action.key === "route_production")');
    expect(page).toContain("setSendingToDesigner(order)");
    expect(page).toContain("setSendingToQuotation(order)");
    const sendDesignToQuoteRowAction = page.match(/if \(action\.key === "send_design_to_quote"\) \{([\s\S]*?)\n {4}\}/);
    expect(sendDesignToQuoteRowAction?.[1]).toContain("setSemiAdminQuoteAssignment(order)");
    expect(sendDesignToQuoteRowAction?.[1]).not.toContain("handleViewOrder(order)");
    expect(page).toContain("onOpenQuoteAssignment={() => setSemiAdminQuoteAssignment(selectedOrder)}");
    expect(page).toContain('send_design_to_quote: Icons.Send');
    expect(page).toContain('action.key === "send_design_to_quote"');
    expect(page).toContain('action.key === "return_quote_to_previous_stage"');
    expect(page).toContain('semi-admin-direct-action--${paletteKey}');
    expect(page).toContain('handleSemiAdminOperation("send_design_to_quote", { quote_id: quoteId }, semiAdminQuoteAssignment)');
    expect(page).toContain('open={!!semiAdminQuoteAssignment}');
    expect(page).toContain('order={semiAdminQuoteAssignment}');
    expect(page).toContain('title="Enviar a Caja"');
    expect(page).toContain('onConfirm={handleConfirmSemiAdminQuoteAssignment}');
    expect(page).toContain('return_design_to_sales: Icons.ArrowLeft');
    expect(page).toContain('return_quote_to_previous_stage: Icons.ArrowLeft');
    expect(page).toContain('setSemiAdminQuoteReturn({ order, actionKey: action.key, targetOverride: "sales" })');
    expect(page.replace(/\s+/g, " ")).toContain('actionKey: action.key, targetOverride: action.target_stage === "sales" ? "sales" : "designer"');
    expect(page).toContain('const actionKey = returnContext?.actionKey || "return_quote_to_design";');
    expect(page).toContain('handleSemiAdminOperation(actionKey, { reason }, returnOrder)');
    expect(page).toContain('targetOverride={semiAdminQuoteReturn?.targetOverride || "designer"}');
    expect(page).toContain('minReasonLength={10}');
  });

  it("keeps the direct Design and Cash actions in the Sales palettes despite later generic module styles", () => {
    expect(page).toContain("send_to_designer: Icons.Brush");
    expect(page).toContain("send_to_quote: Icons.Send");
    expect(page).toContain("semi-admin-direct-action--${action.key}");

    const designRule = styles.match(/(\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--send_to_designer,\s*\.semi-admin-direct-actions \.card-action-btn\.semi-admin-direct-action--send_to_designer)\s*\{([^}]*)\}/);
    const cashRule = styles.match(/(\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--send_to_quote,\s*\.semi-admin-direct-actions \.card-action-btn\.semi-admin-direct-action--send_to_quote)\s*\{([^}]*)\}/);

    expect(designRule).not.toBeNull();
    expect(cashRule).not.toBeNull();
    expect(designRule[2]).toMatch(/color:\s*#7c3aed;/);
    expect(designRule[2]).toMatch(/border-color:\s*#ddd6fe;/);
    expect(designRule[2]).toMatch(/background:\s*#f5f3ff;/);
    expect(cashRule[2]).toMatch(/color:\s*#0284c7;/);
    expect(cashRule[2]).toMatch(/border-color:\s*#bae6fd;/);
    expect(cashRule[2]).toMatch(/background:\s*#e0f2fe;/);

    const productionRule = styles.match(/(\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--route_production,\s*\.semi-admin-direct-actions \.card-action-btn\.semi-admin-direct-action--route_production)\s*\{([^}]*)\}/);
    expect(productionRule).not.toBeNull();
    expect(productionRule[2]).toMatch(/color:\s*#1d4ed8;/);
    expect(productionRule[2]).toMatch(/border-color:\s*#bfdbfe;/);
    expect(productionRule[2]).toMatch(/background:\s*#eff6ff;/);

    // Three class selectors beat the later generic `.pq-root .card-action-btn` rule.
    for (const selector of [designRule[1].split(","), cashRule[1].split(",")].flat()) {
      expect((selector.match(/\./g) ?? []).length).toBeGreaterThanOrEqual(3);
      expect(selector).toContain(".semi-admin-direct-actions");
    }

    expect(styles).toMatch(/\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--send_to_designer:hover,[\s\S]*?background:\s*#7c3aed;/);
    expect(styles).toMatch(/\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--send_to_quote:hover,[\s\S]*?background:\s*#0284c7;/);
    expect(styles).toMatch(/\.semi-admin-direct-actions \.table-action-btn\.semi-admin-direct-action--route_production:hover,[\s\S]*?background:\s*#1d4ed8;/);
    expect(styles).toMatch(/\.semi-admin-direct-action:focus-visible\s*\{[^}]*outline:/);
    expect(styles).toMatch(/\.semi-admin-direct-action:disabled\s*\{[^}]*opacity:/);
  });

  it("keeps catalog actions visible when timestamp formats represent the same exact instant", () => {
    expect(areOrderTimestampsEquivalent("2026-09-28T10:15:30.123Z", "2026-09-28T10:15:30.123000+00:00")).toBe(true);
    expect(areOrderTimestampsEquivalent("2026-09-28 10:15:30.123456+00", "2026-09-28T10:15:30.1234560Z")).toBe(true);
    expect(areOrderTimestampsEquivalent("2026-09-28T12:15:30.5+02:00", "2026-09-28 10:15:30.500Z")).toBe(true);
  });

  it("fails closed for missing, invalid, or genuinely stale catalog timestamps", () => {
    expect(areOrderTimestampsEquivalent(undefined, "2026-09-28T10:15:30Z")).toBe(false);
    expect(areOrderTimestampsEquivalent("not-a-timestamp", "2026-09-28T10:15:30Z")).toBe(false);
    expect(areOrderTimestampsEquivalent("2026-09-28T10:15:30.123456Z", "2026-09-28T10:15:30.123457Z")).toBe(false);
    expect(page).toContain("const catalog = semiAdminOperationalCatalogs[order.id];");
    expect(page).toContain("if (!catalog || !areOrderTimestampsEquivalent(catalog.order_updated_at, order.updated_at)) return [];");
  });

  it("keeps the new direct-assignment controls separate from the existing row action wrappers", () => {
    expect(page).toContain('className="table-actions" data-row-action');
    expect(page).toContain('className="ps-order-card-actions">');
    expect(page).not.toContain("table-actions--semi-admin");
    expect(page).not.toContain("ps-order-card-actions--semi-admin");
    expect(page).toContain("className={`semi-admin-direct-actions semi-admin-direct-actions--${variant}`}");
    expect(page).toContain("event.stopPropagation()");
  });

  it("keeps payment Caja-only and opens the shared production assignment from detail and row actions", () => {
    expect(page).toContain("onOpenProductionAssignment={handleOpenSemiAdminProductionAssignment}");
    expect(page).not.toContain("onOpenPayment={() => setSemiAdminPaymentOrder(selectedOrder)}");
    expect(page).toContain('handleSemiAdminOperation("route_production", { area_assignments: assignments }, targetOrder)');
    expect(page).toContain("setSemiAdminProductionOrder(detail.order)");
    expect(page).toContain('semiAdminOperationLoading');
    expect(page).toContain("semiAdminQuoteResponsibilityReassignment");
    expect(page).toContain("semiAdminDesignReassignment");
  });

  it("uses flex-wrap only for the new assignment group, including mobile", () => {
    expect(styles).toMatch(/\.semi-admin-direct-actions\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).toMatch(/\.semi-admin-direct-actions--card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*560px\)\s*\{[^}]*\.semi-admin-direct-actions\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).not.toContain(".table-actions--semi-admin");
    expect(styles).not.toContain(".ps-order-card-actions--semi-admin");
  });
});
