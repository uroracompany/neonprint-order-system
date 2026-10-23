import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve("supabase/migrations/20261015100000_delivery_confirmation_traceability.sql"),
  "utf8",
);

describe("delivery confirmation traceability migration", () => {
  it("creates one private, validated confirmation for each order", () => {
    expect(migration).toContain("create table if not exists public.delivery_confirmations");
    expect(migration).toContain("order_id uuid primary key references public.orders(id) on delete cascade");
    expect(migration).toContain("executor_type in ('assigned_delivery', 'other_person')");
    expect(migration).toContain("char_length(btrim(executor_name)) between 1 and 200");
    expect(migration).toContain("char_length(btrim(delivery_comment)) between 1 and 500");
  });

  it("allows reads only to admins or the currently assigned delivery user, without client writes", () => {
    expect(migration).toContain("alter table public.delivery_confirmations enable row level security");
    expect(migration).toContain("revoke all on table public.delivery_confirmations from public, anon, authenticated");
    expect(migration).toContain("grant select on table public.delivery_confirmations to authenticated");
    expect(migration).toContain('for select\n  to authenticated');
    expect(migration).toContain("public.current_profile_is_admin()");
    expect(migration).toContain("o.delivery_id = auth.uid()");
    expect(migration).toContain("and p.deleted_at is null");
    const confirmationPolicy = migration.slice(
      migration.indexOf('create policy "delivery confirmations'),
      migration.indexOf("-- Retire the note-only signature"),
    );
    expect(confirmationPolicy).not.toContain("for insert");
    expect(confirmationPolicy).not.toContain("for update");
    expect(confirmationPolicy).not.toContain("for delete");
  });

  it("replaces the note-only command with an atomic, validated upsert", () => {
    expect(migration).toContain("drop function if exists public.delivery_mark_order_delivered(uuid, text)");
    expect(migration).toContain("p_executor_type text,");
    expect(migration).toContain("p_other_executor_name text,");
    expect(migration).toContain("p_delivery_comment text");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_order.delivery_id is distinct from v_actor");
    expect(migration).toContain("v_order.status <> 'in_Completed'");
    expect(migration).toContain("v_order.payment_status not in ('pagado', 'credito')");
    expect(migration).toContain("and deleted_at is null;");
    expect(migration).toContain("if coalesce(v_order.is_archived_delivery, false) then");
    expect(migration).toContain("on conflict (order_id) do update set");
    expect(migration).toContain("perform set_config('app.neonprint_order_command', 'on', true)");
    expect(migration).toContain("set status = 'in_Delivered'");
    expect(migration).not.toContain("order_events");
    expect(migration).not.toContain("set delivery_note");
  });
});
