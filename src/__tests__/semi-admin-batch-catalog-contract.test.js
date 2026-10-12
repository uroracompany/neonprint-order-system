import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260929172306_semi_admin_design_quote_row_action.sql",
  "utf8",
);
const readinessMigration = readFileSync(
  "supabase/migrations/20261003103938_semi_admin_quote_catalog_asset_readiness.sql",
  "utf8",
);

describe("Semi-Admin batch row catalog RPC boundary", () => {
  it("requires an active actor and bounds/deduplicates participant order IDs", () => {
    expect(migration).toContain("public.require_active_semi_admin_actor()");
    expect(migration).toContain("cardinality(p_order_ids) > 100");
    expect(migration).toContain("requested.id is null");
    expect(migration).toContain("select distinct requested.id");
    expect(migration).toContain("candidate.created_by, candidate.seller_id, candidate.designer_id");
    expect(migration).toContain("candidate.quote_id, candidate.delivery_id");
  });

  it("returns only effective action projection and restricts direct RPC access", () => {
    expect(migration).toContain("public.semi_admin_get_order_command_catalog(v_order.id)");
    expect(migration).toContain("'order_id', v_order.id");
    expect(migration).toContain("'order_updated_at', v_order.updated_at");
    expect(migration).toContain("'key', action.value->'key'");
    expect(migration).toContain("'title', action.value->'title'");
    expect(migration).not.toMatch(/'context'|'events'|'candidates'|'history'|'changes'|'files'/);
    expect(migration).not.toContain("unavailable_actions");
    expect(migration).toContain("revoke all on function public.semi_admin_get_orders_command_catalog(uuid[]) from public, anon;");
    expect(migration).toContain("grant execute on function public.semi_admin_get_orders_command_catalog(uuid[]) to authenticated;");
  });

  it("preserves Pending actions and exposes Design to Caja only for the assigned internal designer", () => {
    expect(migration).toContain("v_order.status in ('Pending', 'pending')");
    expect(migration).toMatch(/v_order\.order_design_type = 'INTERNAL_DESING'[\s\S]*?action\.value->>'key' = 'send_to_designer'/);
    expect(migration).toMatch(/v_order\.order_design_type = 'EXTERNAL_DESING'[\s\S]*?action\.value->>'key' = 'send_to_quote'/);
    expect(migration).toContain("v_order.status in ('in_Design', 'In_Design')");
    expect(migration).toContain("v_order.designer_id = v_actor");
    expect(migration).toContain("action.value->>'key' = 'send_design_to_quote'");
    expect(migration).toContain("not coalesce(v_order.is_archived, false)");
    expect(migration).toContain("v_order.operational_status is distinct from 'blocked'");
    expect(migration).not.toContain("'route_production'");
  });

  it("keeps the underlying Design-to-Caja mutation internal-only and rejects admin-archived orders", () => {
    expect(migration).toContain("create or replace function public.semi_admin_send_design_to_quote(");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("v_order.order_design_type is distinct from 'INTERNAL_DESING'");
    expect(migration).toContain("coalesce(v_order.is_archived_admin, false)");
    expect(migration).toContain("coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked'");
    expect(migration).toContain("where id = p_order_id\n  for update;");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("public.semi_admin_can_operate_stage(p_order_id, 'design', null)");
    expect(migration).toContain("public.assert_order_ready_for_quote(p_order_id)");
    expect(migration).toContain("insert into public.order_events");
    expect(migration).toContain("revoke all on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)\n  from public, anon, authenticated;");
  });

  it("hides Design-to-Caja until the canonical persisted-asset validator succeeds", () => {
    expect(readinessMigration).toContain("perform public.assert_order_ready_for_quote(p_order_id);");
    expect(readinessMigration).toContain("exception when others then");
    expect(readinessMigration).toContain("return false;");
    expect(readinessMigration).toContain("private.semi_admin_order_ready_for_quote_catalog(p_order_id)");
    expect(readinessMigration).toContain("where action.value->>'key' <> 'send_design_to_quote';");
    expect(readinessMigration).toContain("revoke all on function private.semi_admin_order_ready_for_quote_catalog(uuid)");
    expect(readinessMigration).toContain("grant execute on function public.semi_admin_get_order_command_catalog(uuid) to authenticated;");
    expect(readinessMigration).not.toContain("create or replace function public.semi_admin_send_design_to_quote(");
    expect(readinessMigration).not.toContain("send_to_designer'");
    expect(readinessMigration).not.toContain("send_to_quote'");
  });
});
