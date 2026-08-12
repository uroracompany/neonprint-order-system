import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(path), "utf8");

describe("Admin overview summary contract", () => {
  it("keeps the original banner and a concise operational summary", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");
    const sidebar = readProjectFile("src/components/Sidebar.jsx");

    expect(dashboard).toContain('className="pa-section-heading acm-heading"');
    expect(dashboard).toContain("Resumen del estado actual de tu negocio.");
    expect(dashboard).toContain('className="pa-overview-banner-badges"');
    expect(dashboard).toContain('data-tone="orders"');
    expect(dashboard).toContain('data-tone="completed"');
    expect(dashboard).toContain('data-tone="clients"');
    expect(dashboard).toContain('data-tone="employees"');
    expect(dashboard).toContain("</strong> órdenes");
    expect(dashboard).toContain("</strong> completadas");
    expect(dashboard).toContain("</strong> clientes");
    expect(dashboard).toContain("</strong> empleados");
    expect(dashboard).not.toContain('className="pa-overview-banner"');
    expect(dashboard).not.toContain("overviewAdminAvatarUrl");
    expect(dashboard).not.toContain("overviewBannerMetrics");
    expect(dashboard).toContain('className="pa-overview-quick-actions"');
    expect(dashboard).toContain("formatOverviewDeliveryDate");
    expect(dashboard).toContain("const overviewRecentOrders = orders.slice(0, 3);");
    expect(dashboard).toContain("Órdenes 911 activas");
    expect(dashboard).toContain('Atención requerida');
    expect(dashboard).not.toContain("<AdminOverviewCarousel");
    expect(dashboard).toContain("<h2>Actividad reciente</h2>");
    expect(dashboard).not.toContain("<h2>Carga activa</h2>");
    expect(dashboard).not.toContain("<h2>Estado del sistema</h2>");

    const overviewStart = dashboard.indexOf('{activeTab === "overview"');
    const overviewEnd = dashboard.indexOf('{activeTab === "orders"');
    const overviewSection = dashboard.slice(overviewStart, overviewEnd);

    expect(overviewSection).toContain(">Cliente</span>");
    expect(overviewSection).toContain(">Vendedor</span>");
    expect(overviewSection).toContain("Fecha de entrega");
    expect(overviewSection).toContain("Estado de pago");
    expect(overviewSection).toContain("PaymentBadge status={order.payment_status}");
    expect(overviewSection).toContain('"Indefinida"');
    expect(overviewSection).not.toContain("#{order.id?.slice(0, 8)");
    expect(overviewSection).toContain('className="pa-overview-client-avatar"');
    expect(overviewSection).toContain('className="pa-overview-client-name"');

    expect(adminCss).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(adminCss).toContain(".pa-overview-banner-badges");
    expect(adminCss).toContain('.pa-overview-banner-badge[data-tone="orders"]');
    expect(adminCss).toContain('.pa-overview-banner-badge[data-tone="completed"]');
    expect(adminCss).toContain('.pa-overview-banner-badge[data-tone="clients"]');
    expect(adminCss).toContain('.pa-overview-banner-badge[data-tone="employees"]');
    expect(adminCss).toContain(".pa-overview-quick-actions svg");
    expect(adminCss).toContain("color: #091127;");
    expect(adminCss).toContain("font-weight: 600;");
    expect(adminCss).toContain("background: #091127;");
    expect(adminCss).toContain("color: #ffffff;");
    expect(adminCss).toContain(".pa-overview-delivery-badge");
    expect(adminCss).toContain(".pa-overview-flow-step-header");
    expect(adminCss).toContain(".pa-overview-client-avatar");
    expect(adminCss).toContain("background: #091127;");
    expect(adminCss).toContain('.pa-overview-attention-summary[data-tone="priority"]');
    expect(adminCss).toContain('.pa-overview-attention-summary[data-tone="credit"]::before');
    expect(adminCss).toContain('.pa-overview-attention-summary[data-tone="credit"] strong');

    expect(sidebar).not.toContain("pa-overview-");
  });
});
