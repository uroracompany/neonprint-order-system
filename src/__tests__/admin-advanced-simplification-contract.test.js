/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const migration = read("supabase/migrations/20260831100000_simplify_admin_advanced_settings.sql");
const actionModal = read("src/components/orders/AdminAdvancedActionModal.jsx");
const presentation = read("src/utils/adminActionPresentation.js");

describe("admin advanced-settings simplification contract", () => {
  it("publishes only the contextual commercial actions for Sales, Design and Caja", () => {
    expect(migration).toContain("if v_order.status = 'Pending' then");
    expect(migration).toContain("elsif v_order.status = 'in_Design' and v_order.order_design_type = 'INTERNAL_DESING'");
    expect(migration).toContain("elsif v_order.status = 'in_Quote' then");
    expect(migration).toContain("case when v_order.seller_id is null then 'Asignar vendedor' else 'Cambiar vendedor' end");
    expect(migration).toContain("case when v_order.order_design_type = 'INTERNAL_DESING' then 'return_to_design' else 'route_sales' end");
    expect(migration).toContain("where item->>'key' not in ('assign_seller', 'set_designer_assignee', 'manage_files', 'set_priority', 'cancel_order')");
  });

  it("limits design assets to external Sales and internal Design in both catalogue and RPC guards", () => {
    expect(migration).toContain("v_order.order_design_type = 'INTERNAL_DESING'");
    expect(migration).toContain("'capabilities', jsonb_build_array('manage_design_assets')");
    expect(migration).not.toContain("'manage_production_files'" );
    expect(migration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, p_action);");
    expect(migration).toContain("'key', 'manage_files', 'label', 'Gestionar archivos'");
  });

  it("keeps seller ownership null for Administration and permits only the current admin as a design exception", () => {
    expect(migration).toContain("if p_action = 'assign_seller' and v_target_user_id = v_actor then");
    expect(migration).toContain("v_target_user_id := null;");
    expect(migration).toContain("if v_target_user_id <> v_actor and not exists");
    expect(actionModal).toContain('"Administración (yo)"');
    expect(actionModal).toContain('profile.role === "admin"');
    expect(actionModal).not.toContain('actionKey === "route_sales" && !targetUserId');
    expect(presentation).toContain('seller: { label: "Vendedor responsable", users: "seller", optional: true');
    expect(presentation).toContain('designer: { label: "Diseñador responsable", users: "designer", optional: false }');
  });

  it("includes seller ownership in human-readable audit data and limits payment notices to Caja and seller", () => {
    expect(migration).toContain("'field', 'seller_id', 'label', 'Vendedor responsable'");
    expect(migration).toContain("when p_field = 'seller_id' then coalesce(public.admin_order_profile_name(p_order.seller_id), 'Administración')");
    expect(migration).toContain("where p_action = 'register_payment' and p_new.quote_id is not null");
    expect(migration).toContain("where p_action = 'register_payment' and p_new.seller_id is not null");
    expect(migration).toContain("Responsable anterior:");
    expect(migration).toContain("Responsable comercial:");
  });
});
