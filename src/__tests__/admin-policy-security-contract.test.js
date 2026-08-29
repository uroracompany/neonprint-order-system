/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/20260828170000_close_admin_policy_bypasses.sql");
const assetPolicyMigration = read("supabase/migrations/20260828171500_secure_admin_asset_wrapper_policy.sql");
const cleanupRetirementMigration = read("supabase/migrations/20260828172000_retire_client_asset_cleanup_enqueue.sql");
const filesModal = read("src/components/orders/AdminManageFilesModal.jsx");
const panel = read("src/components/orders/AdminInterventionPanel.jsx");
const uploadAssets = read("src/utils/uploadOrderAsset.js");
const orphanReconciler = read("server/order-asset-orphan-reconciliation-handler.js");

describe("admin policy security closure contract", () => {
  it("retires alternate administrative entrypoints and rechecks every batch item", () => {
    expect(migration).toContain("revoke all on function public.admin_manage_order");
    expect(migration).toContain("revoke all on function public.admin_intervene_order");
    expect(migration).toContain("select * into v_order from public.orders where id = v_order_id for update");
    expect(migration).toContain("perform public.assert_admin_order_action_allowed(v_order_id, p_action)");
    expect(panel).toContain('executeAdminOrderCommand(supabase');
    expect(panel).not.toContain('rpc("admin_intervene_order"');
  });

  it("allows only graph-valid file transitions and requires a non-retired Delivery", () => {
    expect(migration).toContain("v_current_status = 'pending' and p_next_status = 'in_production'");
    expect(migration).toContain("v_current_status = 'in_termination' and p_next_status in ('in_production', 'completed')");
    expect(migration).toContain("p.employment_status is true and p.deleted_at is null");
    expect(migration).toContain("revoke all on function public.admin_force_file_status");
    expect(filesModal).toContain("FILE_STATUS_TRANSITIONS");
    expect(filesModal).toContain('rpc("admin_update_production_file_status"');
    expect(filesModal).not.toContain('rpc("admin_force_file_status"');
  });

  it("delegates failed attachment cleanup to the grace-period reconciler instead of client deletion", () => {
    expect(filesModal).toContain("server-side reconciler will queue");
    expect(filesModal).not.toContain('rpc("admin_enqueue_unattached_order_asset_deletion"');
    expect(cleanupRetirementMigration).toContain("revoke all on function public.admin_enqueue_unattached_order_asset_deletion(uuid, text, text) from public, anon, authenticated");
    expect(cleanupRetirementMigration).toContain("grace-period reconciler");
    expect(orphanReconciler).toContain("getReferencedOrderAssetPaths");
    expect(orphanReconciler).toContain("getReferencedPaths: (candidates)");
    expect(orphanReconciler).toContain('from("order_files")');
    expect(orphanReconciler).toContain('["failed", "deleted"].includes(file.status)');
    expect(uploadAssets).not.toMatch(/storage[\s\S]{0,180}\.remove\(/);
  });

  it("keeps credit unblocked, versioned, and role-checked for Administration and Caja", () => {
    expect(migration).toContain("if v_old.operational_status = 'blocked'");
    expect(migration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, 'register_payment')");
    expect(migration).toContain("elsif v_old.quote_id is distinct from v_actor");
    expect(migration).toContain("revoke all on function public.mark_order_as_credit(uuid, timestamptz)");
  });

  it("requires the full reassignment reason signature and removes the short overload grant", () => {
    expect(filesModal).toContain("p_reason_category: \"assignment_correction\"");
    expect(filesModal).toContain("p_reason_detail: reasonDetail");
    expect(migration).toContain("Deprecated compatibility overload: no execution grant");
    expect(migration).toContain("revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz)");
  });

  it("requires the catalogue policy, lock, and version on every public asset wrapper", () => {
    expect(assetPolicyMigration).toContain("rename to admin_edit_order_with_assets_legacy");
    expect(assetPolicyMigration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, 'edit_order', 'commercial_edit')");
    expect(assetPolicyMigration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, 'manage_files', 'manage_design_assets')");
    expect(assetPolicyMigration).toContain("select * into v_order from public.orders where id = p_order_id for update");
    expect(assetPolicyMigration).toContain("if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'");
    expect(assetPolicyMigration).toContain("where e.idempotency_key = p_idempotency_key and e.result is not null");
    expect(assetPolicyMigration).toContain("create or replace function public.admin_add_production_file(");
    expect(assetPolicyMigration).toContain("create or replace function public.admin_remove_production_file(");
  });

  it("makes blocked, terminal, and asset-stage violations fail through the policy before writes", () => {
    expect(assetPolicyMigration).toContain("v_order.operational_status <> 'blocked'");
    expect(assetPolicyMigration).toContain("v_order.status not in ('cancelled', 'in_Delivered')");
    expect(assetPolicyMigration).toContain("'internal_actions'");
    expect(assetPolicyMigration).toContain("coalesce(v_policy->'actions', '[]'::jsonb) || coalesce(v_policy->'internal_actions', '[]'::jsonb)");
    expect(assetPolicyMigration).toContain("No se puede retirar el último archivo fuera de su etapa de activos.");
    expect(assetPolicyMigration).toContain("revoke all on function public.admin_edit_order_with_assets_legacy");
  });
});
