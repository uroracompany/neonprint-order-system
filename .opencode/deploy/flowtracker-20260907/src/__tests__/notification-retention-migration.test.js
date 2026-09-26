/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = () => readFileSync(
  join(process.cwd(), "supabase/migrations/20260811120000_notification_state_retention.sql"),
  "utf8"
);

describe("notification state retention migration", () => {
  it("records read and archive timestamps without deleting historical rows immediately", () => {
    const migration = readMigration();

    expect(migration).toContain("add column if not exists read_at timestamptz");
    expect(migration).toContain("add column if not exists archived_at timestamptz");
    expect(migration).toMatch(/set read_at = now\(\)/);
    expect(migration).toMatch(/set archived_at = now\(\)/);
    expect(migration).toMatch(/set deleted_at = now\(\)\s+where deleted_at is not null/);
  });

  it("limits archive and dismissal RPCs to the selected notification", () => {
    const migration = readMigration();

    expect(migration).toContain("where id = p_notification_id");
    expect(migration).toContain("and user_id = caller");
    expect(migration).toContain("archived_at = now()");
    expect(migration).toContain("set deleted_at = now()");
    expect(migration).toContain("return updated_count;");
    expect(migration).not.toContain("and n.type = target.type");
  });

  it("permanently purges completed notification lifecycles after 30 days each day", () => {
    const migration = readMigration();

    expect(migration).toContain("now() - interval '30 days'");
    expect(migration).toContain("delete from public.notifications");
    expect(migration).toContain("purge-expired-notifications-daily");
    expect(migration).toContain("'15 3 * * *'");
    expect(migration).toContain("revoke all on function public.purge_expired_notifications(timestamptz) from authenticated");
  });
});
