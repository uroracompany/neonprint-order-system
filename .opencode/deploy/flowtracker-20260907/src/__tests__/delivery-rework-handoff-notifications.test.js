import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve("supabase/migrations/20260830185444_delivery_rework_handoff_notifications.sql"),
  "utf8"
);

describe("Delivery rework handoff lifecycle", () => {
  it("keeps one server-owned active handoff per order and denies direct browser writes", () => {
    expect(migration).toContain("create table public.delivery_rework_handoffs");
    expect(migration).toContain("delivery_rework_handoffs_one_active_order_idx");
    expect(migration).toContain("where returned_to_delivery_at is null");
    expect(migration).toContain("alter table public.delivery_rework_handoffs enable row level security");
    expect(migration).toContain("revoke all on public.delivery_rework_handoffs from public, anon, authenticated");
  });

  it("creates directed recipient notices and a distinct confirmation for the returning Delivery actor", () => {
    expect(migration).toContain("'Orden devuelta por Delivery'");
    expect(migration).toContain("'Devolucion enviada a produccion'");
    expect(migration).toContain("'delivery_rework_return_confirmed'");
    expect(migration).toContain("'order_returned'");
    expect(migration).toContain("'event_id',v_event");
  });

  it("locks the final resend to the original Delivery and resolves only in that final command", () => {
    expect(migration).toContain("p_delivery_id is distinct from v_handoff.returning_delivery_id");
    expect(migration).toContain("Esta orden devuelta solo puede reenviarse al Delivery que la devolvio.");
    expect(migration).toContain("returned_to_delivery_at = now(), returned_to_delivery_by = v_uid");
    expect(migration).toContain("if is_last_pending_file and v_handoff.id is not null then");
  });

  it("exposes only the active badge state through an authenticated, authorised RPC", () => {
    expect(migration).toContain("get_active_delivery_rework_handoffs(p_order_ids uuid[])");
    expect(migration).toContain("current_user_assigned_to_production_area");
    expect(migration).toContain("revoke all on function public.get_active_delivery_rework_handoffs(uuid[]) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_active_delivery_rework_handoffs(uuid[]) to authenticated");
  });
});
