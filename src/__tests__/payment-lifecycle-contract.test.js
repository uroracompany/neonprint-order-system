import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (file) => readFileSync(resolve(file), "utf8");

describe("global payment lifecycle contract", () => {
  const migration = projectFile("supabase/migrations/20260905185147_global_payment_lifecycle_and_semi_admin_access.sql");
  const reconciliation = projectFile("supabase/migrations/20260906110000_semi_admin_client_cancel_payment.sql");
  const strictPaymentMigration = projectFile("supabase/migrations/20260926112516_payment_authorization_production_gate.sql");
  const cashierOwnershipMigration = projectFile("supabase/migrations/20260928125133_semi_admin_payment_exclusive_and_operational_routing.sql");

  it("requires a billing code plus a verified image when marking paid", () => {
    expect(strictPaymentMigration).toContain("create or replace function public.order_has_confirmable_payment");
    expect(strictPaymentMigration).toContain("nullif(btrim(coalesce(p_invoice_number, '')), '') is not null");
    expect(strictPaymentMigration).toContain("public.quote_has_uploaded_payment_receipt");
    expect(strictPaymentMigration).toContain("código de facturación y adjuntar un comprobante de imagen verificado");
    const paymentModal = projectFile("src/components/ui/PaymentFormModal.jsx");
    expect(paymentModal).not.toContain("allowReceiptNumber");
    expect(paymentModal).not.toContain("receiptNumber");
  });

  it("blocks pending payment from Production and partial payment from Delivery", () => {
    expect(migration).toContain("new.status = 'in_Production'");
    expect(migration).toContain("new.payment_status = 'Pending_Payment'");
    expect(migration).toContain("new.status = 'in_Delivered'");
    expect(migration).toContain("new.payment_status not in ('pagado', 'credito')");
  });

  it("revokes legacy payment RPCs and requires the assigned Caja actor on every payment command", () => {
    expect(cashierOwnershipMigration).toContain("perform public.assert_assigned_cashier_order(p_order_id, p_expected_updated_at, true)");
    expect(cashierOwnershipMigration).toContain("public.semi_admin_register_order_payment(uuid, text, text, text, timestamptz)");
    expect(cashierOwnershipMigration).toContain("public.semi_admin_set_order_payment(uuid, text, text, timestamptz)");
    expect(cashierOwnershipMigration).toContain("Solo el responsable asignado de Caja puede gestionar esta orden.");
    expect(cashierOwnershipMigration).toContain("Solo el responsable asignado de Caja puede cerrar créditos abiertos de sus órdenes.");
    expect(cashierOwnershipMigration).toContain("before update of payment_status, invoice_payment, invoice_number on public.orders");
    expect(cashierOwnershipMigration).toContain("old.status <> 'in_Quote' or new.status <> 'in_Quote'");
    expect(cashierOwnershipMigration).toContain("from public, anon, authenticated");
    expect(reconciliation).toContain("current_setting('app.neonprint_order_command', true) = 'on'");
  });

  it("restricts payment-invoice uploads to the assigned Cashier and exact order path", () => {
    const handler = projectFile("server/seller-order-actions-handler.js");
    const storageGateway = projectFile("server/storage-gateway.js");
    expect(handler).toContain("CASHIER_PAYMENT_OWNERSHIP_REQUIRED");
    expect(storageGateway).toContain('return role === "quote" && order.status === "in_Quote" && order.quote_id === userId');
    expect(storageGateway).not.toContain("canCompletePartialPayment");
    expect(cashierOwnershipMigration).toContain("(storage.foldername(object_name))[2]");
    expect(cashierOwnershipMigration).toContain("^orders/' || o.id::text || '/payment-[^/]+$");
    expect(cashierOwnershipMigration).toContain("as restrictive for insert to public");
    expect(cashierOwnershipMigration).toContain("as restrictive for update to public");
    expect(cashierOwnershipMigration).toContain("as restrictive for delete to public");
  });
});
