/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("pago a credito sin monto interno", () => {
  it("valida credito por numero de facturacion en base de datos", () => {
    const baseMigration = readProjectFile("supabase/migrations/20260618222536_credit_payment_receivables.sql");
    const fixMigration = readProjectFile("supabase/migrations/20260619034902_credit_without_internal_amount.sql");

    expect(baseMigration).toContain("La orden debe tener un numero de facturacion para vender a credito.");
    expect(fixMigration).toContain("La orden debe tener un numero de facturacion para vender a credito.");
    expect(baseMigration).not.toContain("La orden debe tener un monto valido para vender a credito.");
    expect(fixMigration).not.toContain("La orden debe tener un monto valido para vender a credito.");
  });

  it("cierra creditos manualmente sin registrar pagos con monto interno desde la UI", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(dashboard).toContain('supabase.rpc("settle_credit_orders"');
    expect(dashboard).not.toContain('supabase.rpc("record_client_payment"');
    expect(quote).toContain('rpc("mark_order_as_credit", { p_order_id: order.id, p_due_date: null })');
    expect(quote).not.toContain("p_amount");
  });

  it("evita notificaciones duplicadas al aprobar credito", () => {
    const creditFixMigration = readProjectFile("supabase/migrations/20260619034902_credit_without_internal_amount.sql");
    const notificationFixMigration = readProjectFile("supabase/migrations/20260619042000_deduplicate_credit_notifications.sql");
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(creditFixMigration).toContain("'event_kind', 'credit_granted'");
    expect(notificationFixMigration).toContain("new.payment_status <> ''credito''");
    expect(dashboard).not.toMatch(/showFeedback\("success",\s*"Cr(?:é|Ã©)dito aprobado correctamente\."\)/);
    expect(quote).not.toMatch(/showActionNotification\(\{[\s\S]*Cr(?:é|Ã©)dito aprobado/);
  });
});
