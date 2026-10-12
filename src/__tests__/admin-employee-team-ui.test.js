import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(resolve(globalThis.process.cwd(), path), "utf8");

describe("Admin employee team UI adjustments", () => {
  it("removes only the period selector from the team statistics banner", () => {
    const source = read("src/components/employees/AdminEmployeeTeamModule.jsx");

    expect(source).not.toContain('id="aet-period-select"');
    expect(source).not.toContain('className="aet-period"');
    expect(source).toContain("className=\"aet-custom-dates\"");
    expect(source).toContain('type="date"');
  });

  it("keeps the requested typography and sidebar-colored focus states localized to filters", () => {
    const styles = read("src/components/employees/AdminEmployeeModule.css");

    expect(styles).toMatch(/\.aet-kicker\s*\{[^}]*color:\s*#1E40AF;[^}]*\}/);
    expect(styles).toMatch(/\.aet-header h2\s*\{[^}]*color:\s*#000000;[^}]*font-weight:\s*700;/);
    expect(styles).toMatch(/\.aet-header p\s*\{[^}]*color:\s*#1E40AF;[^}]*font-weight:\s*600;/);
    expect(styles).toMatch(/\.aet-tabs button:focus-visible, \.aet-area-tabs button:focus-visible\s*\{[^}]*background:\s*var\(--primary\);[^}]*color:\s*#ffffff;/);
    expect(styles).toMatch(/\.aet-tabs button:focus-visible svg, \.aet-area-tabs button:focus-visible svg\s*\{[^}]*color:\s*#ffffff;/);
    expect(styles).not.toMatch(/\.pa-btn[^}]*\.aet-tabs/);
  });
});
