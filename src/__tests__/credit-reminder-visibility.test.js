/* global process */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readMigrationByName = (name) => {
  const file = readdirSync(join(process.cwd(), "supabase/migrations"))
    .find((item) => item.endsWith(`${name}.sql`));

  if (!file) throw new Error(`No se encontro la migracion ${name}`);
  return readProjectFile(`supabase/migrations/${file}`);
};

describe("visibilidad de recordatorios de credito", () => {
  it("persiste y valida la visibilidad por orden asignada a caja", () => {
    const migration = readMigrationByName("credit_reminder_visibility");

    expect(migration).toContain("visibility_scope text not null default 'creator'");
    expect(migration).toContain("credit_custom_reminders_visibility_scope_check");
    expect(migration).toContain("'creator', 'admin_quote', 'quote'");
    expect(migration).toContain("public.get_credit_reminder_quote_user_ids");
    expect(migration).toContain("join public.orders o on o.id = cro.order_id");
    expect(migration).toContain("o.quote_id is not null");
    expect(migration).toContain("p.role = 'quote'");
    expect(migration).toContain("Selecciona al menos una orden asignada a Caja para compartir el recordatorio.");
  });

  it("restringe lectura y atencion a creador o caja asignada", () => {
    const migration = readMigrationByName("credit_reminder_visibility");

    expect(migration).toContain("public.can_access_credit_custom_reminder");
    expect(migration).toContain("v_visibility_scope = 'admin_quote'");
    expect(migration).toContain("v_visibility_scope = 'quote'");
    expect(migration).toContain("v_role = 'quote'");
    expect(migration).toContain("credit_custom_reminders_select_visible");
    expect(migration).toContain("credit_custom_reminder_orders_select_visible");
    expect(migration).toContain("public.acknowledge_credit_custom_reminder");
    expect(migration).toContain("No tienes permiso para marcar este recordatorio.");
    expect(migration).toContain("revoke insert, update on public.credit_custom_reminders from authenticated");
  });

  it("notifica solo a destinatarios calculados", () => {
    const migration = readMigrationByName("credit_reminder_visibility");

    expect(migration).toContain("public.get_credit_reminder_notification_recipients");
    expect(migration).toContain("public.dispatch_due_credit_reminder_notifications");
    expect(migration).toContain("public.notify_many(");
    expect(migration).toContain("'event_kind', 'credit_custom_reminder_due'");
    expect(migration).toContain("notified_at is null");
  });

  it("admin envia visibilidad y caja crea recordatorios propios", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(dashboard).toContain("CREDIT_REMINDER_VISIBILITY_OPTIONS");
    expect(dashboard).toContain("creditReminderVisibilityIncludesQuote");
    expect(dashboard).toContain("resolveQuoteAssignmentId(invoice?.order)");
    expect(dashboard).toContain("p_visibility_scope: visibilityScope");
    expect(quote).toContain('p_visibility_scope: "creator"');
  });

  it("frontend usa rpc para visto y atendido", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(dashboard).toContain('supabase.rpc("touch_credit_custom_reminders"');
    expect(dashboard).toContain('supabase.rpc("acknowledge_credit_custom_reminder"');
    expect(quote).toContain('supabase.rpc("touch_credit_custom_reminders"');
    expect(quote).toContain('supabase.rpc("acknowledge_credit_custom_reminder"');
    expect(dashboard).not.toMatch(/from\("credit_custom_reminders"\)[\s\S]{0,220}\.update/);
    expect(quote).not.toMatch(/from\("credit_custom_reminders"\)[\s\S]{0,220}\.update/);
  });
});
