import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProductionCatalogs, buildProductionFileRows } from "../utils/production";

describe("production file specifications", () => {
  it("keeps multiple materials and one termination on each production row", () => {
    const [row] = buildProductionFileRows({
      orderId: "order-1",
      urls: ["https://example.com/banner.pdf"],
      files: [{ name: "banner.pdf" }],
      areaCodes: ["ploteo"],
      publicLabels: ["Banner principal"],
      materialNames: [["Banner", "Vinilo", "Banner"]],
      terminationNames: ["Ojales"],
      userId: "user-1",
    });

    expect(row).toMatchObject({
      production_area_code: "ploteo",
      material_names: ["Banner", "Vinilo"],
      termination_name: "Ojales",
    });
  });

  it("groups catalog options by their production area", () => {
    expect(buildProductionCatalogs(
      [{ name: "Banner", production_area_code: "ploteo" }, { name: "DTF Film", production_area_code: "dtf" }],
      [{ name: "Ojales", production_area_code: "ploteo" }],
    )).toEqual({
      materials: { ploteo: ["Banner"], dtf: ["DTF Film"] },
      terminations: { ploteo: ["Ojales"] },
    });
  });

  it("keeps legacy order summaries until every file has file-level specifications", () => {
    const migration = readFileSync("supabase/migrations/20260830210000_file_materials_and_terminations_by_area.sql", "utf8");

    expect(migration).toContain("v_total <> v_complete");
    expect(migration).toContain("save_order_production_file_specifications");
    expect(migration).toContain("production_terminations");
  });

  it("uses transaction-safe wrappers instead of a follow-up client specification save", () => {
    const atomicMigration = readFileSync("supabase/migrations/20260831021500_atomic_production_file_specifications.sql", "utf8");
    const atomicSources = [
      "src/components/orders/CreateOrderModal.jsx",
      "src/components/orders/EditOrderModal.jsx",
      "src/components/orders/AdminManageFilesModal.jsx",
    ].map((file) => readFileSync(file, "utf8"));
    const designerSource = readFileSync("src/pages/page-designer.jsx", "utf8");

    expect(atomicMigration).toContain("create_seller_order_with_file_specifications");
    expect(atomicMigration).toContain("seller_update_order_with_files_and_specifications");
    expect(atomicMigration).toContain("admin_edit_order_with_file_specifications");
    expect(atomicMigration).toContain("designer_update_order_with_file_specifications");
    expect(atomicMigration).toContain("admin_add_production_file_with_specifications");
    expect(atomicMigration).toContain("save_order_production_file_specifications");
    expect(atomicSources.join("\n")).not.toContain('rpc("save_order_production_file_specifications"');
    expect(designerSource).toContain('rpc("designer_update_order_with_file_specifications"');
    expect(designerSource).toContain('rpc("save_order_production_file_specifications"');
  });

  it("requires complete file specifications before Design can advance an order to Caja", () => {
    const migration = readFileSync("supabase/migrations/20260831042432_require_file_specs_before_quote.sql", "utf8");

    expect(migration).toContain("unnest(coalesce(pf.material_names, '{}'::text[]))");
    expect(migration).toContain("nullif(trim(material.name), '') is not null");
    expect(migration).toContain("pf.public_label");
    expect(migration).toContain("pf.production_area_code");
    expect(migration).toContain("pf.termination_name");
    expect(migration).toContain("antes de enviar a Caja");
  });
});
