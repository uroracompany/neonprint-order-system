import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectFile = (file) => readFileSync(resolve(file), "utf8");

describe("Caja payment receipt integrity", () => {
  const migration = projectFile("supabase/migrations/20260907141901_cash_receipt_integrity.sql");
  const paymentAuthorizationMigration = projectFile("supabase/migrations/20260926112516_payment_authorization_production_gate.sql");
  const quotePage = projectFile("src/pages/page-quote.jsx");

  it("requires an explicit, canonical uploaded image for the versioned Caja payment command", () => {
    expect(migration).toContain("create or replace function public.quote_set_order_payment(");
    expect(migration).toContain("p_expected_updated_at timestamptz");
    expect(migration).toContain("public.quote_has_uploaded_payment_receipt(p_order_id, v_invoice_payment)");
    expect(migration).toContain("Caja requiere una imagen de comprobante");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("v_role not in ('quote', 'admin')");
    expect(migration).toContain("v_order.quote_id is distinct from v_actor");
    expect(migration).toContain("set_config('app.neonprint_order_command', 'on', true)");
    expect(migration).toContain("revoke all on function public.quote_set_order_payment(uuid,text,text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.quote_set_order_payment(uuid,text,text,timestamptz) to authenticated");
  });

  it("binds both canonical schemes to an active same-order payment image and rejects fallback references", () => {
    expect(migration).toContain("left(v_reference, char_length('supabase://')) = 'supabase://'");
    expect(migration).toContain("left(v_reference, char_length('r2://')) = 'r2://'");
    expect(migration).toContain("f.order_id = p_order_id");
    expect(migration).toContain("f.bucket = 'payment-invoice'");
    expect(migration).toContain("f.category = 'payment'");
    expect(migration).toContain("f.status = 'uploaded'");
    expect(migration).toContain("f.deleted_at is null");
    expect(migration).toContain("f.payment_image_verified_at is not null");
    expect(migration).toContain("^image/[a-z0-9][a-z0-9.+-]*$");
    expect(migration).toContain("f.object_key like 'orders/' || p_order_id::text || '/%'");
    expect(migration).toContain("position('?' in v_reference) > 0");
    expect(migration).toContain("position('#' in v_reference) > 0");
    expect(migration).toContain("position('%' in v_reference) > 0");
    expect(migration).toContain("public.quote_encode_payment_asset_uri(f.object_key)");
    expect(migration).toContain("from public, anon, authenticated");
    expect(projectFile("supabase/migrations/20260827003000_p2_purge_claim_and_order_guard_remediation.sql")).toContain("guard_orders_direct_update");
  });

  it("extends only the private payment bucket MIME allow-list with GIF", () => {
    const policyStart = migration.indexOf("update storage.buckets\nset allowed_mime_types = array[");
    const policyEnd = migration.indexOf("where id = 'payment-invoice';", policyStart);
    const paymentBucketPolicy = migration.slice(policyStart, policyEnd + "where id = 'payment-invoice';".length);

    expect(policyStart).toBeGreaterThanOrEqual(0);
    expect(paymentBucketPolicy).toContain("'image/jpeg'");
    expect(paymentBucketPolicy).toContain("'image/png'");
    expect(paymentBucketPolicy).toContain("'image/webp'");
    expect(paymentBucketPolicy).toContain("'image/gif'");
    expect(paymentBucketPolicy).toContain("'application/pdf'");
    expect(paymentBucketPolicy).toContain("where id = 'payment-invoice';");
    expect(paymentBucketPolicy).not.toMatch(/\bpublic\s*=/i);
    expect(paymentBucketPolicy).not.toMatch(/\bfile_size_limit\s*=/i);
  });

  it("keeps Caja gated by a verified image record and submits its canonical stored reference", () => {
    expect(quotePage).toContain("getCanonicalPaymentReceiptCandidate");
    expect(quotePage).toContain("const hasVerifiedPaymentReceipt = (order) =>");
    expect(quotePage).toContain("file.payment_image_verified_at");
    expect(quotePage).toContain("file.category === \"payment\"");
    expect(quotePage).toContain("PAYMENT_RECEIPT_REQUIRED_MESSAGE");
    expect(quotePage).toContain('bucket: "payment-invoice"');
    expect(quotePage).toContain("buildPaymentReceiptPath(order.id, receiptFile.name)");
    expect(quotePage).toContain('rpc("quote_set_order_payment"');
    expect(quotePage).toContain("hasVerifiedPaymentReceipt(order)");
    expect(quotePage).toContain("let invoicePaymentUrl = paymentStatus === PAYMENT_STATUS.PAID ? persistedReceiptReference : null");

    const paidSubmitGuardStart = quotePage.indexOf("if (paymentStatus === PAYMENT_STATUS.PAID && !receiptFile && !persistedReceiptReference)");
    const paidSubmitGuard = quotePage.slice(
      paidSubmitGuardStart,
      quotePage.indexOf("setPaymentSaving(true)", paidSubmitGuardStart),
    );
    expect(paidSubmitGuard).toContain("!receiptFile && !persistedReceiptReference");
    expect(paidSubmitGuard).not.toContain("invoice_number");
  });

  it("applies the strict billing-code and verified-image rule to the SemiAdmin writer", () => {
    expect(paymentAuthorizationMigration).toContain("semi_admin_register_order_payment");
    expect(paymentAuthorizationMigration).toContain("order_has_confirmable_payment");
    expect(paymentAuthorizationMigration).toContain("v_invoice_payment");
    expect(paymentAuthorizationMigration).toContain("adjuntar un comprobante de imagen verificado");
    expect(paymentAuthorizationMigration).not.toContain("allowReceiptNumber");
  });
});
