import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const readSource = (relativePath) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  "utf8",
);

describe("dashboard statistics icon contract", () => {
  it("uses an icon exported by the shared icon map", () => {
    const icons = readSource("src/utils/icons.jsx");
    const dashboard = readSource("src/pages/dashboard.jsx");
    const modal = readSource("src/components/orders/OrderStatisticsModal.jsx");

    expect(icons).toMatch(/\bBarChart:\s*\(/);
    expect(dashboard).toContain("<Icons.BarChart />");
    expect(modal).toContain("<Icons.BarChart />");
    expect(dashboard).not.toContain("<Icons.ChartBar />");
    expect(modal).not.toContain("<Icons.ChartBar />");
  });

  it("uses only icons exported by the shared map in the order statistics modal", () => {
    const icons = readSource("src/utils/icons.jsx");
    const modal = readSource("src/components/orders/OrderStatisticsModal.jsx");
    const iconKeys = new Set(
      [...icons.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*):\s*\(/gm)].map((match) => match[1]),
    );
    const usedIcons = new Set(
      [...modal.matchAll(/Icons\.([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]),
    );

    expect([...usedIcons].filter((icon) => !iconKeys.has(icon))).toEqual([]);
  });
});
