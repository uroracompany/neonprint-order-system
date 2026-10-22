import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const quotePage = read("src/pages/page-quote.jsx");
const quoteCss = read("src/css-components/page-quote.css");

describe("Caja order loading skeleton contract", () => {
  it("limits placeholders to the first order response for the authenticated user", () => {
    expect(quotePage).toContain("const ordersInitializedRef = useRef(false)");
    expect(quotePage).toContain("ordersInitializedRef.current = false");
    expect(quotePage).toContain("ordersInitializedRef.current = true");
    expect(quotePage).toContain("const initialOrdersPending = loading && !ordersInitializedRef.current");
    expect(quotePage).toContain("const initialOrdersFailed = Boolean(ordersLoadError && !ordersInitializedRef.current)");
    expect(quotePage).toContain("aria-busy={initialOrdersPending}");
    expect(quotePage).not.toContain('{loading ? (\n                <div className="ps-cards-empty">Cargando órdenes...</div>');
  });

  it("preserves the agreed structural skeleton sizes and accessible announcements", () => {
    expect(quotePage).toContain("function QuoteOrderTableSkeleton({ rows, columns })");
    expect(quotePage).toContain('<QuoteOrderTableSkeleton rows={5} columns={5} />');
    expect(quotePage).toContain("<QuoteOrderTableSkeleton rows={PER_PAGE} columns={6} />");
    expect(quotePage).toContain("Array.from({ length: 10 }");
    expect(quotePage).toContain('role="status" aria-live="polite">Cargando órdenes...');
    expect(quotePage).toContain('aria-hidden="true"');
    expect(quotePage).toContain("!initialOrdersPending && !initialOrdersFailed && <Pagination");
  });

  it("keeps initial error and empty branches distinct and does not touch credits", () => {
    expect(quotePage).toContain("initialOrdersFailed ? (");
    expect(quotePage).toContain("No se pudieron cargar las órdenes de Caja.");
    expect(quotePage).toContain("No hay órdenes asignadas actualmente.");
    expect(quotePage).toContain("No hay órdenes que coincidan con los filtros.");
    expect(quotePage).toContain('badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount)');
    expect(quotePage).toContain('value: accountsReceivableLoading ? "..." : creditPendingInvoicesCount');
  });

  it("shows summary badge counts directly while loading and dashes only after an initial failure", () => {
    const badgeStart = quotePage.indexOf('<div className="pq-greeting-badges"');
    const metricsStart = quotePage.indexOf('<div className="pq-metrics-grid"', badgeStart);
    const badgeMarkup = quotePage.slice(badgeStart, metricsStart);

    expect(badgeMarkup).toContain('<strong>{initialOrdersFailed ? "—" : activeOrdersCount}</strong>');
    expect(badgeMarkup).toContain('<strong>{initialOrdersFailed ? "—" : pendingPaymentCount}</strong>');
    expect(badgeMarkup).toContain('<strong>{initialOrdersFailed ? "—" : partialPaymentCount}</strong>');
    expect(badgeMarkup).toContain('<strong>{accountsReceivableLoading ? "..." : creditPendingInvoicesCount}</strong>');
    expect(badgeMarkup).toContain('<strong>{initialOrdersFailed ? "—" : paidTodayCount}</strong>');
    expect(badgeMarkup).not.toContain("QuoteSkeletonLine");
    expect(quotePage).toContain('<QuoteSkeletonLine className="pq-skeleton-counter" />');
  });

  it("defines local visual placeholders and a reduced-motion fallback", () => {
    expect(quoteCss).toContain(".pq-skeleton-shape");
    expect(quoteCss).toContain(".pq-order-card-skeleton { pointer-events: none;");
    expect(quoteCss).toContain("@keyframes pq-skeleton-shimmer");
    expect(quoteCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(quoteCss).toContain(".pq-sr-only");
  });
});
