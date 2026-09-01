import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const page = fs.readFileSync(
  path.resolve(process.cwd(), "src/pages/page-designer.jsx"),
  "utf8",
);

describe("designer order asset command contract", () => {
  it("loads and sends the current optimistic-lock version required by the RPC", () => {
    expect(page).toMatch(/const DESIGNER_ORDER_SELECT = \[[\s\S]*?"updated_at"/);
    expect(page).toMatch(
      /designer_update_order_with_file_specifications", \{[\s\S]*?p_order_id: order\.id,[\s\S]*?p_expected_updated_at: orderUpdatedAt \|\| order\.updated_at,[\s\S]*?p_changes: updateData,[\s\S]*?p_new_production_files: productionRows/,
    );
  });
});
