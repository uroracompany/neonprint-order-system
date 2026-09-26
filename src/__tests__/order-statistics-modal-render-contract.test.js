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
    const materialBlockStart = dashboard.indexOf("{(selectedMaterialAnalytics || showMaterialAnalyticsOverview) && (");
    const orderModalMarker = "{showOrderStatisticsModal && (";
    const orderModalStart = dashboard.indexOf(orderModalMarker);
    const orderModalEnd = dashboard.indexOf("<Modal", orderModalStart);

    expect(materialBlockStart).toBeGreaterThanOrEqual(0);
    expect(dashboard.match(/\{showOrderStatisticsModal && \(/g)).toHaveLength(1);
    expect(orderModalStart).toBeGreaterThan(materialBlockStart);
    expect(orderModalEnd).toBeGreaterThan(orderModalStart);
    expect(dashboard.slice(orderModalStart, orderModalEnd)).toContain("open={showOrderStatisticsModal}");
  });
});
