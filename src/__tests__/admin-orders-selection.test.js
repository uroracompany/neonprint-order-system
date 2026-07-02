import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(resolve("src/pages/dashboard.jsx"), "utf8");
const adminStyles = readFileSync(resolve("src/css-components/page-admin.css"), "utf8");

describe("admin orders selection", () => {
  it("removes unsupported row selection and batch actions", () => {
    expect(dashboardSource).not.toContain("Seleccionar órdenes visibles");
    expect(dashboardSource).not.toContain("Seleccionar orden ${order.id");
    expect(dashboardSource).not.toContain("selectedAdminOrderIds");
    expect(dashboardSource).not.toContain("toggleVisibleAdminOrders");
    expect(dashboardSource).not.toContain("toggleAdminOrderSelection");
    expect(dashboardSource).not.toContain("Seleccionar acción");
    expect(dashboardSource).not.toContain("handleBatchActionConfirm");
    expect(dashboardSource).not.toContain("executeAdminOrderBatch");
    expect(dashboardSource).not.toContain("batchActionOpen");
  });

  it("removes styles that only served order selection", () => {
    expect(adminStyles).not.toContain(".pa-order-batch-bar");
    expect(adminStyles).not.toContain(".pa-order-col-select");
  });
});
