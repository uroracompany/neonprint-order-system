import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("Caja paid payment correction contract", () => {
  const migration = readProjectFile("supabase/migrations/20261003133518_allow_cashier_paid_payment_correction.sql");
  const quotePage = readProjectFile("src/pages/page-quote.jsx");
  const paymentModal = readProjectFile("src/components/ui/PaymentFormModal.jsx");

  it("allows only the assigned cashier to correct paid to pending or partial before authorization", () => {
    expect(migration).toContain("p.role = 'quote'");
    expect(migration).toContain("v_order.quote_id is distinct from v_actor");
    expect(migration).toContain("v_order.status <> 'in_Quote'");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("v_order.production_authorized_at is not null or v_order.production_authorized_by is not null");
    expect(migration).toContain("v_order.payment_status = 'pagado'");
    expect(migration).toContain("p_payment_status in ('Pending_Payment', 'parcial')");
    expect(migration).toContain("for update");
  });

  it("unlinks the active receipt, preserves billing code, and records a correction event", () => {
    expect(migration).toContain("when v_is_correction or p_payment_status = 'parcial' then null");
    expect(migration).toContain("'payment_corrected'");
    expect(migration).toContain("'receipt_unlinked', v_order.invoice_payment is not null");
    expect(migration).toContain("'corrected_by', v_actor");
    expect(migration).not.toMatch(/delete\s+from\s+storage/i);
  });

  it("blocks direct financial writes after an existing or newly persisted production authorization", () => {
    expect(migration).toContain("old.production_authorized_at is not null or old.production_authorized_by is not null");
    expect(migration).toContain("new.production_authorized_at is not null or new.production_authorized_by is not null");
  });

  it("exposes a correction-only UI mode with pending/partial choices and read-only receipt/code", () => {
    expect(quotePage).toContain("const canCorrectPaidPayment =");
    expect(quotePage).toContain("correctionMode={Boolean(paymentModalOrder && canCorrectPaidPayment");
    expect(paymentModal).toContain("{ value: PAYMENT_STATUS.PENDING, label: \"Pendiente\" }");
    expect(paymentModal).toContain("{ value: PAYMENT_STATUS.PARTIAL, label: \"Pago parcial\" }");
    expect(paymentModal).toContain("isPaymentCorrection: correctionMode");
    expect(paymentModal).toContain("Guardar corrección");
    expect(paymentModal).toContain("Comprobante actual (solo lectura)");
    expect(paymentModal).toContain("readOnly={correctionMode || (hasSavedInvoice && !invoiceCodeEditing)}");
    expect(paymentModal).toContain("disabled={!correctionMode && (loading || !invoiceCodeEditable)}");
    expect(paymentModal).toContain("setExistingReceiptLoadState(\"loading\")");
    expect(paymentModal).toContain("setExistingReceiptLoadState(\"error\")");
    expect(paymentModal).toContain("el archivo almacenado no se eliminará.");
    expect(paymentModal).toContain("aria-labelledby=\"pfm-payment-status-label\"");
  });
});
