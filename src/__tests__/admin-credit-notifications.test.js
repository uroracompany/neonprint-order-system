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

  it("integra la bandeja sin exponer perfil en Administración", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain('id: "notifications"');
    expect(dashboard).toContain("DesignerNotificationsModule");
    expect(dashboard).toContain("handleOpenCreditNotification");
    expect(dashboard).not.toContain('id: "profile"');
    expect(dashboard).not.toContain("AdminProfileModule");
  });

  it("suprime la franja superior sólo en los modales de materiales solicitados", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const materialModal = dashboard.slice(dashboard.indexOf("{showMaterialModal && ("), dashboard.indexOf("{showTerminationModal && ("));
    const terminationModal = dashboard.slice(dashboard.indexOf("{showTerminationModal && ("), dashboard.indexOf("{activeTab === \"users\""));

    expect(materialModal).toContain('className="pa-modal pa-modal--hide-top-accent"');
    expect(materialModal).toContain("handleSaveMaterial");
    expect(terminationModal).toContain('className="pa-modal pa-modal--hide-top-accent"');
    expect(terminationModal).toContain("handleSaveTermination");
  });
});
