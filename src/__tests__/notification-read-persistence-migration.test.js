/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("notification read persistence migration", () => {
  it("updates only the authenticated user's selected active notification", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260811130000_fix_notification_read_persistence.sql"),
      "utf8"
    );

    expect(migration).toContain("create or replace function public.mark_notification_read");
    expect(migration).toContain("where id = p_notification_id");
    expect(migration).toContain("and user_id = caller");
    expect(migration).toContain("set is_read = true");
    expect(migration).toContain("read_at = now()");
    expect(migration).toContain("return updated_count;");
    expect(migration).toContain("grant execute on function public.mark_notification_read(uuid) to authenticated");
  });
});
