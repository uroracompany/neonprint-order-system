import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");

describe("invoice assignment mode contract", () => {
  const migration = read("supabase/migrations/20260921143000_invoice_assignment_mode_and_cashier_guards.sql");
  const createOrder = read("src/components/orders/CreateOrderModal.jsx");
  const paymentModal = read("src/components/ui/PaymentFormModal.jsx");
  const quotePage = read("src/pages/page-quote.jsx");
  const sharedSelect = read("src/utils/orderListSelect.js");

  it("keeps old orders seller-owned and adds explicit cashier mode", () => {
    expect(migration).toContain("add column if not exists invoice_assignment_mode text not null default 'seller'");
    expect(migration).toContain("check (invoice_assignment_mode in ('seller', 'cashier'))");
    expect(migration).toContain("set invoice_assignment_mode = 'seller'");
    expect(createOrder).toContain('invoice_assignment_mode: "seller"');
    expect(createOrder).toContain('event.target.checked ? "cashier" : "seller"');
    expect(createOrder).toContain("Asignar código de facturación en Caja");
    expect(sharedSelect).toContain('"invoice_assignment_mode"');
  });

  it("enforces cashier code and verified receipt in the database", () => {
    expect(migration).toContain("create or replace function public.enforce_invoice_assignment_lifecycle()");
    expect(migration).toContain("public.quote_has_uploaded_payment_receipt(new.id, new.invoice_payment)");
    expect(migration).toContain("Caja debe registrar el código de facturación antes de marcar la orden como pagada.");
    expect(migration).toContain("Caja debe registrar el código de facturación antes de continuar la orden.");
    expect(migration).toContain("and not v_is_admin then");
    expect(migration).toContain("Responsabilidad de facturación inválida.");
    expect(migration).toContain("create or replace function public.quote_assign_invoice_code(");
    expect(migration).toContain("Solo la Caja responsable puede registrar el código de facturación.");
    expect(migration).toContain("grant execute on function public.quote_assign_invoice_code(uuid, text, timestamptz) to authenticated");
  });

  it("keeps frontend payment evidence separate from invoice code", () => {
    expect(paymentModal).toContain("canAssignInvoiceCode");
    expect(paymentModal).toContain("Código de facturación");
    expect(paymentModal).toContain("invoiceNumber");
    expect(paymentModal).toContain("receiptNumber");
    expect(quotePage).toContain("handleAssignInvoiceCode");
    expect(quotePage).toContain('rpc("quote_assign_invoice_code"');
    expect(quotePage).toContain('rpc("quote_set_order_payment"');
  });
});
