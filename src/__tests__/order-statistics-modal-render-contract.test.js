import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const dashboard = fs.readFileSync(
  path.resolve(process.cwd(), "src/pages/dashboard.jsx"),
  "utf8",
);

describe("order statistics modal render contract", () => {
  it("mounts independently from material analytics modals", () => {
    const materialBlockStart = dashboard.indexOf("{(selectedMaterialAnalytics || selectedTerminationAnalytics || showMaterialAnalyticsOverview) && (");
    const orderModalMarker = "{showOrderStatisticsModal && (";
    const orderModalStart = dashboard.indexOf(orderModalMarker);
    expect(materialBlockStart).toBeGreaterThanOrEqual(0);
    expect(dashboard.match(/\{showOrderStatisticsModal && \(/g)).toHaveLength(1);
    expect(orderModalStart).toBeGreaterThan(materialBlockStart);
    const orderModalBlock = dashboard.slice(orderModalStart, dashboard.indexOf("</Suspense>", orderModalStart));
    expect(orderModalBlock).toContain("<Suspense fallback={null}>");
    expect(orderModalBlock).toContain("<OrderStatisticsModal");
    expect(orderModalBlock).toContain("open={showOrderStatisticsModal}");
  });
});
