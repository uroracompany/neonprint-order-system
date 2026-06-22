/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("notification persistence migration", () => {
  it("hardens notification RPCs so archived or deleted families are not recreated", () => {
    const migration = readProjectFile("supabase/migrations/20260620013000_harden_admin_notification_persistence.sql");

    expect(migration).toContain("alter table public.notifications");
    expect(migration).toContain("add column if not exists deleted_at timestamptz");
    expect(migration).toContain("idx_notifications_user_visible_created");
    expect(migration).toContain("create or replace function public.create_notification");
    expect(migration).toContain("create or replace function public.notify_many");
    expect(migration).toContain("create or replace function public.archive_notification");
    expect(migration).toContain("create or replace function public.dismiss_notification");
    expect(migration).toMatch(/deleted_at is not null or coalesce\(is_archived, false\) = true/);
    expect(migration).toContain("if nid is not null then");
    expect(migration).toContain("return nid;");
    expect(migration).toContain("revoke all on function public.notify_many");
    expect(migration).toContain("grant execute on function public.archive_notification(uuid) to authenticated");
    expect(migration).toContain("grant execute on function public.dismiss_notification(uuid) to authenticated");
  });

  it("soft-deletes older active duplicates without reactivating managed notifications", () => {
    const migration = readProjectFile("supabase/migrations/20260620013000_harden_admin_notification_persistence.sql");

    expect(migration).toContain("row_number() over");
    expect(migration).toContain("partition by user_id, type, order_id, title, message, coalesce(metadata->>'event_kind', '')");
    expect(migration).toContain("where deleted_at is null");
    expect(migration).toContain("and coalesce(is_archived, false) = false");
    expect(migration).toContain("set deleted_at = now()");
    expect(migration).toContain("and r.row_rank > 1");
    expect(migration).not.toMatch(/set\s+is_archived\s*=\s*false/i);
    expect(migration).not.toMatch(/set\s+deleted_at\s*=\s*null/i);
  });
});
