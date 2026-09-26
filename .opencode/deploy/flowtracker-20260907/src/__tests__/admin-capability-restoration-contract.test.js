/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const migration = read("supabase/migrations/20260828091500_restore_admin_order_capabilities.sql");
const retiredProfileHardening = read("supabase/migrations/20260828093000_harden_admin_advanced_command_retired_profiles.sql");
const filesModal = read("src/components/orders/AdminManageFilesModal.jsx");
const actionModal = read("src/components/orders/AdminAdvancedActionModal.jsx");
const dashboard = read("src/pages/dashboard.jsx");

describe("admin capability restoration contract", () => {
  it("derives admin and seller creation ownership from the authenticated active profile", () => {
    expect(migration).toContain("p.role in ('seller', 'admin')");
    expect(migration).toContain("and p.deleted_at is null;");
    expect(migration).toContain("v_seller_id := case when v_role = 'seller' then v_actor else null end;");
    expect(migration).toContain("'Pending'");
    expect(migration).toContain("'Pending_Payment'");
    expect(migration).toContain("v_seller_id,");
    expect(migration).toContain("v_actor,");
    expect(migration).not.toContain("p_order->>'seller_id'");
    expect(migration).not.toContain("p_order->>'created_by'");
    expect(migration).toContain("ORDER_IDEMPOTENCY_CONFLICT");
  });

  it("keeps administrative asset changes admin-only, locked, scoped and audited", () => {
    expect(migration).toContain("create or replace function public.admin_update_order_asset_metadata(");
    expect(migration).toContain("p_expected_updated_at timestamptz");
    expect(migration).toContain("p_changes jsonb");
    expect(migration).toContain("p.role = 'admin'");
    expect(migration).toContain("and p.deleted_at is null\n  ) then");
    expect(migration).toContain("for update;");
    expect(migration).toContain("if v_key not in ('preview_image', 'reference_images')");
    expect(migration).toContain("if v_old.updated_at is distinct from p_expected_updated_at then");
    expect(migration).toContain("app.neonprint_order_command");
    expect(migration).toContain("jsonb_array_length(v_reference_images) > 3");
    expect(migration).toContain("No se permiten imagenes de referencia duplicadas.");
    expect(migration).toContain("from storage.objects s");
    expect(migration).toContain("f.provider = 'r2'");
    expect(migration).toContain("perform public.record_admin_intervention(");
    expect(migration).toContain("revoke all on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) from public, anon;");
    expect(migration).toContain("grant execute on function public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb) to authenticated;");
  });

  it("moves both administrative asset saves behind the fixed-purpose RPC and refreshes its version", () => {
    expect(filesModal).toContain('supabase.rpc("admin_update_order_asset_metadata"');
    expect(filesModal).toContain("p_changes: { preview_image: publicUrl }");
    expect(filesModal).toContain("p_changes: { reference_images: allUrls }");
    expect(filesModal).toContain("p_expected_updated_at: orderUpdatedAt");
    expect(filesModal).toContain("setOrderUpdatedAt(updatedOrder.updated_at)");
    expect(filesModal).not.toContain('.update({ preview_image: publicUrl })');
    expect(filesModal).not.toContain('.update({ reference_images: allUrls })');
  });

  it("treats an admin-created order as unassigned until an active seller is selected", () => {
    expect(actionModal).toContain('setTargetUserId(order.seller_id || "")');
    expect(actionModal).toContain('case "seller": return sellerUsers;');
    expect(actionModal).not.toContain("extendedSellerUsers");
    expect(dashboard).toContain('"Sin asignar — Administración"');
    expect(dashboard).not.toContain("usersById[order.seller_id || order.created_by]");
  });

  it("rejects retired administrators and seller targets before advanced commands reach legacy logic", () => {
    expect(retiredProfileHardening).toContain("create or replace function public.admin_manage_order(");
    expect(retiredProfileHardening).toContain("create or replace function public.admin_execute_order_command(");
    expect(retiredProfileHardening).toContain("and p.deleted_at is null");
    expect(retiredProfileHardening).toContain("for share;");
    expect(retiredProfileHardening).toContain("if p_action in ('assign_seller', 'route_sales')");
    expect(retiredProfileHardening).toContain("and p.role = 'seller'");
    expect(retiredProfileHardening).toContain("raise exception 'Selecciona un vendedor activo.';");
    expect(retiredProfileHardening).toContain("and p_target_user_id <> v_actor");
    expect(retiredProfileHardening).toContain("return public.admin_manage_order_legacy(");
    expect(retiredProfileHardening).toContain("return public.admin_execute_order_command_legacy(");
    expect(retiredProfileHardening).toContain("revoke all on function public.admin_execute_order_command_legacy");
    expect(retiredProfileHardening).toContain("raise exception 'Falta la clave de idempotencia.';");
    expect(retiredProfileHardening).toContain("raise exception 'Selecciona una categoria de motivo valida.';");
    expect(retiredProfileHardening).toContain("create or replace function public.admin_execute_order_batch(");
    expect(retiredProfileHardening).toContain("v_result := public.admin_execute_order_command(");
  });
});
