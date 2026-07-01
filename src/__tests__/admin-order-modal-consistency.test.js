/* global process */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

const getSourceSlice = (source, startToken, endToken) => {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("admin order modal consistency", () => {
  it("admin and sales detail flows reuse the shared order detail modal", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const seller = readProjectFile("src/pages/pages-seller.jsx");
    const detailModal = readProjectFile("src/components/orders/OrderDetailModal.jsx");

    expect(detailModal).toContain("export default function OrderDetailModal");
    expect(detailModal).toContain("Estado & Pago");
    expect(detailModal).toContain("Información del Sistema");
    expect(detailModal).toContain("Archivos Adjuntos");
    expect(detailModal).toContain("<OrderAssignmentAction");
    expect(seller).toContain('import SharedOrderDetailModal from "../components/orders/OrderDetailModal";');
    expect(seller).toContain("<SharedOrderDetailModal");
    expect(dashboard).toContain('import SharedOrderDetailModal from "../components/orders/OrderDetailModal";');
    expect(dashboard).toContain("<SharedOrderDetailModal");
    expect(dashboard).toContain('primaryActionLabel="Asignar Orden"');

    const activeDetailRender = getSourceSlice(
      dashboard,
      '{activeTab === "credits" ? (',
      "<AssignModal"
    );
    expect(activeDetailRender).not.toContain("<AdminOrderDetailModal");
    expect(activeDetailRender).not.toContain("onEdit={");
    expect(activeDetailRender).not.toContain("onCancel={");
    expect(activeDetailRender).not.toContain("onArchive={");
    expect(activeDetailRender).not.toContain("onDelete={");
  });

  it("admin and sales edit flows reuse the shared edit order modal", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const seller = readProjectFile("src/pages/pages-seller.jsx");
    const editOrderModal = readProjectFile("src/components/orders/EditOrderModal.jsx");

    expect(editOrderModal).toContain("export default function EditOrderModal");
    expect(seller).toContain('import SharedEditOrderModal from "../components/orders/EditOrderModal";');
    expect(seller).toContain("<SharedEditOrderModal");
    expect(seller).not.toContain("export function EditOrderModal");
    expect(dashboard).toContain('import SharedEditOrderModal from "../components/orders/EditOrderModal";');
    expect(dashboard).toContain("<SharedEditOrderModal");
    expect(dashboard).not.toContain("./pages-seller");
    expect(dashboard).not.toContain("SellerEditOrderModal");
    expect(dashboard).not.toContain("<AdminOrderFormModal");
  });

  it("admin and sales order assignment actions use the shared component", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const seller = readProjectFile("src/pages/pages-seller.jsx");
    const action = readProjectFile("src/components/orders/OrderAssignmentAction.jsx");

    expect(action).toContain("export default function OrderAssignmentAction");
    expect(action).toContain("linear-gradient(135deg, #0369A1 0%, #0284C7 100%)");
    expect(action).toContain("linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)");
    expect(dashboard).toContain('import OrderAssignmentAction from "../components/orders/OrderAssignmentAction";');
    expect(seller).toContain('import OrderAssignmentAction from "../components/orders/OrderAssignmentAction";');
  });

  it("admin sidebar can collapse like sales and persists its state", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");

    expect(dashboard).toContain('const ADMIN_SIDEBAR_STORAGE_KEY = "neonprint_admin_sidebar_open";');
    expect(dashboard).toContain("getInitialAdminSidebarOpen");
    expect(dashboard).toContain("window.localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY)");
    expect(dashboard).toContain("window.localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(sidebarOpen))");
    expect(dashboard).toContain("toggleAdminSidebar");
    expect(dashboard).toContain("<Icons.ChevronLeft />");
    expect(dashboard).toContain("<Icons.ChevronRight />");
    expect(adminCss).toContain(".pa-sidebar-toggle");
  });

  it("opens admin order details from free row clicks without hijacking row actions", () => {
    const dashboard = readProjectFile("src/pages/dashboard.jsx");
    const adminCss = readProjectFile("src/css-components/page-admin.css");

    expect(dashboard).toContain("isInteractiveOrderRowTarget");
    expect(dashboard).toContain('target?.closest?.("button, a, input, select, textarea, [data-row-action]")');
    expect(dashboard).toContain("handleOrderRowClick");
    expect(dashboard).toContain("handleOrderRowKeyDown");
    expect(dashboard).toContain('className="row-hover pa-orders-clickable-row"');
    expect(dashboard).toContain("data-row-action");
    expect(dashboard).toContain("setSelectedOrder(order)");
    expect(adminCss).toContain(".pa-orders-clickable-row");
    expect(adminCss).toContain(".pa-orders-clickable-row:focus-visible");
  });
});
