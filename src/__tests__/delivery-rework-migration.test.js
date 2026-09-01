import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve("supabase/migrations/20260830120629_delivery_return_rework.sql"), "utf8");

describe("Delivery rework database boundary", () => {
  it("creates append-only audit records with restrictive recipient RLS", () => {
    expect(migration).toContain("create table public.delivery_rework_events");
    expect(migration).toContain("create table public.delivery_rework_event_items");
    expect(migration).toContain("delivery_rework_event_items_event_file_key unique");
    expect(migration).toContain("alter table public.delivery_rework_events enable row level security");
    expect(migration).toContain("delivery_rework_event_items_read_exact_recipient_or_actor_or_admin");
    expect(migration).toContain("recipient_id = auth.uid()");
    expect(migration).not.toContain("for insert to authenticated");
  });

  it("requires an assigned active Delivery actor and uses locked, versioned commands", () => {
    expect(migration).toContain("require_active_delivery_rework_actor");
    expect(migration).toContain("v_order.delivery_id is distinct from v_actor");
    expect(migration).toContain("for update");
    expect(migration).toContain("p_expected_updated_at is null");
    expect(migration).toContain("raise exception 'ORDER_STALE'");
    expect(migration).toContain("set_config('app.neonprint_order_command', 'delivery_rework', true)");
  });

  it("validates every selected item and directs a deduplicated notification only to its recipient", () => {
    expect(migration).toContain("jsonb_typeof(p_items) <> 'array'");
    expect(migration).toContain("jsonb_typeof(v_item->'correction_note') <> 'string'");
    expect(migration).toContain("No puedes repetir un archivo.");
    expect(migration).toContain("Cada archivo requiere una nota de 1 a 1000 caracteres.");
    expect(migration).toContain("resolve_delivery_rework_recipient");
    expect(migration).toContain("if p_file_assigned_to is not null then");
    expect(migration).toContain("return v_profile.id;");
    expect(migration).toContain("v_assignment_count <> 1");
    expect(migration).toContain("for update");
    expect(migration).toContain("for update;");
    expect(migration).toContain("array_agg(distinct recipient_id)");
    expect(migration).toContain("perform public.notify_many(array[v_recipient]");
    expect(migration).toContain("perform public.recalculate_order_production_status(v_order.id)");
  });

  it("keeps the existing status fan-out silent for rework and limits the order guard to exact paths", () => {
    expect(migration).toContain("Cannot safely patch handle_order_change_notification for delivery rework");
    expect(migration).toContain("regexp_replace(");
    expect(migration).toContain("if\\\\s+new\\\\.status");
    expect(migration).toContain("current_setting('app.neonprint_order_command', true) is distinct from 'delivery_rework'");
    expect(migration).toContain("old.status = 'in_Delivered' and new.status = 'in_Completed'");
    expect(migration).toContain("old.status = 'in_Completed' and new.status = 'in_Production'");
    expect(migration).toContain("old.status = 'in_Termination' and v_command = 'on'");
  });
});
