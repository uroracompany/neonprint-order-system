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

  it("refresca produccion ante asignaciones, archivos, SUBSCRIBED y recuperacion de pestana", () => {
    const source = readProjectFile("src/pages/page-production.jsx");
    const sharedHook = readProjectFile("src/hooks/useOrdersRealtimeSync.js");

    expect(source).toContain('table: "order_production_assignments"');
    expect(source).toContain("refreshProductionOrdersSilently");
    expect(source).toContain('.subscribe((status) =>');
    expect(source).toContain('status === "SUBSCRIBED"');
    expect(source).toContain("refreshFilesAndOrders");
    expect(source).toContain("useOrdersRealtimeSync({");
    expect(sharedHook).toContain('document.addEventListener("visibilitychange", refreshWhenVisible)');
    expect(sharedHook).toContain('window.addEventListener("focus", refreshWhenVisible)');
    expect(sharedHook).toContain('window.addEventListener("online", requestRefresh)');
  });
});
