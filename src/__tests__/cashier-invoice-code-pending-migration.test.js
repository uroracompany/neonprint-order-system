import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20261021170709_lock_cashier_invoice_code_after_payment.sql"),
  "utf8",
);

describe("Caja invoice-code pending migration contract", () => {
  const guardBody = migration.slice(
    migration.indexOf("create or replace function public.guard_cashier_invoice_code_pending()"),
    migration.indexOf("revoke all on function public.guard_cashier_invoice_code_pending()"),
  );

  it("rejects code changes when either the old or new assignment mode is cashier unless both payment states are pending", () => {
    expect(guardBody).toContain("new.invoice_number is not distinct from old.invoice_number");
    expect(guardBody).toMatch(/coalesce\(old\.invoice_assignment_mode,\s*'seller'\)\s*=\s*'cashier'/);
    expect(guardBody).toMatch(/or\s+coalesce\(new\.invoice_assignment_mode,\s*'seller'\)\s*=\s*'cashier'/);
    expect(guardBody).toContain("old.payment_status is distinct from 'Pending_Payment'");
    expect(guardBody).toContain("new.payment_status is distinct from 'Pending_Payment'");
    expect(guardBody).toContain("using errcode = 'check_violation'");
  });

  it("leaves seller-to-seller invoice changes and existing assignment RPC/ownership guards outside this migration", () => {
    expect(guardBody).not.toContain("invoice_assignment_mode = 'seller'");
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+public\.quote_assign_invoice_code/i);
    expect(migration).not.toContain("trg_enforce_invoice_assignment_lifecycle");
    expect(migration).not.toContain("trg_guard_order_financial_write_ownership");
    expect(migration).not.toMatch(/alter\s+table\s+public\.orders\s+add\s+column/i);
  });

  it("installs the narrow trigger between assignment lifecycle and financial ownership triggers", () => {
    const lifecycleTrigger = "trg_enforce_invoice_assignment_lifecycle";
    const cashierGuardTrigger = "trg_guard_cashier_invoice_code_pending";
    const ownershipTrigger = "trg_guard_order_financial_write_ownership";

    expect(migration).toContain(`drop trigger if exists ${cashierGuardTrigger} on public.orders`);
    expect(migration).toMatch(/create\s+trigger\s+trg_guard_cashier_invoice_code_pending\s+before\s+update\s+of\s+invoice_number\s+on\s+public\.orders/i);
    expect(lifecycleTrigger.localeCompare(cashierGuardTrigger)).toBeLessThan(0);
    expect(cashierGuardTrigger.localeCompare(ownershipTrigger)).toBeLessThan(0);
    expect(migration).toContain("execute function public.guard_cashier_invoice_code_pending()");
  });

  it("keeps the trigger function uncallable by clients and pins an empty search path", () => {
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.guard_cashier_invoice_code_pending() from public, anon, authenticated");
  });
});
