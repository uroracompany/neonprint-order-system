import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (file) => readFileSync(resolve(file), "utf8");

describe("global payment lifecycle contract", () => {
  const migration = projectFile("supabase/migrations/20260905185147_global_payment_lifecycle_and_semi_admin_access.sql");
  const reconciliation = projectFile("supabase/migrations/20260906110000_semi_admin_client_cancel_payment.sql");
  const strictPaymentMigration = projectFile("supabase/migrations/20260926112516_payment_authorization_production_gate.sql");

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

  it("allows Semi-Admin payment only as responsible or order creator through the audited command", () => {
    expect(migration).toContain("create or replace function public.semi_admin_register_order_payment");
    expect(migration).toContain("v_old.designer_id is distinct from v_actor");
    expect(migration).toContain("and v_old.quote_id is distinct from v_actor");
    expect(migration).toContain("and v_old.seller_id is distinct from v_actor");
    expect(migration).toContain("and v_old.created_by is distinct from v_actor");
    expect(migration).toContain("or v_order.seller_id = v_actor");
    expect(migration).toContain("or v_order.created_by = v_actor");
    expect(migration).toContain("old.payment_status = 'parcial' and new.payment_status = 'pagado'");
    expect(migration).toContain("'semi_admin_payment_updated'");
    expect(reconciliation).toContain("current_setting('app.neonprint_order_command', true) = 'on'");
    expect(reconciliation).toContain("v_role not in ('admin', 'quote') and not v_authorized_semi_admin_credit");
    expect(reconciliation).toContain("accounts_receivable ar where ar.order_id = new.id and ar.status = 'resolved'");
    expect(reconciliation).toContain("new.client_id is null");
    expect(reconciliation).toContain("new.invoice_number");
  });

  it("keeps client payment uploads and commands behind the Semi-Admin flow", () => {
    expect(projectFile("server/seller-order-actions-handler.js")).toContain('register_payment: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "register_payment")');
    const storageGateway = projectFile("server/storage-gateway.js");
    expect(storageGateway).toContain("order.seller_id === userId");
    expect(storageGateway).toContain("order.created_by === userId");
    expect(storageGateway).toContain("Solo el responsable o creador Semi-Admin puede adjuntar comprobantes");
    const paymentModal = projectFile("src/components/ui/PaymentFormModal.jsx");
    expect(paymentModal).toContain("Código de facturación");
    expect(paymentModal).toContain("validateReceiptFile");
    expect(paymentModal).not.toContain("allowReceiptNumber");
  });
});
