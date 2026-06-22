/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("consistencia UX de recordatorios de credito", () => {
  it("usa modales compartidos en administracion y cotizador", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");
    const modalCss = readProjectFile("src/components/ui/CreditReminderModals.css");

    expect(dashboard).toContain("../components/ui/CreditReminderModals");
    expect(quote).toContain("../components/ui/CreditReminderModals");
    expect(dashboard).toContain('variant="admin"');
    expect(quote).toContain('variant="quote"');
    expect(dashboard).not.toContain("function CreditReminderCreateModal");
    expect(quote).not.toContain("function CreditReminderCreateModal");
    expect(dashboard).not.toContain("function CreditCustomReminderDueModal");
    expect(quote).not.toContain("function CreditCustomReminderDueModal");
    expect(modals).toContain("export function CreditReminderCreateModal");
    expect(modals).toContain("export function CreditCustomReminderDueModal");
    expect(modalCss).toContain(".credit-reminder--admin");
    expect(modalCss).toContain(".credit-reminder--quote");
  });

  it("mantiene las validaciones visuales de creacion en el modal compartido", () => {
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");

    expect(modals).toContain("hasSelectedCreditOrder && hasReminderNote && hasReminderAt");
    expect(modals).toContain("disabled={saving || !canSubmitReminder}");
    expect(modals).toContain("Visibilidad del recordatorio");
    expect(modals).toContain("visibilityOptions.map");
    expect(modals).toContain("Los recordatorios personalizados solo pueden crearse para ordenes a credito.");
    expect(modals).toContain("Describe la razon del recordatorio antes de continuar.");
    expect(modals).toContain("min={minReminderAt || undefined}");
  });

  it("permite abrir el detalle de credito cotizador desde la fila sin romper acciones internas", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(quote).toContain("const openClientDetail = () => {");
    expect(quote).toContain("onClick={openClientDetail}");
    expect(quote).toContain("onKeyDown={handleClientRowKeyDown}");
    expect(quote).toContain('role="button"');
    expect(quote).toContain("tabIndex={0}");
    expect(quote).toContain("event.stopPropagation();");
  });

  it("expone mensajes exactos de recordatorios en administracion", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(dashboard).toContain('showFeedback("success", "Recordatorio registrado correctamente.")');
    expect(dashboard).toContain('showCreditFeedback("success", "Recordatorio atendido", "Recordatorio marcado como atendido.")');
    expect(dashboard).toContain('eventKind: "admin_credit_feedback"');
    expect(dashboard).not.toContain('showFeedback("success", "El recordatorio fue atendido correctamente.")');
    expect(quote).toContain("showCreditActionFeedback");
    expect(dashboard).toContain("showCreditActionFeedback");
    expect(dashboard).toContain("CREDIT_REMINDER_VISIBILITY_OPTIONS");
    expect(dashboard).toContain("Solo Administrador");
    expect(dashboard).toContain("Administrador y Caja");
    expect(dashboard).toContain("Solo Caja");
    expect(dashboard).toContain("Selecciona al menos una orden asignada a Caja para compartir el recordatorio.");
    expect(dashboard).toContain("p_visibility_scope: visibilityScope");
  });

  it("alinea el modal admin con tokens visuales administrativos", () => {
    const modalCss = readProjectFile("src/components/ui/CreditReminderModals.css");

    expect(modalCss).toContain("--credit-reminder-accent: var(--primary);");
    expect(modalCss).toContain("--credit-reminder-accent-strong: var(--primary-mid);");
    expect(modalCss).toContain("--credit-reminder-accent-soft: var(--primary-light);");
    expect(modalCss).toContain(".credit-reminder--admin .credit-reminder-btn--primary");
    expect(modalCss).toContain("background: var(--primary);");
    expect(modalCss).toContain("box-shadow: 0 4px 14px var(--primary-glow);");
    expect(modalCss).toContain(".credit-reminder--admin .credit-reminder-btn--primary::after");
    expect(modalCss).toContain("background: var(--gradient);");
    expect(modalCss).toContain("background: var(--primary-mid);");
    expect(modalCss).not.toContain("#0369a1");
    expect(modalCss).not.toContain("#075985");
    expect(modalCss).not.toContain("#e0f2fe");
  });

  it("pulimenta el avatar y estados de fila en credito cotizador", () => {
    const quoteCss = readProjectFile("src/css-components/page-quote.css");
    const modalCss = readProjectFile("src/components/ui/CreditReminderModals.css");

    expect(quoteCss).toContain(".pq-credit-client-row");
    expect(quoteCss).toContain("cursor: pointer;");
    expect(quoteCss).toContain(".pq-credit-client-row:focus-visible");
    expect(quoteCss).toContain(".pq-credit-client-avatar");
    expect(quoteCss).toContain("border-radius: 999px;");
    expect(quoteCss).toContain("background: var(--pq-cyan);");
    expect(quoteCss).toContain("color: #ffffff;");
    expect(modalCss).toContain("--credit-reminder-accent: var(--pq-cyan, #06b6d4);");
    expect(modalCss).toContain("background: var(--credit-reminder-accent);");
    expect(modalCss).not.toContain("linear-gradient");
  });

  it("usa estado pendiente sobrio en recordatorios vencidos de caja", () => {
    const modals = readProjectFile("src/components/ui/CreditReminderModals.jsx");
    const modalCss = readProjectFile("src/components/ui/CreditReminderModals.css");

    expect(modals).toContain("Pendiente");
    expect(modals).toContain("Ver credito");
    expect(modals).toContain("Marcar atendido");
    expect(modalCss).toContain("--credit-reminder-due-surface:");
    expect(modalCss).toContain("--credit-reminder-due-border:");
    expect(modalCss).toContain("--credit-reminder-pending-surface: #fef3c7;");
    expect(modalCss).toContain("--credit-reminder-pending-text: #92400e;");
    expect(modalCss).toContain(".credit-reminder--quote .credit-reminder-hero--due");
    expect(modalCss).toContain("background: var(--credit-reminder-due-surface);");
    expect(modalCss).toContain("border-color: var(--credit-reminder-due-border);");
    expect(modalCss).toContain(".credit-reminder--quote .credit-reminder-status");
    expect(modalCss).toContain("background: var(--credit-reminder-pending-surface);");
    expect(modalCss).toContain("color: var(--credit-reminder-pending-text);");
    expect(modalCss).toContain(".credit-reminder--quote .credit-reminder-due-card");
    expect(modalCss).toContain("box-shadow: var(--credit-reminder-soft-shadow);");
  });
});
