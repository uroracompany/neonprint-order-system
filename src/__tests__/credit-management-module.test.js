/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("modulo de gestion de creditos", () => {
  it("expone un tab administrativo dedicado y visualmente organizado para creditos", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");

    expect(dashboard).toContain('id: "credits"');
    expect(dashboard).toContain('activeTab === "credits"');
    expect(dashboard).toContain('activeTab === "credits" ?');
    expect(dashboard).toContain("agrupados por cliente");
    expect(dashboard).toContain("pa-credit-metrics");
    expect(dashboard).toContain("pa-credit-summary-item");
    expect(dashboard).toContain("creditView");
    expect(dashboard).toContain("CreditClientDetailView");
    expect(dashboard).toContain("SettleCreditModal");
    expect(adminCss).toContain(".pa-credit-metrics");
    expect(adminCss).toContain(".pa-credit-summary");
    expect(adminCss).toContain("@media (max-width: 640px)");
  });

  it("agrupa cuentas por cobrar por cliente y permite filtros operativos", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain("const allCreditClientGroups = useMemo");
    expect(dashboard).toContain("const creditClientGroups = useMemo");
    expect(dashboard).toContain("const creditDetailClient = useMemo");
    expect(dashboard).toContain("creditDetailClientId");
    expect(dashboard).toContain("clientName");
    expect(dashboard).toContain("clientPhone");
    expect(dashboard).toContain("invoiceNumber");
    expect(dashboard).toContain("creditStatusFilter");
    expect(dashboard).toContain("Buscar por cliente, telefono, factura u orden");
    expect(dashboard).not.toContain("setCreditDetailClient(group)");
  });

  it("muestra recordatorios visibles de creditos pendientes sin vencimientos ni montos internos", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");
    const migration = readProjectFile("supabase/migrations/20260620033000_credit_pending_monthly_alerts.sql");

    expect(dashboard).toContain("creditPendingInvoicesCount");
    expect(dashboard).toContain("creditPendingClientCount");
    expect(dashboard).toContain("CreditPendingAlertModal");
    expect(dashboard).toContain("CreditReminderCreateModal");
    expect(dashboard).toContain("CreditCustomReminderDueModal");
    expect(dashboard).toContain("Crear recordatorio");
    expect(dashboard).not.toMatch(/CREDIT_PENDING_ALERT_FREQUENCY|CREDIT_PENDING_ALERT_TICK_MS|1 minuto|prueba/i);
    expect(dashboard).toContain("credit_pending_alert_acknowledgements");
    expect(dashboard).toContain("pa-credit-dashboard-alert");
    expect(dashboard).toContain("pa-credit-pending-banner");
    expect(dashboard).toContain("pa-credit-pending-banner");
    expect(dashboard).not.toContain('value="overdue"');
    expect(dashboard).not.toMatch(/vencid|mora|creditOverdue|creditDueAt|creditAgeDays/i);
    expect(adminCss).toContain(".pa-credit-dashboard-alert");
    expect(adminCss).toContain(".pa-credit-pending-banner");
    expect(adminCss).toContain(".pa-credit-alert-modal");
    expect(migration).toContain("credit_pending_alert_acknowledgements");
    expect(migration).toContain("drop function if exists public.get_overdue_credit_receivables(integer)");
    expect(migration).toContain("drop index if exists public.idx_accounts_receivable_open_due_at");
    expect(migration).not.toMatch(/amount|balance|total adeudado|monto pendiente/i);
  });

  it("sincroniza creditos en tiempo real sin dejar detalle o seleccion congelados", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const sharedHook = readProjectFile("src/hooks/useOrdersRealtimeSync.js");

    expect(dashboard).toContain("useOrdersRealtimeSync({");
    expect(dashboard).toContain("admin-related-data");
    expect(sharedHook).toContain('{ event: "*", schema: "public", table: "orders" }');
    expect(sharedHook).toContain("orders:user:${userId}");
    expect(dashboard).toContain("table: 'accounts_receivable'");
    expect(dashboard).toContain("table: 'clients'");
    expect(dashboard).toContain("loadOrders(true)");
    expect(dashboard).toContain("fetchAccountsReceivable()");
    expect(dashboard).toContain("openCreditOrderIds");
    expect(dashboard).toContain("setSelectedCreditOrderIds(prev =>");
    expect(dashboard).toContain("setSelectedOrder(freshOrder)");
  });

  it("precarga los contadores del sidebar administrativo desde el montaje inicial", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const initialLoadStart = dashboard.indexOf("if (!authUser?.id) return undefined;");
    const initialLoadEnd = dashboard.indexOf("const relatedDataChannel", initialLoadStart);
    const initialLoadBlock = dashboard.slice(initialLoadStart, initialLoadEnd);

    expect(initialLoadBlock).toContain("loadOrders();");
    expect(initialLoadBlock).toContain("loadProfiles();");
    expect(initialLoadBlock).toContain("fetchClients();");
    expect(initialLoadBlock).toContain("fetchAccountsReceivable();");
    expect(dashboard).toContain("const [clientsLoading, setClientsLoading] = useState(true);");
    expect(dashboard).toContain("const [accountsReceivableLoading, setAccountsReceivableLoading] = useState(true);");
    expect(dashboard).toContain('const getSidebarBadge = (loading, value) => (loading ? "..." : value);');
    expect(dashboard).toContain("badge: getSidebarBadge(loadingOrders, orders.length)");
    expect(dashboard).toContain("badge: getSidebarBadge(accountsReceivableLoading, creditPendingInvoicesCount)");
    expect(dashboard).toContain("badge: getSidebarBadge(clientsLoading, clients.length)");
    expect(dashboard).toContain("badge: getSidebarBadge(loadingUsers, profiles.length)");
  });

  it("cierra facturas individuales, seleccionadas o todas con settle_credit_orders", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain('supabase.rpc("settle_credit_orders"');
    expect(dashboard).toContain("openCreditSettlementModal");
    expect(dashboard).toContain("toggleCreditOrderSelection");
    expect(dashboard).toContain("toggleAllCreditOrdersForClient");
    expect(dashboard).toContain("Marcar saldadas");
    expect(dashboard).toContain("Marcar todas como saldadas");
    expect(dashboard).toContain("Factura marcada como saldada correctamente.");
  });

  it("no introduce montos internos en la mesa de creditos", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");

    expect(dashboard).toContain('activeTab === "credits" ?');
    expect(dashboard).toContain("agrupados por cliente");
    expect(dashboard).not.toMatch(/total adeudado/i);
    expect(dashboard).not.toMatch(/Rango de deuda/i);
    expect(dashboard).not.toMatch(/p_amount/);
  });
});
