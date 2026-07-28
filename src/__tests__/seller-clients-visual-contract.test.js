import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sellerCss = readFileSync(
  resolve("src/css-components/page-seller.css"),
  "utf8",
);

const sellerPage = readFileSync(
  resolve("src/pages/pages-seller.jsx"),
  "utf8",
);

const sellerProfileModule = readFileSync(
  resolve("src/components/seller/SellerProfileModule.jsx"),
  "utf8",
);

const orderDetailModal = readFileSync(
  resolve("src/components/orders/OrderDetailModal.jsx"),
  "utf8",
);

const viteConfig = readFileSync(
  resolve("vite.config.js"),
  "utf8",
);

const getCssBlock = (css, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return match?.[1] || "";
};

const getSourceSlice = (source, startToken, endToken) => {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("Seller visual contract with Admin clients", () => {
  it("defines the client-management border, radius, and elevation tokens", () => {
    expect(sellerCss).toContain("--seller-client-border: #dbe3ef;");
    expect(sellerCss).toContain("--seller-client-radius: 14px;");
    expect(sellerCss).toContain("--seller-client-shadow: 0 10px 28px rgba(15, 30, 64, .055);");
    expect(sellerCss).toContain("--seller-client-shadow-hover: 0 12px 30px rgba(15, 30, 64, .07);");
  });

  it("matches client-management containers across heading, cards, filters, and panels", () => {
    const greeting = getCssBlock(sellerCss, ".ps-greeting");
    const card = getCssBlock(sellerCss, ".ps-card");
    const panel = getCssBlock(sellerCss, ".ps-panel");
    const filters = getCssBlock(sellerCss, ".ps-filters");
    const orderCard = getCssBlock(sellerCss, ".ps-order-card");

    expect(greeting).toContain("border: 1px solid var(--seller-client-border);");
    expect(greeting).toContain("border-left: 3px solid #091127;");
    expect(greeting).toContain("border-radius: var(--seller-client-radius);");
    expect(greeting).toContain("background: #ffffff;");
    expect(greeting).toContain("box-shadow: var(--seller-client-shadow);");

    for (const block of [card, panel, filters, orderCard]) {
      expect(block).toContain("border: 1px solid var(--seller-client-border);");
      expect(block).toContain("border-radius: var(--seller-client-radius);");
      expect(block).toContain("box-shadow: var(--seller-client-shadow);");
    }

    expect(getCssBlock(sellerCss, ".ps-panel-stripe")).toContain("display: none;");
    expect(sellerPage).not.toContain("onMouseEnter={e => e.currentTarget.style.borderColor");
  });

  it("renders the seller banner as a professional action header", () => {
    const greeting = getCssBlock(sellerCss, ".ps-greeting");
    const greetingCount = getCssBlock(sellerCss, ".ps-greeting-count");
    const primaryAction = getCssBlock(sellerCss, ".ps-greeting-btn.primary");
    const secondaryAction = getCssBlock(sellerCss, ".ps-greeting-btn.secondary");

    expect(sellerPage).not.toContain("Buen dia");
    expect(sellerPage).not.toContain("👋");
    expect(sellerPage).toContain("Bienvenido,");
    expect(sellerPage).toContain("Crear Órdenes");
    expect(sellerPage).toContain("Crear Usuarios");
    expect(sellerPage).toContain("activeOrdersCount");
    expect(sellerPage).toContain("Órdenes activas");

    expect(greeting).toContain("display: flex;");
    expect(greeting).toContain("justify-content: space-between;");
    expect(greetingCount).toContain("border: 1px solid #dbe3ef;");
    expect(greetingCount).toContain("border-radius: 20px;");
    expect(greetingCount).toContain("background: #f8fafc;");
    expect(primaryAction).toContain("background: var(--primary);");
    expect(primaryAction).toContain("box-shadow: 0 4px 14px var(--primary-glow);");
    expect(secondaryAction).toContain("border: 1.5px solid var(--border);");
    expect(secondaryAction).toContain("background: var(--surface-alt);");
  });

  it("aligns seller filters and tables with the client-management surface states", () => {
    const input = getCssBlock(sellerCss, ".ps-input");
    const inputFocus = getCssBlock(sellerCss, ".ps-input:focus");
    const filtersCount = getCssBlock(sellerCss, ".ps-filters-count");

    expect(input).toContain("height: 40px;");
    expect(input).toContain("border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);");
    expect(input).toContain("border-radius: 10px;");
    expect(input).toContain("background: var(--surface-alt);");
    expect(input).toContain("font: 600 12px/1 'Poppins', sans-serif;");
    expect(inputFocus).toContain("border-color: var(--primary-mid);");
    expect(inputFocus).toContain("box-shadow: 0 0 0 3px var(--primary-glow);");

    expect(sellerCss).toContain(".ps-table thead tr { background: color-mix(in srgb, var(--surface-alt) 94%, white); }");
    expect(sellerCss).toContain(".ps-table tr.row-hover:hover td { background: rgba(219, 227, 239, 0.12); }");
    expect(filtersCount).toContain("color: #1d4ed8;");
    expect(filtersCount).toContain("font-weight: 600;");
  });

  it("uses the client-management action colors for table and card order actions", () => {
    expect(sellerCss).toContain(".table-action-btn.view {\n  color: #1d4ed8;\n  border-color: #bfdbfe;\n  background: #eff6ff;");
    expect(sellerCss).toContain(".table-action-btn.edit {\n  color: #d97706;\n  border-color: #fde68a;\n  background: #fffbeb;");
    expect(sellerCss).toContain(".table-action-btn.cancel {\n  color: #dc2626;\n  border-color: #fecaca;\n  background: #fef2f2;");

    expect(sellerCss).toContain(".card-action-btn.view {\n  color: #1d4ed8;\n  border-color: #bfdbfe;\n  background: #eff6ff;");
    expect(sellerCss).toContain(".card-action-btn.edit {\n  color: #d97706;\n  border-color: #fde68a;\n  background: #fffbeb;");
    expect(sellerCss).toContain(".card-action-btn.cancel {\n  color: #dc2626;\n  border-color: #fecaca;\n  background: #fef2f2;");
  });

  it("uses the order-management avatar pattern for seller client rows and cards", () => {
    const avatar = getCssBlock(sellerCss, ".ps-root .acm-avatar");
    const avatarSmall = getCssBlock(sellerCss, ".ps-root .acm-avatar-small");
    const clientCell = getCssBlock(sellerCss, ".ps-client-cell");
    const clientCellMain = getCssBlock(sellerCss, ".ps-client-cell-main");
    const avatarUsages = sellerPage.match(/className="acm-avatar acm-avatar-small"/g) || [];

    expect(avatar).toContain("display: inline-grid;");
    expect(avatar).toContain("border-radius: 50%;");
    expect(avatar).toContain("background: var(--primary);");
    expect(avatar).toContain("border: 2px solid var(--green);");
    expect(avatar).toContain("letter-spacing: -.03em;");
    expect(avatarSmall).toContain("width: 34px;");
    expect(avatarSmall).toContain("height: 34px;");
    expect(avatarSmall).toContain("font-size: 11px;");
    expect(clientCell).toContain("display: flex;");
    expect(clientCell).toContain("gap: 10px;");
    expect(clientCellMain).toContain("flex-direction: column;");
    expect(sellerPage).toContain("const getInitials = (name)");
    expect(sellerPage).toContain("{getInitials(o.client_name)}");
    expect(avatarUsages.length).toBeGreaterThanOrEqual(3);
  });

  it("opens seller order details from rows while keeping row actions isolated", () => {
    const rowFocus = getCssBlock(sellerCss, ".ps-table tr.ps-order-row:focus-visible");

    expect(sellerPage).toContain("const isInteractiveOrderRowTarget = (target) => Boolean(");
    expect(sellerPage).toContain('target?.closest?.("button, a, input, select, textarea, [data-row-action]")');
    expect(sellerPage).toContain("const handleSellerOrderRowClick = useCallback((event, order) => {");
    expect(sellerPage).toContain("const handleSellerOrderRowKeyDown = useCallback((event, order) => {");
    expect(sellerPage).toContain('if (!["Enter", " "].includes(event.key)) return;');
    expect(sellerPage).toContain("handleViewOrder(order);");
    expect(sellerPage).toContain('className="row-hover ps-order-row"');
    expect(sellerPage).toContain("tabIndex={0}");
    expect(sellerPage).toContain("onClick={(event) => handleSellerOrderRowClick(event, o)}");
    expect(sellerPage).toContain("onKeyDown={(event) => handleSellerOrderRowKeyDown(event, o)}");
    expect(sellerPage).toContain("data-row-action");
    expect(rowFocus).toContain("outline: 2px solid var(--cyan);");
    expect(rowFocus).toContain("background: rgba(6, 182, 212, 0.08);");
  });

  it("routes sensitive seller order actions through the authenticated server handler", () => {
    expect(sellerPage).toContain('adminApiFetch("/api/seller-orders"');
    expect(sellerPage).toContain('runSellerOrderAction("detail"');
    expect(sellerPage).toContain('runSellerOrderAction("cancel"');
    expect(sellerPage).toContain('runSellerOrderAction("send_to_designer"');
    expect(sellerPage).toContain('runSellerOrderAction("send_to_quote"');
    expect(sellerPage).toContain('runSellerOrderAction("archive"');
    expect(sellerPage).not.toContain("isDateFilterActive ? true");
    expect(sellerPage).toContain("const archiveMatch = filterArchive === \"active\" ? !o.is_archived : o.is_archived === true;");
    expect(sellerPage).toContain("const statusMatch = filterStatus === \"all\" || isOrderStatus(o.status, filterStatus);");
    expect(sellerPage).toContain("const paymentMatch = filterPayment === \"all\" || o.payment_status === filterPayment;");
    expect(sellerPage).toContain("SELLER_ORDERS_FETCH_LIMIT = 1000");
    expect(viteConfig).toContain("import { handleSellerOrderAction } from './server/seller-order-actions-handler.js'");
    expect(viteConfig).toContain('createApiHandler("/api/seller-orders", handleSellerOrderAction)');
  });

  it("keeps seller order tables compact while preserving full details in the modal", () => {
    const dashboardRecentTable = getSourceSlice(
      sellerPage,
      '<thead><tr>{["Cliente", "Facturación", "Estado", ""].map',
      '{activeTab === "orders" && ('
    );
    const ordersTable = getSourceSlice(
      sellerPage,
      '<thead><tr>{["Cliente", "Facturación", "Estado", "Pago", "Tipo", "Fecha", ""].map',
      '<Pagination currentPage={safePage}'
    );

    expect(dashboardRecentTable).not.toContain('"Descripcion"');
    expect(dashboardRecentTable).not.toContain('"Material"');
    expect(dashboardRecentTable).not.toContain("td-desc");
    expect(dashboardRecentTable).not.toContain("td-mat");
    expect(dashboardRecentTable).toContain("td-invoice");
    expect(dashboardRecentTable).toContain("o.invoice_number");
    expect(dashboardRecentTable).toContain("colSpan={4}");

    expect(ordersTable).not.toContain('"Descripcion"');
    expect(ordersTable).not.toContain('"Material"');
    expect(ordersTable).not.toContain('"ID"');
    expect(ordersTable).not.toContain("td-desc");
    expect(ordersTable).not.toContain("td-mat");
    expect(ordersTable).not.toContain("td-id");
    expect(ordersTable).toContain("td-invoice");
    expect(ordersTable).toContain("o.invoice_number");
    expect(ordersTable).toContain("colSpan={7}");

    expect(orderDetailModal).toContain("{order.description}");
    expect(orderDetailModal).toContain('{ label: "Material", value: order.material');
  });

  it("adds a private seller profile tab and visual profile module", () => {
    const profileSurfaces = getSourceSlice(
      sellerCss,
      ".ps-profile-hero,",
      ".ps-profile-hero {"
    );
    const rankingPanel = getCssBlock(sellerCss, ".ps-profile-ranking-panel");
    const avatarLarge = getCssBlock(sellerCss, ".ps-root .acm-avatar-large");
    const activeStatus = getCssBlock(sellerCss, ".ps-root .acm-profile-status.active");

    expect(sellerPage).toContain('import SellerProfileModule from "../components/seller/SellerProfileModule";');
    expect(sellerPage).toContain('{ id: "profile", label: "Mi Perfil", icon: <Icons.User /> }');
    expect(sellerPage).toContain('profile: "Mi Perfil"');
    expect(sellerPage).toContain('activeTab === "profile"');
    expect(sellerPage).toContain('<SellerProfileModule authUser={authUser} fallbackProfile={authProfile} />');

    expect(sellerProfileModule).toContain('adminApiFetch("/api/seller-profile", {})');
    expect(viteConfig).toContain("import { handleSellerProfile } from './server/seller-profile-handler.js'");
    expect(viteConfig).toContain('createApiHandler("/api/seller-profile", handleSellerProfile)');
    expect(sellerProfileModule).toContain("Ranking privado");
    expect(sellerProfileModule).toContain("Tu posicion actual");
    expect(sellerProfileModule).toContain("`#${ranking.position}`");
    expect(sellerProfileModule).not.toContain("TOP #");
    expect(sellerProfileModule).toContain("Ordenes completadas");
    expect(sellerProfileModule).toContain("Tasa de finalizacion");
    expect(sellerProfileModule).toContain("Analiticas personales");
    expect(sellerProfileModule).toContain("Dashboard de rendimiento");
    expect(sellerProfileModule).toContain("Normales vs 911");
    expect(sellerProfileModule).toContain("Disenador mas asignado");
    expect(sellerProfileModule).toContain("Mas utilizados");
    expect(sellerProfileModule).toContain("Mas frecuentes");
    expect(sellerProfileModule).not.toContain("Ventas realizadas");
    expect(sellerProfileModule).not.toContain("RD$");
    expect(sellerProfileModule).not.toContain("formatMoney");
    expect(sellerProfileModule).not.toContain("sales_total");
    expect(sellerProfileModule).toContain("Objetivos");
    expect(sellerProfileModule).not.toContain("topSellers");
    expect(sellerProfileModule).not.toContain("leader.name");
    expect(sellerProfileModule).not.toContain("seller.name");

    expect(profileSurfaces).toContain(".ps-profile-ranking-panel");
    expect(profileSurfaces).toContain(".ps-profile-goals-panel");
    expect(profileSurfaces).toContain(".ps-profile-metric-card");
    expect(profileSurfaces).toContain(".ps-profile-analytics-card");
    expect(profileSurfaces).toContain("border: 1px solid var(--seller-client-border);");
    expect(profileSurfaces).toContain("border-radius: var(--seller-client-radius);");
    expect(profileSurfaces).toContain("box-shadow: var(--seller-client-shadow);");
    expect(rankingPanel).toContain("display: grid;");
    expect(sellerCss).toContain(".ps-profile-metric-card {\n  display: flex;");
    expect(avatarLarge).toContain("width: 88px;");
    expect(avatarLarge).toContain("height: 88px;");
    expect(avatarLarge).toContain("border: 3px solid var(--green);");
    expect(activeStatus).toContain("border-color: #bbf7d0;");
    expect(activeStatus).toContain("background: #f0fdf4;");
  });

  it("adds private personal analytics to seller profile with Recharts and trend controls", () => {
    const analyticsCard = getCssBlock(sellerCss, ".ps-profile-analytics-card");
    const fullAnalyticsCard = getCssBlock(sellerCss, ".ps-profile-analytics-card.full");
    const donutCenter = getCssBlock(sellerCss, ".ps-profile-donut-center");
    const trendTabs = getCssBlock(sellerCss, ".ps-profile-trend-tabs");
    const statusGrid = getCssBlock(sellerCss, ".ps-profile-status-grid");
    const trendCard = getSourceSlice(
      sellerProfileModule,
      '<article className="ps-profile-analytics-card wide">',
      '<article className="ps-profile-analytics-card ps-profile-designer-card">'
    );
    const statusCard = getSourceSlice(
      sellerProfileModule,
      '<article className="ps-profile-analytics-card full ps-profile-status-summary-card">',
      '</section>'
    );

    expect(sellerProfileModule).toContain('} from "recharts";');
    expect(sellerProfileModule).toContain("ResponsiveContainer");
    expect(sellerProfileModule).toContain("PieChart");
    expect(sellerProfileModule).toContain("LineChart");
    expect(sellerProfileModule).toContain("BarChart");
    expect(sellerProfileModule).toContain('key: "dia", label: "Dia"');
    expect(sellerProfileModule).toContain('key: "30d", label: "30 dias"');
    expect(sellerProfileModule).toContain('key: "3m", label: "3 meses"');
    expect(sellerProfileModule).toContain('key: "mensual", label: "Mensual"');
    expect(sellerProfileModule).toContain("analytics.order_types");
    expect(sellerProfileModule).toContain("analytics.top_materials");
    expect(sellerProfileModule).toContain("analytics.top_clients");
    expect(sellerProfileModule).toContain("status_summary");
    expect(sellerProfileModule).toContain("const dominantOrderType = getDominantOrderType(orderTypeRows);");
    expect(sellerProfileModule).toContain('className="ps-profile-donut-center"');
    expect(sellerProfileModule).toContain("formatPercentage(dominantOrderType.percentage)");
    expect(sellerProfileModule).toContain("{dominantOrderType.name}");
    expect(sellerProfileModule).toContain('className="ps-profile-analytics-card full ps-profile-status-summary-card"');
    expect(trendCard).toContain("Registros de ordenes");
    expect(trendCard).not.toContain("Resumen de ordenes");
    expect(statusCard).toContain("Resumen de ordenes");
    expect(statusCard).not.toContain("Registros de ordenes");
    expect(sellerProfileModule).not.toContain("Ventas realizadas");
    expect(sellerProfileModule).not.toContain("RD$");
    expect(sellerProfileModule).not.toContain("sales_total");

    expect(analyticsCard).toContain("border: 1px solid var(--seller-client-border);");
    expect(analyticsCard).toContain("border-radius: var(--seller-client-radius);");
    expect(analyticsCard).toContain("box-shadow: var(--seller-client-shadow);");
    expect(fullAnalyticsCard).toContain("grid-column: 1 / -1;");
    expect(fullAnalyticsCard).toContain("width: 100%;");
    expect(donutCenter).toContain("position: absolute;");
    expect(donutCenter).toContain("transform: translate(-50%, -50%);");
    expect(donutCenter).toContain("text-align: center;");
    expect(trendTabs).toContain("border: 1px solid var(--seller-client-border);");
    expect(trendTabs).toContain("border-radius: 11px;");
    expect(statusGrid).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
  });
});
