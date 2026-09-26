import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("auditable Semi-Admin order flow", () => {
  const migration = readProjectFile("supabase/migrations/20260905170000_auditable_semi_admin_quote_flow.sql");

  it("suppresses only the generic creation notice for its Semi-Admin actor", () => {
    expect(migration).toContain("p_type in ('new_order', 'order_assigned')");
    expect(migration).toContain("event_kind in ('order_created', 'designer_assigned_confirmation', 'quote_assignment_confirmation')");
    expect(migration).toContain("recipient = caller_id");
    expect(migration).toContain("profile.role = 'semi_admin'");
  });

  it("uses one stored-asset validator for Design and Semi-Admin transitions to Caja", () => {
    expect(migration).toContain("create or replace function public.assert_order_ready_for_quote");
    expect(migration).toContain("Falta una orden de trabajo válida");
    expect(migration).toContain("Falta un archivo de diseño válido");
    expect(migration).toContain("Cada archivo debe tener nombre visible, área, materiales y terminación");
    expect(migration.match(/perform public\.assert_order_ready_for_quote\(p_order_id\);/g)).toHaveLength(2);
  });

  it("keeps Semi-Admin Caja transitions optimistic, responsible, and auditable", () => {
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("semi_admin_can_operate_stage(p_order_id, 'design', null)");
    expect(migration).toContain("Selecciona un responsable activo de Caja.");
    expect(migration).toContain("'semi_admin_send_design_to_quote'");
    expect(migration).toContain("'asset_validation', 'passed'");
  });
});
