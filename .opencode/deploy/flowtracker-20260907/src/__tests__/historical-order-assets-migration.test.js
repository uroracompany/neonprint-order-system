import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20260829223000_catalog_historical_order_assets.sql"), "utf8");

describe("historical order asset catalog migration", () => {
  it("catalogues only valid internal Storage objects idempotently", () => {
    expect(migration).toContain("order-docs|order-previews|payment-invoice");
    expect(migration).toContain("join storage.objects stored_object");
    expect(migration).toContain("on conflict (provider, bucket, object_key) do nothing");
    expect(migration).toContain("object_key like 'orders/' || order_id::text");
    expect(migration).toContain("_decode_historical_asset_path");
    expect(migration).toContain("convert_from(decode");
  });

  it("does not introduce public bucket access or destructive operations", () => {
    expect(migration).not.toMatch(/update\s+storage\.buckets/i);
    expect(migration).not.toMatch(/delete\s+from/i);
    expect(migration).not.toMatch(/create\s+policy/i);
  });
});
