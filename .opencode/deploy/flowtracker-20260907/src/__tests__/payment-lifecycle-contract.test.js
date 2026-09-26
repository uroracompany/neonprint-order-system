import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (file) => readFileSync(resolve(file), "utf8");

describe("global payment lifecycle contract", () => {
  const migration = projectFile("supabase/migrations/20260905185147_global_payment_lifecycle_and_semi_admin_access.sql");

  it("requires receipt or registered receipt number when marking paid", () => {
    expect(migration).toContain("new.invoice_payment");
    expect(migration).toContain("new.invoice_number");
    expect(migration).toContain("Para marcar la orden como pagada debes adjuntar un comprobante/factura o ingresar un número de comprobante.");
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
  });

  it("keeps client payment uploads and commands behind the Semi-Admin flow", () => {
    expect(projectFile("server/seller-order-actions-handler.js")).toContain('register_payment: (payload, auth, env) => handleSemiAdminCatalogCommand(payload, auth, env, "register_payment")');
    const storageGateway = projectFile("server/storage-gateway.js");
    expect(storageGateway).toContain("order.seller_id === userId");
    expect(storageGateway).toContain("order.created_by === userId");
    expect(storageGateway).toContain("Solo el responsable o creador Semi-Admin puede adjuntar comprobantes");
    expect(projectFile("src/components/ui/PaymentFormModal.jsx")).toContain("allowReceiptNumber");
  });
});
