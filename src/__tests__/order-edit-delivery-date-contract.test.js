/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const adminMigration = read("supabase/migrations/20260828123000_secure_admin_order_edit_and_lifecycle_commands.sql");
const repairMigration = read("supabase/migrations/20260828131500_fix_order_edit_delivery_date_text.sql");
const semiAdminRepairMigration = read("supabase/migrations/20260905121410_fix_semi_admin_text_delivery_date.sql");
const createMigration = read("supabase/migrations/20260828091500_restore_admin_order_capabilities.sql");
const editModal = read("src/components/orders/EditOrderModal.jsx");

describe("order editing with textual delivery dates", () => {
  it("keeps the administrative edit command text-typed while validating a date value", () => {
    expect(adminMigration).toContain("v_delivery_date text;");
    expect(adminMigration).toContain("v_delivery_date is distinct from v_old.delivery_date");
    expect(adminMigration).toContain("delivery_date = case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end");
    expect(adminMigration).not.toContain("nullif(p_changes->>'delivery_date', '')::date else delivery_date");
  });

  it("repairs both seller routes and the advanced administrative requirements route", () => {
    expect(repairMigration).toContain("create or replace function public.seller_update_order(");
    expect(repairMigration).toContain("create or replace function public.seller_update_order_with_files(");
    expect(repairMigration).toContain("create or replace function public.admin_update_order_requirements_command(");
    expect(repairMigration).toContain("p_action in ('reclassify_design', 'update_requirements')");
    expect(repairMigration).not.toContain("::date else delivery_date");
    expect(repairMigration).not.toContain("coalesce((p_payload#>>'{changes,delivery_date}')::date, delivery_date)");
    expect(createMigration).not.toContain("nullif(p_order->>'delivery_date', '')::date");
  });

  it("keeps the Semi-Admin file update route text-typed too", () => {
    expect(semiAdminRepairMigration).toContain("create or replace function public.semi_admin_update_order(");
    expect(semiAdminRepairMigration).toContain("v_delivery_date text;");
    expect(semiAdminRepairMigration).toContain("delivery_date=case when p_changes ? 'delivery_date' then v_delivery_date else delivery_date end");
    expect(semiAdminRepairMigration).not.toContain("::date else delivery_date");
  });

  it("does not render asset upload controls for an administrator outside the permitted stage", () => {
    expect(editModal).toContain("{canEditAssets ? (");
    expect(editModal).toContain("const adminChanges = {");
    expect(editModal).toContain("if (canEditAssets) {");
    expect(editModal).toContain('["in_Quote", "cancelled", "in_Delivered"].includes(order?.status)');
    expect(editModal).toContain("Para modificar archivos, devuelve esta orden a Diseño");
    expect(editModal).toContain('role="status"');
  });

  it("reports an unapplied administrative RPC without falling back to browser DML", () => {
    expect(editModal).toContain('adminEditError.code === "PGRST202"');
    expect(editModal).toContain("La configuración segura de edición aún no está aplicada");
    expect(editModal).toContain("!adminEditResult?.success || !adminEditResult?.order");
    expect(editModal).not.toContain('.from("order_production_files")');
  });
});
