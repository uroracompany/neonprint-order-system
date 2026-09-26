import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/20260825000000_order_delivery_overdue_notifications.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

describe("order delivery overdue notification migration", () => {
  it("keeps overdue as an operational signal and deduplicates each recipient", () => {
    expect(migration).toContain("order_delivery_overdue_notification_runs");
    expect(migration).toContain("primary key (order_id, delivery_date, user_id)");
    expect(migration).toContain("order_delivery_overdue");
    expect(migration).not.toMatch(/update\s+public\.orders\s+set\s+status/i);
  });

  it("routes by active workflow ownership and runs on a secure hourly schedule", () => {
    expect(migration).toContain("America/Asuncion");
    expect(migration).toContain("order_production_assignments");
    expect(migration).toContain("public.get_admin_user_ids()");
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function public.dispatch_order_delivery_overdue_notifications()");
    expect(migration).toContain("'5 * * * *'");
  });
});
