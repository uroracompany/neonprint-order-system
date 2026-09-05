import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20260905171422_fix_semi_admin_caja_assets.sql");
const workbench = read("src/pages/pages-seller.jsx");

describe("Semi-Admin Caja and asset authority contract", () => {
  it("deduplicates repeated production-file URLs during external creation", () => {
    const creation = migration.slice(
      migration.indexOf("create or replace function public.semi_admin_create_order_with_client"),
      migration.indexOf("-- Design remains attributable")
    );

    expect(creation).toContain("on conflict (order_id, url) do update set");
    expect(creation).toContain("material_names = excluded.material_names");
    expect(creation).toContain("termination_name = excluded.termination_name");
    expect(creation).toContain("v_order_id, trim(v_file->>'url')");
  });

  it("enforces the Design asset lock inside the responsibility RPC", () => {
    const assignment = migration.slice(migration.indexOf("create or replace function public.semi_admin_assign_stage_responsibility"));

    expect(assignment).toContain("p_stage = 'design'");
    expect(assignment).toContain("file.category in ('design', 'preview', 'reference')");
    expect(assignment).toContain("from public.order_production_files file");
    expect(assignment).toContain("No se puede reasignar Diseño mientras la orden tenga archivos u Orden de Trabajo");
    expect(assignment).toContain("for update");
  });

  it("routes Semi-Admin modal selections through the audited commands", () => {
    expect(workbench).toContain('handleSemiAdminOperation("send_design_to_quote", { quote_id: quoteId })');
    expect(workbench).toContain('handleSemiAdminOperation("stage_responsibility", { stage: "design", assignee_id: designerId })');
    expect(workbench).toContain('handleSemiAdminOperation("stage_responsibility", { stage: "quote", assignee_id: quoteId })');
    expect(workbench).toContain('defaultUserId={semiAdminDesignReassignment?.designer_id || ""}');
    expect(workbench).toContain('defaultUserId={semiAdminQuoteResponsibilityReassignment?.quote_id || ""}');
    expect(workbench).toContain('title="Enviar a Caja"');
  });
});
