/* global process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readLatestMigration = (suffix) => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith(suffix)).sort().at(-1);
  return readFileSync(join(dir, file), "utf8");
};

describe("realtime de produccion", () => {
  it("publica las tablas de produccion necesarias en supabase_realtime", () => {
    const migration = readLatestMigration("_production_realtime_publication.sql");

    expect(migration).toContain("pg_publication_tables");
    expect(migration).toContain("alter publication supabase_realtime add table public.orders");
    expect(migration).toContain("alter publication supabase_realtime add table public.order_production_assignments");
    expect(migration).toContain("alter publication supabase_realtime add table public.order_production_files");
    expect(migration).toContain("alter publication supabase_realtime add table public.order_production_user_archives");
  });

  it("centraliza la reconciliacion de produccion en eventos reales", () => {
    const source = readProjectFile("src/pages/page-production.jsx");
    const sharedHook = readProjectFile("src/hooks/useOrdersRealtimeSync.js");

    expect(source).toContain("refreshProductionOrdersSilently");
    expect(source).toContain("refreshProductionState");
    expect(source).toContain("useOrdersRealtimeSync({");
    expect(source).toContain('"order_production_assignments"');
    expect(sharedHook).toContain("registerRealtimeListener");
    expect(sharedHook).not.toContain('addEventListener("focus"');
  });
});
