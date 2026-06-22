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

describe("recordatorios visibles de creditos pendientes", () => {
  it("limpia vencimientos y conserva acuse persistente mensual", () => {
    const initialMigration = readProjectFile("supabase/migrations/20260620033000_credit_pending_monthly_alerts.sql");
    const correctiveMigration = readProjectFile("supabase/migrations/20260620050000_credit_custom_reminders.sql");

    expect(initialMigration).toContain("drop function if exists public.get_overdue_credit_receivables(integer)");
    expect(initialMigration).toContain("drop index if exists public.idx_accounts_receivable_open_due_at");
    expect(initialMigration).toContain("create table if not exists public.credit_pending_alert_acknowledgements");
    expect(initialMigration).toContain("unique (user_id, period_key)");
    expect(initialMigration).toContain("enable row level security");
    expect(initialMigration).toContain("grant select, insert on public.credit_pending_alert_acknowledgements to authenticated");
    expect(correctiveMigration).toContain("delete from public.credit_pending_alert_acknowledgements");
    expect(correctiveMigration).toContain("drop constraint if exists credit_pending_alert_ack_period_check");
    expect(correctiveMigration).toContain("check (period_key ~ '^[0-9]{4}-[0-9]{2}$')");
  });

  it("muestra modal mensual y banner persistente sin notificaciones tradicionales", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain("CreditPendingAlertModal");
    expect(dashboard).toContain("shouldShowCreditPendingAlert");
    expect(dashboard).toContain("acknowledgeCreditPendingAlert");
    expect(dashboard).toContain("credit_pending_alert_acknowledgements");
    expect(dashboard).toContain("pa-credit-dashboard-alert");
    expect(dashboard).toContain("pa-credit-pending-banner");
    expect(dashboard).toContain("Este aviso se mostrara una vez al mes mientras existan créditos pendientes.");
    expect(dashboard).not.toMatch(/CREDIT_PENDING_ALERT_FREQUENCY|CREDIT_PENDING_ALERT_TICK_MS|1 minuto|prueba/i);
    expect(dashboard).not.toMatch(/create_notification|NotificationCenter.*credito pendiente|vencid|mora|overdue/i);
  });

  it("agrega recordatorios personalizados independientes del aviso mensual", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");
    const migration = readProjectFile("supabase/migrations/20260620050000_credit_custom_reminders.sql");
    const serverTimeMigration = readProjectFile("supabase/migrations/20260620164000_credit_reminder_server_time.sql");

    expect(migration).toContain("create table if not exists public.credit_custom_reminders");
    expect(migration).toContain("create table if not exists public.credit_custom_reminder_orders");
    expect(migration).toContain("status in ('scheduled', 'due', 'acknowledged', 'cancelled')");
    expect(migration).toContain("using ((select auth.uid()) = created_by)");
    expect(serverTimeMigration).toContain("create or replace function public.get_server_time()");
    expect(serverTimeMigration).toContain("select now();");
    expect(serverTimeMigration).toContain("grant execute on function public.get_server_time() to authenticated");
    expect(dashboard).toContain("CreditReminderCreateModal");
    expect(dashboard).toContain("CreditCustomReminderDueModal");
    expect(dashboard).toContain("Crear recordatorio");
    expect(modals).toContain("Recordatorios de credito");
    expect(modals).toContain("Marcar atendido");
  });

  it("programa los recordatorios personalizados sin depender de recargar la pagina", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");

    expect(dashboard).toContain("CREDIT_REMINDER_FALLBACK_CHECK_MS");
    expect(dashboard).toContain("CREDIT_REMINDER_SERVER_TIME_RESYNC_MS");
    expect(dashboard).toContain("CREDIT_REMINDER_TIME_ZONE = \"America/Santo_Domingo\"");
    expect(dashboard).toContain("CREDIT_REMINDER_MAX_TIMEOUT_MS");
    expect(dashboard).toContain("supabase.rpc(\"get_server_time\")");
    expect(dashboard).toContain("getCreditReminderServerNow");
    expect(dashboard).toContain("zonedDatetimeLocalToUtcMs");
    expect(dashboard).toContain("getTimeZoneOffsetMs");
    expect(dashboard).toContain("getMinimumCreditReminderAt");
    expect(modals).toContain("min={minReminderAt || undefined}");
    expect(modals).toContain("handleReminderAtChange");
    expect(modals).toContain("selectedValue < minReminderAt");
    expect(dashboard).toContain("Selecciona una fecha y hora futura para el recordatorio.");
    expect(dashboard).toContain("No se pudo validar la hora del servidor");
    expect(dashboard).not.toContain("setCreditReminderNow(Date.now())");
    expect(dashboard).toContain("const timeout = setTimeout(async () => {");
    expect(dashboard).toContain("fetchCreditCustomReminders();");
    expect(dashboard).toContain("window.addEventListener(\"focus\", refreshReminderClock)");
    expect(dashboard).toContain("document.addEventListener(\"visibilitychange\", handleVisibilityChange)");
  });

  it("valida estrictamente recordatorios personalizados antes de crearlos", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");
    const validationMigration = readMigrationByName("enforce_credit_reminder_validation");

    expect(dashboard).toContain("Los recordatorios personalizados solo pueden crearse para ordenes a credito.");
    expect(dashboard).toContain("Describe la razon del recordatorio antes de continuar.");
    expect(dashboard).toContain("Selecciona una fecha antes de continuar.");
    expect(dashboard).toContain("const reminderNote = (creditReminderForm.note || \"\").trim();");
    expect(dashboard).toContain("supabase.rpc(\"create_credit_custom_reminder\", {");
    expect(dashboard).toContain("p_order_ids: validSelectedOrderIds");
    expect(modals).toContain("disabled={saving || !canSubmitReminder}");
    expect(dashboard).not.toMatch(/\.from\("credit_custom_reminders"\)[\s\S]{0,180}\.insert/);
    expect(dashboard).not.toMatch(/\.from\("credit_custom_reminder_orders"\)[\s\S]{0,180}\.insert/);

    expect(validationMigration).toContain("alter column note set not null");
    expect(validationMigration).toContain("credit_custom_reminders_note_required");
    expect(validationMigration).toContain("check (btrim(note) <> '')");
    expect(validationMigration).toContain("alter column order_id set not null");
    expect(validationMigration).toContain("create or replace function public.create_credit_custom_reminder");
    expect(validationMigration).toContain("p_order_ids uuid[]");
    expect(validationMigration).toContain("ar.status in ('open', 'partial')");
    expect(validationMigration).toContain("o.payment_status = 'credito'");
    expect(validationMigration).toContain("revoke insert on public.credit_custom_reminders from authenticated");
    expect(validationMigration).toContain("revoke insert on public.credit_custom_reminder_orders from authenticated");
  });
});
