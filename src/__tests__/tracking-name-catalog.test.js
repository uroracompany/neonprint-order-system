import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261012133513_tracking_name_catalog.sql", "utf8");

describe("tracking name catalog migration", () => {
  it("defines normalized, deduplicated historical storage", () => {
    expect(migration).toContain("create table if not exists public.production_file_tracking_names");
    expect(migration).toContain("generated always as");
    expect(migration).toContain("lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))");
    expect(migration).toContain("stored unique");
    expect(migration).toContain("select distinct on (normalized_name)");
    expect(migration).toContain("on conflict (normalized_name) do nothing");
  });

  it("limits catalog access to active supported profiles", () => {
    expect(migration).toContain("alter table public.production_file_tracking_names enable row level security");
    expect(migration).toContain("grant select, insert on table public.production_file_tracking_names to authenticated");
    expect(migration).toContain("current_profile_role_secure() in ('admin', 'seller', 'semi_admin', 'designer', 'quote')");
    expect(migration).toContain("revoke all on table public.production_file_tracking_names from public, anon, authenticated");
    expect(migration).toContain("revoke all on function public.create_production_file_tracking_name(text) from public, anon");
    expect(migration).not.toContain("grant update on table public.production_file_tracking_names");
    expect(migration).not.toContain("grant delete on table public.production_file_tracking_names");
  });

  it("uses a race-safe invoker RPC and preserves designer public labels", () => {
    expect(migration).toContain("create or replace function public.create_production_file_tracking_name(p_name text)");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("insert into public.production_file_tracking_names (name)");
    expect(migration).toContain("returns table (id uuid, name text)");
    expect(migration).toContain("create or replace function public.save_order_production_file_specifications");
    expect(migration).toContain("v_public_label := nullif(trim(v_spec->>'public_label'), '')");
    expect(migration).toContain("public_label = coalesce(v_public_label, public_label)");
  });
});
