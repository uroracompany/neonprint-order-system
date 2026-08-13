import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name) => readFileSync(
  join(process.cwd(), "supabase/migrations", name),
  "utf8",
);

describe("security hardening migration", () => {
  it("keeps FlowTrack available exactly while the related order exists", () => {
    const migration = readMigration("20260813000000_harden_public_tracking_and_uploads.sql");

    expect(migration).toContain("from public.orders o");
    expect(migration).toContain("inner join public.orders o on o.id = e.order_id");
    expect(migration).not.toContain("tracking_token_expires_at");
    expect(migration).not.toContain("tracking_token_revoked_at");
    expect(migration).not.toContain("tracking_token_expires_at > now()");
    expect(migration).not.toContain("tracking_token_revoked_at is null");
  });

  it("removes active SVG and generic binary MIME types from order document storage", () => {
    const migration = readMigration("20260813000000_harden_public_tracking_and_uploads.sql");

    expect(migration).not.toContain("'image/svg+xml'");
    expect(migration).not.toContain("'application/octet-stream'");
    expect(migration).toContain("where id = 'order-docs'");
  });
});
