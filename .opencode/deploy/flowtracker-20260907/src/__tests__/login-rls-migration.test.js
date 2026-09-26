/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("login profile RLS hardening migration", () => {
  it("restricts profile reads to self or active admins", () => {
    const migration = readProjectFile("supabase/migrations/20260726090000_harden_login_profiles_auth.sql");

    expect(migration).toContain("create or replace function public.current_profile_is_admin_secure()");
    expect(migration).toContain("security definer");
    expect(migration).toContain("drop policy if exists profiles_select_authenticated");
    expect(migration).toContain("create policy profiles_select_self_or_admin");
    expect(migration).toContain("(select auth.uid()) = id");
    expect(migration).toContain("or public.current_profile_is_admin_secure()");
    expect(migration).not.toContain("using (true)");
  });
});
