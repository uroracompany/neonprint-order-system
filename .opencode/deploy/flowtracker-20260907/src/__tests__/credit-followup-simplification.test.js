/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("seguimiento de créditos sin montos", () => {
  const migration = () => readProjectFile("supabase/migrations/20260901120000_simplify_credit_followup.sql");

  it("reduce el estado de seguimiento y conserva su historial", () => {
    const sql = migration();

    expect(sql).toContain("when 'partial' then 'open'");
    expect(sql).toContain("when 'paid' then 'resolved'");
    expect(sql).toContain("status in ('open', 'resolved', 'void')");
    expect(sql).toContain("resolved_at");
    expect(sql).toContain("void_reason");
  });

  it("solo permite a Caja resolver órdenes abiertas de un mismo cliente", () => {
    const sql = migration();

    expect(sql).toContain("Solo Caja puede cerrar seguimientos de crédito.");
    expect(sql).toContain("Todas las órdenes deben tener un seguimiento de crédito abierto.");
    expect(sql).toContain("Solo puedes cerrar órdenes pendientes del mismo cliente.");
    expect(sql).toContain("status = 'resolved'");
  });

  it("protege identidad, cancelación, reapertura y retención histórica", () => {
    const sql = migration();

    expect(sql).toContain("prevent_open_credit_identity_change");
    expect(sql).toContain("reset_cancelled_credit_on_reopen");
    expect(sql).toContain("new.payment_status := 'Pending_Payment'");
    expect(sql).toContain("prevent_credit_order_purge");
  });

  it("muestra a Caja un resumen dinámico cada treinta días", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");
    const sql = migration();

    expect(quote).toContain("CreditPendingAlertModal");
    expect(quote).toContain("credit_pending_alert_is_due");
    expect(quote).toContain("acknowledge_credit_pending_alert");
    expect(modals).toContain("dentro de 30 días");
    expect(sql).toContain("credit_pending_alert_states");
    expect(sql).toContain("interval '30 days'");
  });
});
