/* global process */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261019120000_order_participation_timeline_access_control.sql"),
  "utf8",
);
const designerPage = readFileSync(resolve(process.cwd(), "src/pages/page-designer.jsx"), "utf8");

describe("Designer participation history access contract", () => {
  it("checks authentication before reading an order and matches its existing visibility boundary", () => {
    expect(migration.indexOf("IF auth.uid() IS NULL")).toBeLessThan(migration.indexOf("FROM public.orders o"));
    expect(migration).toContain("public.current_profile_is_admin()");
    expect(migration).toContain("public.current_profile_is_order_operator()");
    expect(migration).toContain("auth.uid() IN (v_order.created_by, v_order.seller_id, v_order.designer_id, v_order.quote_id, v_order.delivery_id)");
    expect(migration).toContain("public.producer_can_access_order(v_order.id)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_order_participation_timeline(uuid) FROM PUBLIC, anon");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_order_participation_timeline(uuid) TO authenticated");
  });

  it("keeps the RPC payload contract and identifies a designer creator for the modal flow", () => {
    expect(migration).toContain("FUNCTION public.get_order_participation_timeline(p_order_id uuid)");
    expect(migration).toContain("RETURNS jsonb");
    expect(migration).toContain("CASE WHEN v_creator_role = 'designer' THEN 'design' ELSE 'seller' END");
    expect(migration).toContain("CASE WHEN v_creator_role = 'designer' THEN 'Diseñador' ELSE 'Vendedor' END");
    for (const key of ["role", "role_label", "user_name", "user_id", "action", "timestamp", "metadata"]) {
      expect(migration).toContain(`'${key}'`);
    }

    expect(designerPage.match(/useOrderParticipation\(/g)).toHaveLength(1);
    expect(designerPage).toContain("OrderParticipationTimelineContent");
    expect(designerPage).toContain("OrderTrackingLink");
    expect(designerPage).toContain("entry?.action === \"Creó la orden\" && entry.user_id === order.created_by");
    expect(designerPage).toContain("{ ...entry, role: \"design\", role_label: \"Diseñador\" }");
    expect(designerPage).toContain("FLOW_STEPS.filter((step) => step.key !== ORDER_STATUS.PENDING)");
  });
});
