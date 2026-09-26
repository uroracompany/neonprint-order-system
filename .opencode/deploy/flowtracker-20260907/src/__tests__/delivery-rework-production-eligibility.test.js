import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve("supabase/migrations/20260830182909_allow_delivery_rework_production_eligibility.sql"), "utf8");

describe("Delivery rework production eligibility", () => {
  it("retains readiness and payment checks while allowing only the authorized completed rework transition", () => {
    expect(migration).toContain("old.status not in ('in_Quote', 'in_Termination')");
    expect(migration).toContain("old.status = 'in_Completed'");
    expect(migration).toContain("current_setting('app.neonprint_order_command', true) = 'delivery_rework'");
    expect(migration).toContain("Produccion requiere pago pagado, parcial o aprobado a credito.");
    expect(migration).toContain("La orden requiere imagen de trabajo y todos sus archivos clasificados antes de Produccion.");
  });
});
