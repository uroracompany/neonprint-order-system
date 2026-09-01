import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260830001500_fix_seller_order_production_file_dedup.sql"),
  "utf8",
);

describe("seller order creation production-file deduplication", () => {
  it("suppresses legacy synchronization only for the creation command", () => {
    expect(migration).toContain("current_setting('app.neonprint_skip_legacy_order_file_sync', true) = 'on'");
    expect(migration).toContain("perform set_config('app.neonprint_skip_legacy_order_file_sync', 'on', true)");
    expect(migration).toContain("on conflict (order_id, url) do nothing");
    expect(migration.indexOf("perform set_config('app.neonprint_skip_legacy_order_file_sync', 'on', true)"))
      .toBeLessThan(migration.indexOf("insert into public.orders"));
  });

  it("creates one classified row with audit ownership and keeps legacy synchronization otherwise", () => {
    const productionInsertStart = migration.indexOf("insert into public.order_production_files(order_id, url, filename, public_label");
    const productionInsert = migration.slice(productionInsertStart, migration.indexOf("end loop;", productionInsertStart));

    expect(productionInsert).toContain("'pending', v_actor, v_actor");
    expect(productionInsert).not.toContain("on conflict");
    expect(migration).not.toContain("drop trigger");
    expect(migration).not.toContain("drop constraint");
  });
});
