import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260929155017_semiadmin_owned_pending_row_actions.sql",
  "utf8",
);

describe("Semi-Admin owned internal Pending assignment authorization", () => {
  it("projects the designer assignment for an internal Pending order owned by the actor or assigned to them", () => {
    expect(migration).toContain("v_order.order_design_type = 'INTERNAL_DESING'");
    expect(migration).toContain("action.value->>'key' = 'send_to_designer'");
    expect(migration).toContain("v_order.seller_id = v_actor or v_order.created_by = v_actor or v_order.designer_id = v_actor");
    expect(migration).toContain("v_order.status in ('Pending', 'pending')");
    expect(migration).toMatch(/where not coalesce\(\(v_catalog->>'locked'\)::boolean, false\)\s+and not coalesce\(v_order\.is_archived_admin, false\)/);
  });

  it("guards direct transition calls by internal design, owner/creator or assigned Semi-Admin designer, and preserves safety controls", () => {
    expect(migration).toContain("v_old.order_design_type is distinct from 'INTERNAL_DESING'");
    expect(migration).toContain("v_actor is distinct from v_old.seller_id");
    expect(migration).toContain("v_actor is distinct from v_old.created_by");
    expect(migration).toContain("v_actor is distinct from v_old.designer_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_old.updated_at is distinct from p_expected_updated_at");
    expect(migration).toMatch(/if coalesce\(v_old\.is_archived, false\)\s+or coalesce\(v_old\.is_archived_admin, false\)\s+or v_old\.operational_status = 'blocked' then/);
    expect(migration).toContain("'semi_admin_' || p_action");
    expect(migration).toContain("revoke all on function public.semi_admin_transition_order(uuid, text, uuid, text, timestamptz)");
    expect(migration).not.toContain("grant execute on function public.semi_admin_transition_order");
  });

  it("does not change external assignment eligibility or grants for the batch catalog", () => {
    expect(migration).toContain("v_order.order_design_type = 'EXTERNAL_DESING'");
    expect(migration).toContain("and (v_order.seller_id = v_actor or v_order.created_by = v_actor)");
    expect(migration).toContain("public.semi_admin_is_order_routing_responsible(p_order_id, v_actor)");
    expect(migration).toContain("revoke all on function public.semi_admin_get_orders_command_catalog(uuid[]) from public, anon;");
    expect(migration).toContain("grant execute on function public.semi_admin_get_orders_command_catalog(uuid[]) to authenticated;");
  });
});
