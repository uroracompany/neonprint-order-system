/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const migration = read("supabase/migrations/20260828123000_secure_admin_order_edit_and_lifecycle_commands.sql");
const policyMigration = read("supabase/migrations/20260828160000_admin_advanced_action_policy.sql");
const hardeningMigration = read("supabase/migrations/20260828170000_close_admin_policy_bypasses.sql");
const editModal = read("src/components/orders/EditOrderModal.jsx");
const orderActions = read("src/components/orders/AdminOrderActions.jsx");
const manageFilesModal = read("src/components/orders/AdminManageFilesModal.jsx");

describe("secure administrative order command repair", () => {
  it("removes the global admin bypass while retaining only command-local contexts", () => {
    const guardStart = migration.indexOf("create or replace function public.guard_orders_direct_update()");
    const guardEnd = migration.indexOf("create or replace function public.require_active_admin_order_actor()", guardStart);
    const guard = migration.slice(guardStart, guardEnd);

    expect(guard).toContain("app.neonprint_order_command");
    expect(guard).toContain("app.admin_intervention_context");
    expect(guard).not.toContain("current_profile_is_admin");
    expect(guard).toContain("ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden");
  });

  it("keeps only the catalogued administration command surface executable", () => {
    expect(migration).toContain("create or replace function public.require_active_admin_order_actor()");
    expect(migration).toContain("p.role = 'admin'");
    expect(migration).toContain("p.deleted_at is null");
    expect(policyMigration).toContain("perform public.assert_admin_order_action_allowed(p_order_id, p_action)");
    expect(hardeningMigration).toContain("revoke all on function public.admin_manage_order");
    expect(hardeningMigration).toContain("revoke all on function public.admin_intervene_order");
    expect(hardeningMigration).toContain("revoke all on function public.admin_force_file_status");
    expect(hardeningMigration).toContain("public.admin_execute_order_command(v_order_id, p_action");
  });

  it("uses one versioned, idempotent RPC for admin commercial edits and production-file reconciliation", () => {
    expect(migration).toContain("create or replace function public.admin_edit_order_with_assets(");
    expect(migration).toContain("p_new_production_files jsonb");
    expect(migration).toContain("p_removed_file_urls text[]");
    expect(migration).toContain("p_idempotency_key text");
    expect(migration).toContain("for update;");
    expect(migration).toContain("Campo no permitido");
    expect(migration).toContain("Los archivos solo se modifican en Diseno Interno o en Ventas para Diseno Externo.");
    expect(migration).toContain("El archivo de produccion no pertenece a esta orden.");
    expect(migration).toContain("create or replace function public.enqueue_admin_order_asset_deletion(");
    expect(migration).toContain("public.order_asset_deletion_outbox");
    expect(migration).toContain("v_catalog_file.provider");
    expect(migration).toContain("set deleted_at = now(), status = 'deleted'");
    expect(migration).not.toContain("public.order_asset_cleanup_queue");
    expect(migration).toContain("\\1");
    expect(migration).toContain("\\2");
    expect(migration).not.toContain("\\\\1");
    expect(migration).not.toContain("\\\\2");
    expect(migration).toContain("public.record_admin_intervention(");
    expect(migration).toContain("revoke insert, update, delete on public.order_production_files from public, anon, authenticated;");
    expect(migration).toContain("create or replace function public.admin_add_production_file(");
    expect(migration).toContain("create or replace function public.admin_remove_production_file(");
  });

  it("does not leave administrative browser DML or client-side cleanup after an edit", () => {
    expect(editModal).toContain('supabase.rpc("admin_edit_order_with_file_specifications"');
    expect(editModal).not.toContain('.from("order_production_files")');
    const adminCleanupStart = editModal.indexOf("if (isSellerEdit) {");
    expect(adminCleanupStart).toBeGreaterThan(-1);
    expect(editModal.slice(adminCleanupStart)).not.toContain("removeOrderAssetByPublicUrl");
  });

  it("keeps terminal, blocked, and payment controls aligned with the shared availability contract", () => {
    expect(orderActions).toContain("getAdminOrderActionVisibility");
    expect(orderActions).toContain("commandCatalog = null");
    expect(orderActions).toContain("visible: availability.payment");
    expect(orderActions).toContain("visible: availability.cancel");
  });

  it("does not offer administrative asset changes outside the design stage that owns them", () => {
    expect(manageFilesModal).toContain('supportsCapability("manage_design_assets")');
    expect(manageFilesModal).toContain('supportsCapability("manage_production_files")');
    expect(manageFilesModal).toContain('supportsCapability("reassign_production_file_area")');
    expect(manageFilesModal).toContain("devuelve la orden a Caja y luego a Diseño");
    expect(manageFilesModal).toContain("devuelve la orden a Caja y luego a Ventas");
    expect(manageFilesModal).toContain("!isPaymentLocked && canManageOrderAssets && !showAddFileForm");
    expect(manageFilesModal).toContain("!isPaymentLocked && canManageOrderAssets && (");
    expect(manageFilesModal).toContain("if (!canManageOrderAssets) return setError(assetWorkflowMessage);");
  });

  it("requires Caja for payment and exposes the audited completed-to-Caja return", () => {
    expect(migration).toContain("El pago solo puede modificarse cuando la orden esta en Caja.");
    expect(migration).toContain("admin_return_completed_to_quote_command");
    expect(migration).toContain("v_order.status <> 'in_Quote'");
    expect(migration).toContain("when 'reopen_cancelled' then 'Orden reactivada por Administracion'");
    expect(migration).toContain("array[v_actor], 'order_updated', 'Orden reactivada por Administracion'");
  });
});
