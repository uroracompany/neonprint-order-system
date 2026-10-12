import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardPath = resolve(dirname(fileURLToPath(import.meta.url)), "../pages/dashboard.jsx");
const dashboard = readFileSync(dashboardPath, "utf8");

describe("admin employee team entrypoint", () => {
  it("renders the team statistics action in the main employee banner", () => {
    expect(dashboard).toContain('import AdminEmployeeTeamModule from "../components/employees/AdminEmployeeTeamModule";');
    expect(dashboard).toContain('const [employeeTeamView, setEmployeeTeamView] = useState(false);');
    expect(dashboard).toContain("Estadísticas de equipo");
    expect(dashboard).toContain("onClick={openEmployeeTeamView}");
  });

  it("renders the team subview with a return path to the employee list", () => {
    expect(dashboard).toContain("<AdminEmployeeTeamModule onBack={() => setEmployeeTeamView(false)} />");
    expect(dashboard).toContain("activeTab === \"users\" && employeeTeamView");
  });
});
