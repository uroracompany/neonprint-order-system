/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260828160000_admin_advanced_action_policy.sql"),
  "utf8",
);

describe("admin advanced action policy contract", () => {
  it("makes the SQL policy the catalogue source for terminal and blocked orders", () => {
    expect(migration).toContain("create or replace function public.admin_order_action_policy(p_order_id uuid)");
    expect(migration).toContain("if v_order.operational_status = 'blocked'");
    expect(migration).toContain("'resume_order'");
    expect(migration).toContain("'update_block'");
    expect(migration).toContain("if v_order.status = 'cancelled'");
    expect(migration).toContain("'reopen_cancelled'");
    expect(migration).toContain("if v_order.status = 'in_Delivered'");
    expect(migration).toContain("'return_to_completed'");
    expect(migration).toContain("'unavailable_actions'");
    expect(migration).toContain("select public.admin_order_action_policy(p_order_id)");
  });

  it("limits commercial actions to Caja and validates the same policy before commands", () => {
    expect(migration).toContain("v_order.status = 'in_Quote' and v_order.commercial_review_required");
    expect(migration).toContain("'register_payment'");
    expect(migration).toContain("'commercial_review'");
    expect(migration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, p_action)");
    expect(migration).toContain("if p_expected_updated_at is null then raise exception 'ORDER_STALE'");
  });

  it("keeps production-area reassignment individual, versioned and auditable", () => {
    expect(migration).toContain("p_reason_category text, p_reason_detail text");
    expect(migration).toContain("'reassign_production_file_area'");
    expect(migration).toContain("if v_old_file.status = 'completed'");
    expect(migration).toContain("Selecciona un responsable activo del área de Producción.");
    expect(migration).toContain("El área y responsable no han cambiado.");
    expect(migration).toContain("'production_file_assignment'");
    expect(migration).toContain("public.admin_reassign_file_production_area_legacy(");
    expect(migration).toContain("Cambio de área solicitado por una versión compatible");
  });
});
