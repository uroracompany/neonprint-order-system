/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("modulo de creditos en caja", () => {
  it("agrega el apartado de creditos al sidebar de caja con contador precargado", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(quote).toContain('id: "credits"');
    expect(quote).toContain('label: "Créditos"');
    expect(quote).toContain("badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount)");
    expect(quote).toContain("fetchAccountsReceivable();");
    expect(quote).toContain("fetchCreditCustomReminders();");
    expect(quote).toContain('table: "accounts_receivable"');
    expect(quote).toContain('table: "credit_custom_reminders"');
  });

  it("permite a caja operar creditos sin edicion administrativa", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const creditsStart = quote.indexOf('{activeTab === "credits" && creditView === "list"');
    const creditsEnd = quote.indexOf('{activeTab === "orders" && (', creditsStart);
    const creditsBlock = quote.slice(creditsStart, creditsEnd);

    expect(creditsBlock).toContain("Créditos agrupados por cliente");
    expect(creditsBlock).toContain("openCreditReminderModal");
    expect(creditsBlock).toContain("openCreditSettlementModal");
    expect(creditsBlock).not.toContain("handleEditClient");
    expect(creditsBlock).not.toContain("handleDeleteClient");
    expect(creditsBlock).not.toContain("openEditOrder");
  });

  it("usa las rpc existentes para crear recordatorios y cerrar creditos", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(quote).toContain('supabase.rpc("create_credit_custom_reminder"');
    expect(quote).toContain('p_visibility_scope: "creator"');
    expect(quote).toContain('supabase.rpc("settle_credit_orders"');
    expect(quote).toContain("Los recordatorios personalizados solo pueden crearse para órdenes a crédito.");
    expect(quote).toContain("Describe la razón del recordatorio antes de continuar.");
    expect(quote).toContain("Selecciona una fecha antes de continuar.");
  });

  it("muestra recordatorios vencidos propios en caja", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(quote).toContain("CreditCustomReminderDueModal");
    expect(quote).toContain("dueCreditCustomReminders");
    expect(quote).toContain("handleAcknowledgeCreditReminder");
    expect(quote).toContain("handleReviewCreditReminder");
    expect(quote).toContain('supabase.rpc("acknowledge_credit_custom_reminder"');
    expect(quote).toContain('supabase.rpc("touch_credit_custom_reminders"');
  });
});
