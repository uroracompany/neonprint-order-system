import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../components/ui/Badge";
import { getOrderStatusConfig, ORDER_STATUS } from "../utils/constants";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const designerPage = readFileSync(resolve(testDirectory, "../pages/page-designer.jsx"), "utf8");
const designerStyles = readFileSync(resolve(testDirectory, "../css-components/page-designer.css"), "utf8");
const salesStyles = readFileSync(resolve(testDirectory, "../css-components/page-seller.css"), "utf8");

describe("Designer order status dots", () => {
  it("enables dots in all four active order-status presentations and excludes JSX comments", () => {
    const activeDesignerPage = designerPage.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const statusBadgeCalls = [...activeDesignerPage.matchAll(/<StatusBadge\b[^>]*\/>/gs)].map(([call]) => call);

    expect(statusBadgeCalls).toHaveLength(4);
    expect(statusBadgeCalls.every((call) => call.includes("status={order.status}") && !call.includes("showDot={false}"))).toBe(true);
    expect(statusBadgeCalls.filter((call) => call.includes('className="acm-badge"'))).toHaveLength(3);
    expect(statusBadgeCalls.filter((call) => call.includes('className="designer-order-modal__summary-badge"'))).toHaveLength(1);
    expect(activeDesignerPage).not.toContain('className="pd-badge"');
    expect(designerPage).toMatch(/\{\/\*[\s\S]*?<StatusBadge\b[^>]*className="pd-badge"[^>]*\/>[\s\S]*?\*\/\}/);
    expect(activeDesignerPage).toMatch(/<div className="pd-status-stack">[\s\S]*?<StatusBadge\b[^>]*className="acm-badge"/);
    expect(activeDesignerPage).toMatch(/<td className="td-pad"><StatusBadge\b[^>]*className="acm-badge"/);
    expect(activeDesignerPage).toMatch(/<div className="ps-order-card-field">\s*<span className="ps-order-card-field-label">Estado<\/span>\s*<StatusBadge\b[^>]*className="acm-badge"/);

    // Informational/type badges are plain spans, so StatusBadge is the only source of a dot child.
    expect(activeDesignerPage).toContain('<span className="acm-badge info">{count}');
    expect(activeDesignerPage).toContain('<span className="acm-badge neutral">Sin archivos</span>');
  });

  it.each([
    [ORDER_STATUS.PENDING],
    [ORDER_STATUS.IN_DESIGN],
    [ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.IN_DELIVERED],
  ])("uses the canonical colored 5px dot for %s", (status) => {
    const { container } = render(<StatusBadge status={status} className="acm-badge" bordered />);
    const badge = container.querySelector(".acm-badge");
    const dot = badge.querySelector(".acm-badge-dot");

    expect(dot).toHaveClass("acm-badge-dot");
    expect(dot).toHaveStyle({ background: getOrderStatusConfig(status).dot });
    expect(badge).toHaveTextContent(getOrderStatusConfig(status).label);
  });

  it("defines a scoped circular, non-shrinking dot and Sales-like spacing only for Designer status badges", () => {
    expect(designerStyles).toMatch(/\.pd-main-wrap \.acm-badge:has\(\.acm-badge-dot\)\s*\{[^}]*gap:\s*5px;/s);
    expect(designerStyles).toMatch(/\.pd-main-wrap \.acm-badge-dot\s*\{[^}]*width:\s*5px;[^}]*height:\s*5px;[^}]*border-radius:\s*50%;[^}]*flex:\s*0 0 auto;/s);
    expect(designerStyles).toMatch(/\.pd-badge-dot\s*\{[^}]*width:\s*5px;[^}]*height:\s*5px;[^}]*border-radius:\s*50%;/s);
    expect(designerStyles).toMatch(/\.designer-order-modal__summary-badge-dot\s*\{[^}]*width:\s*5px;[^}]*height:\s*5px;[^}]*border-radius:\s*50%;[^}]*flex:\s*0 0 auto;/s);
    expect(salesStyles).toMatch(/\.ps-badge-dot\s*\{[^}]*width:\s*5px;[^}]*height:\s*5px;[^}]*border-radius:\s*50%;\s*flex-shrink:\s*0;/s);
  });
});
