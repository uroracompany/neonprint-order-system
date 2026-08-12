/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("notificaciones administrativas de crédito", () => {
  it("programa resumen diario idempotente y recordatorios sin depender del navegador", () => {
    const migration = readProjectFile("supabase/migrations/20260811140000_admin_credit_notifications.sql");

    expect(migration).toContain("admin_credit_daily_notification_runs");
    expect(migration).toContain("primary key (summary_date, admin_user_id)");
    expect(migration).toContain("dispatch_daily_admin_credit_summary");
    expect(migration).toContain("America/Asuncion");
    expect(migration).toContain("admin_credit_daily_summary");
    expect(migration).toContain("dispatch-due-credit-reminders");
    expect(migration).toContain("*/15 * * * *");
    expect(migration).toContain("dispatch-daily-admin-credit-summary");
  });

  it("integra la bandeja y el perfil en Administración", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const profile = readProjectFile("src/components/admin/AdminProfileModule.jsx");

    expect(dashboard).toContain('id: "notifications"');
    expect(dashboard).toContain('id: "profile"');
    expect(dashboard).toContain("DesignerNotificationsModule");
    expect(dashboard).toContain("handleOpenCreditNotification");
    expect(dashboard).toContain("AdminProfileModule");
    expect(profile).toContain("Cuenta administrativa");
    expect(profile).toContain("Este perfil es solo de consulta");
  });
});
