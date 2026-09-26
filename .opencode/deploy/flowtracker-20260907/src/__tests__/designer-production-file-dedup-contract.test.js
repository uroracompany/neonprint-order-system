import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260827024500_designer_production_file_dedup.sql"),
  "utf8",
);

describe("designer production-file deduplication contract", () => {
  it("upserts the row created by the legacy order_file_url trigger", () => {
    expect(migration).toContain("create or replace function public.designer_update_order_assets(");
    expect(migration).toMatch(/on conflict \(order_id, url\) do update/i);
    expect(migration).toMatch(/set filename = excluded\.filename,[\s\S]*?public_label = excluded\.public_label,[\s\S]*?production_area_code = excluded\.production_area_code,[\s\S]*?updated_by = excluded\.updated_by/i);
  });

  it("retains the authorization and optimistic-lock checks", () => {
    expect(migration).toContain("role = 'designer'");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("select * into v_order from public.orders where id = p_order_id for update");
  });
});
