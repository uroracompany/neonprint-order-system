import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => readFileSync(resolve(testDirectory, relativePath), "utf8");

describe("employee team performance routing", () => {
  it("registers the action in both local Vite and production admin maps", () => {
    const viteConfig = read("../../vite.config.js");
    const adminApi = read("../../api/admin.js");

    expect(viteConfig).toContain("handleAdminEmployeeTeamPerformance");
    expect(viteConfig).toContain('"employee-team-performance": handleAdminEmployeeTeamPerformance');
    expect(adminApi).toContain('"employee-team-performance": handleAdminEmployeeTeamPerformance');
  });

  it("uses the primary dark-blue action style in the employee banner", () => {
    const dashboard = read("../pages/dashboard.jsx");

    expect(dashboard).toContain('<button className="pa-btn primary" type="button" onClick={openEmployeeTeamView}>');
    expect(dashboard).toContain("Estadísticas de equipo");
  });
});
