import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readWorkspaceFile = (path) => readFileSync(resolve(path), "utf8");

describe("delivery assignment ownership migration", () => {
  const migration = readWorkspaceFile("supabase/migrations/20260809000000_enforce_delivery_order_ownership.sql");

  it("assigns an active Delivery in the same transaction as the last production file", () => {
    expect(migration).toContain("p_delivery_id uuid default null");
    expect(migration).toContain("where p.id = p_delivery_id");
    expect(migration).toContain("and p.role = 'delivery'");
    expect(migration).toContain("set delivery_id = p_delivery_id");
    expect(migration).toContain("Selecciona un usuario Delivery activo para completar el ultimo archivo.");
  });

  it("preserves the assignment and removes status-based global Delivery access", () => {
    const recalculateFunction = migration.slice(
      migration.indexOf("create or replace function public.recalculate_order_production_status"),
      migration.indexOf("drop function if exists public.update_production_file_status"),
    );

    expect(recalculateFunction).not.toContain("delivery_id = case");
    expect(migration).not.toContain("current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered')");
    expect(migration).toContain("idx_orders_delivery_status_created_at");
    expect(migration).toContain("(select auth.uid()) in (created_by, seller_id, designer_id, quote_id, delivery_id)");
  });
});
