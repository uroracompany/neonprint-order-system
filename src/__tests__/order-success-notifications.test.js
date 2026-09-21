/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("order success notification contracts", () => {
  const migration = readProjectFile("supabase/migrations/20260907120000_order_success_notifications.sql");

  it("normalizes creation, routing, assignments and paid payments as canonical success events", () => {
    expect(migration).toContain("normalize_order_success_notification()");
    expect(migration).toContain("v_event_kind = 'order_created'");
    expect(migration).toContain("'variant', 'success'");
    expect(migration).toContain("'event_kind', 'payment_confirmed'");
    expect(migration).toContain("'variant', 'payment_confirmed'");
    expect(migration).toContain("La orden fue marcada como pagada.");
    expect(migration).toContain("La orden fue enviada a Diseño exitosamente a");
    expect(migration).toContain("La orden fue enviada a Caja exitosamente a");
  });

  it("keeps actor and distinct assignee notifications separate without exposing payment assets", () => {
    expect(migration).toContain("v_assignee_id is distinct from v_actor_id");
    expect(migration).toContain("v_event_kind = 'designer_assigned' and new.user_id is not distinct from v_actor_id");
    expect(migration).toContain("v_event_kind = 'quote_assigned' and new.user_id is not distinct from v_actor_id");
    expect(migration).toContain("'assignee_name', v_assignee_name");
    expect(migration).not.toContain("invoice_payment");
    expect(migration).not.toContain("signed_url");
  });

  it("emits one audited success notification per file transition to Termination", () => {
    expect(migration).toContain("notify_production_file_termination_success()");
    expect(migration).toContain("after update of status on public.order_production_files");
    expect(migration).toContain("new.status <> 'in_termination'");
    expect(migration).toContain("'termination:' || new.id::text || ':' || new.updated_at::text");
    expect(migration).toContain("'production_file_sent_to_termination'");
    expect(migration).toContain("Archivo enviado a Terminación correctamente");
    expect(migration).toContain("El archivo fue enviado a Terminación exitosamente a");
  });

  it("keeps trigger helpers private and uses hardened definer settings", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("revoke all on function public.normalize_order_success_notification() from public, anon, authenticated;");
    expect(migration).toContain("revoke all on function public.notify_production_file_termination_success() from public, anon, authenticated;");
    expect(migration).toContain("v_actor_id uuid := auth.uid();");
    expect(migration).toContain("v_recipient_can_access_order boolean := false;");
    expect(migration).toContain("Never trust it to identify an actor or to authorize");
  });
});
