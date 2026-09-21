/* global process */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

const notifications = read("src/hooks/useNotifications.js");
const dashboard = read("src/pages/dashboard.jsx");
const seller = read("src/pages/pages-seller.jsx");
const quote = read("src/pages/page-quote.jsx");
const production = read("src/pages/page-production.jsx");
const delivery = read("src/pages/page-delivery.jsx");
const adminOrders = read("server/admin-list-orders-handler.js");
const sharedOrderSelect = read("src/utils/orderListSelect.js");
const indexes = read("supabase/migrations/20260921120000_order_list_performance_indexes.sql");

describe("performance optimization contracts", () => {
  it("keeps notification and admin list payloads explicit", () => {
    expect(notifications).toContain("NOTIFICATION_SELECT_COLUMNS");
    expect(notifications).toContain(".select(NOTIFICATION_SELECT_COLUMNS)");
    expect(adminOrders).toContain("ADMIN_ORDER_LIST_SELECT");
    expect(adminOrders).toContain(".select(ADMIN_ORDER_LIST_SELECT, { count: \"exact\" })");
  });

  it("defers administrative secondary data to the relevant tab", () => {
    expect(dashboard).toContain("activeTab === \"overview\" || activeTab === \"clients\"");
    expect(dashboard).toContain("activeTab === \"users\" || activeTab === \"orders\"");
    expect(dashboard).not.toContain("loadProfiles();\n    fetchClients();\n    fetchAccountsReceivable();");
  });

  it("does not recalculate seller dashboard data for filtered or secondary pages", () => {
    expect(seller).toContain("const dashboardEligible =");
    expect(seller).toContain("nextPage === 1");
    expect(seller).toContain("includeDashboard: includeDashboardRequest");
    expect(seller).toContain("hasOwnProperty.call(result || {}, \"summary\")");
    const dashboardGuard = seller.slice(
      seller.indexOf("const dashboardEligible ="),
      seller.indexOf("const includeDashboardRequest =")
    );
    expect(dashboardGuard).not.toContain('filterArchive === "active"');
    expect(seller).toContain('const isReturnedFilter = filterArchive === "returned";');
  });

  it("uses shared projections and avoids the unbounded quote fallback", () => {
    expect(sharedOrderSelect).toContain("export const OPERATIONAL_ORDER_COLUMNS");
    expect(sharedOrderSelect).toContain("export const PRODUCTION_ORDER_SELECT");
    expect(sharedOrderSelect).toContain("export const QUOTE_ORDER_SELECT");
    expect(production).toContain(".select(PRODUCTION_ORDER_SELECT)");
    expect(delivery).toContain(".select(OPERATIONAL_ORDER_COLUMNS)");
    expect(quote).toContain(".select(QUOTE_ORDER_SELECT)");
    expect(quote).not.toContain("fallbackData");
    expect(quote).not.toContain('.select("*, order_production_files(*)")');
  });

  it("defines only additive indexes for the measured list query plans", () => {
    expect(indexes).toContain("idx_orders_quote_created_at");
    expect(indexes).toContain("idx_orders_designer_created_at");
    expect(indexes).toContain("idx_orders_seller_created_at");
    expect(indexes).toContain("idx_orders_created_by_created_at");
    expect(indexes).toContain("idx_accounts_receivable_issued_at");
    expect(indexes).toContain("create index if not exists");
    expect(indexes).not.toContain("drop index");
  });
});
