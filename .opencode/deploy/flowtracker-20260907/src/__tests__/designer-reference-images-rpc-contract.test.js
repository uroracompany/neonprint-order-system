import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260829164839_designer_manage_reference_images.sql"),
  "utf8",
);

describe("designer reference image RPC manifest contract", () => {
  it("requires the actual provider-specific reference destinations", () => {
    expect(migration).toContain("f.provider = 'supabase'");
    expect(migration).toContain("f.bucket = 'order-docs'");
    expect(migration).toContain("'/ref-images/%'");
    expect(migration).toContain("f.provider = 'r2'");
    expect(migration).toContain("'/reference/%'");
  });

  it("keeps ownership, optimistic locking, queueing and the three-image limit inside the command", () => {
    expect(migration).toContain("f.uploaded_by = v_actor");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("order_asset_deletion_outbox");
    expect(migration).toContain("v_existing_count + jsonb_array_length(p_additions) > 3");
  });

  it("preserves seller references when null additions request only an authorized own removal", () => {
    expect(migration).toContain("p_additions := coalesce(p_additions, '[]'::jsonb);");
    expect(migration).toContain("jsonb_array_elements_text(v_reference_images)");
    expect(migration).toContain("v_final_images := v_final_images || p_additions;");
  });
});
