import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260825010000_notification_sound_preferences.sql"),
  "utf8"
);

describe("notification sound preference migration", () => {
  it("defaults every profile to enabled and limits updates to the authenticated user", () => {
    expect(migration).toContain("notification_sound_enabled boolean not null default true");
    expect(migration).toContain("where id = auth.uid()");
    expect(migration).toContain("security definer");
    expect(migration).toContain("grant execute on function public.set_notification_sound_enabled(boolean) to authenticated");
  });
});
