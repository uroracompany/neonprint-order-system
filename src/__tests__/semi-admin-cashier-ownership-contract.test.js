import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260928125133_semi_admin_payment_exclusive_and_operational_routing.sql");
const handler = read("server/seller-order-actions-handler.js");
const adminDashboard = read("src/pages/dashboard.jsx");
const adminActions = read("src/components/orders/AdminOrderActions.jsx");
const semiAdminPanel = read("src/components/orders/SemiAdminOperationalPanel.jsx");
const sellerPage = read("src/pages/pages-seller.jsx");

describe("Caja-only payment ownership and Semi-Admin production routing", () => {
  it("gates payment and credit RPCs by active assigned Caja with row lock and concurrency", () => {
    expect(migration).toContain("where p.id = v_actor and p.role = 'quote'");
    expect(migration).toContain("select * into v_order from public.orders where id = p_order_id for update");
    expect(migration).toContain("v_order.quote_id is distinct from v_actor");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("alter function public.settle_credit_orders(uuid[], text, text)");
    expect(migration).toContain("public.mark_order_as_credit(uuid, timestamptz, timestamptz)");
    expect(migration).toContain("revoke all on function public.semi_admin_register_order_payment");
  });

  it("closes direct order-column updates while preserving invoice assignment mode", () => {
    expect(migration).toContain("before update of payment_status, invoice_payment, invoice_number on public.orders");
    expect(migration).toContain("before insert on public.orders");
    expect(migration).toContain("new.payment_status, 'Pending_Payment'");
    expect(migration).toContain("invoice_assignment_mode");
    expect(migration).toContain("old.status <> 'in_Quote' or new.status <> 'in_Quote'");
  });

  it("binds receipt writes to the UUID in the exact payment object key and protects against permissive policies", () => {
    expect(migration).toContain("(storage.foldername(object_name))[2]");
    expect(migration).toContain("^orders/' || o.id::text || '/payment-[^/]+$");
    expect(migration).toContain("o.quote_id = auth.uid()");
    expect(migration).toContain("as restrictive for insert to public");
    expect(migration).toContain("as restrictive for update to public");
    expect(migration).toContain("as restrictive for delete to public");
  });

  it("removes Admin and Semi-Admin payment affordances and rejects the old handler command", () => {
    expect(adminDashboard).not.toContain("<PaymentFormModal");
    expect(adminDashboard).not.toContain('supabase.rpc("settle_credit_orders"');
    expect(adminActions).not.toContain('label: "Pago"');
    expect(semiAdminPanel).not.toContain('hasAction("register_payment")');
    expect(sellerPage).not.toContain("onOpenPayment={() => setSemiAdminPaymentOrder(selectedOrder)}");
    expect(handler).toContain("CASHIER_PAYMENT_OWNERSHIP_REQUIRED");
  });

  it("exposes Semi-Admin routing only for the functional responsible after authorization", () => {
    expect(migration).toContain("public.semi_admin_is_order_routing_responsible(p_order_id, v_actor)");
    expect(migration).toContain("o.order_design_type = 'INTERNAL_DESING' and o.designer_id = p_actor_id");
    expect(migration).toContain("o.order_design_type = 'EXTERNAL_DESING'");
    expect(migration).toContain("v_order.production_authorized_at is not null and v_order.production_authorized_by is not null");
    expect(sellerPage).toContain('renderSemiAdminRowActions(o, "card")');
    expect(sellerPage).toContain("onOpenProductionAssignment={handleOpenSemiAdminProductionAssignment}");
    expect(handler).toContain('"designer_id"');
    expect(handler).toContain('"is_archived_admin"');
  });
});
