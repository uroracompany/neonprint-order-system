import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");

describe("Semi-Admin Caja/audit synchronization contract", () => {
  const migration = read("supabase/migrations/20260907110000_semi_admin_cash_audit_sync.sql");
  const handler = read("server/seller-order-actions-handler.js");
  const panel = read("src/components/orders/SemiAdminOperationalPanel.jsx");
  const editor = read("src/components/orders/EditOrderModal.jsx");
  const quotePage = read("src/pages/page-quote.jsx");
  const sellerPage = read("src/pages/pages-seller.jsx");

  it("keeps payment, responsibility and return behind the Caja-only RPC boundary", () => {
    expect(migration).toContain("if v_old.status <> 'in_Quote'");
    expect(migration).toContain("v_old.payment_status = 'pagado' and p_payment_status not in ('pagado', 'Pending_Payment')");
    expect(migration).toContain("p_action = 'return_quote_to_design'");
    expect(migration).toContain("v_old.designer_id is null");
    expect(migration).toContain("p_payload->>'stage' = 'quote'");
    expect(migration).toContain("p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at");
  });

  it("rejects direct Semi-admin production-specification RPC commands at the gateway", () => {
    const productionBoundary = migration.slice(
      migration.indexOf("if p_action in ('production_file_status'"),
      migration.indexOf("if p_action in ('return_quote_to_design', 'stage_responsibility')")
    );

    expect(productionBoundary).toContain("'production_specifications'");
    expect(productionBoundary).toContain("raise exception 'Semi-Administración no puede gestionar Producción.'");
  });

  it("records and returns bounded internal-only audit data", () => {
    expect(migration).toContain("'semi_admin_payment_updated'");
    expect(migration).toContain("'semi_admin_return_quote_to_design'");
    expect(handler).toContain("semi_admin_operational_history");
    expect(handler).toContain(".limit(20)");
    expect(handler).toContain("from(\"order_events\")");
  });

  it("keeps the Caja UI catalog-driven and the asset editor mounted", () => {
    expect(panel).toContain("hasPendingPayment = order.payment_status === \"Pending_Payment\"");
    expect(panel).toContain("hasAction(\"register_payment\")");
    expect(panel).toContain("onOpenQuoteReturn");
    expect(editor).toContain("keepOpenAfterAssetSave");
    expect(editor).toContain("hideStripe={semiAdminVariant}");
  });

  it("subscribes Semi-Administración to production-file changes for open-order refresh", () => {
    expect(sellerPage).toContain('tables: ["orders", "order_production_files"]');
    expect(sellerPage).toContain('changedTables.has("order_production_files")');
    expect(sellerPage).toContain('runSellerOrderAction("detail", { order_id: openOrderId })');
  });

  it("shares the Caja return dialog while forcing Semi-admin's internal-designer presentation", () => {
    expect(quotePage).toContain('from "../components/orders/ReturnToDesignerModal"');
    expect(quotePage).not.toContain("function ReturnToDesignerModal");
    expect(sellerPage).toContain('from "../components/orders/ReturnToDesignerModal"');
    expect(sellerPage).not.toContain('Modal as SharedModal');
    expect(sellerPage).toContain('targetOverride="designer"');
    expect(sellerPage).toContain("minReasonLength={10}");
    expect(sellerPage).toContain('handleSemiAdminOperation("return_quote_to_design", { reason })');
  });
});
