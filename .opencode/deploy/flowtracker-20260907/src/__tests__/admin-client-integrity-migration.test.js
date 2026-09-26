import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260724093000_admin_client_integrity.sql"),
  "utf8",
);

describe("admin client integrity migration", () => {
  it("syncs linked order customer snapshots after client edits", () => {
    expect(migration).toContain("create or replace function public.sync_orders_from_updated_client");
    expect(migration).toContain("after update of name, phone on public.clients");
    expect(migration).toContain("client_name = new.name");
    expect(migration).toContain("client_contact = new.phone");
    expect(migration).toContain("app.admin_intervention_context");
  });

  it("blocks deleting clients with operational history", () => {
    expect(migration).toContain("create or replace function public.prevent_client_delete_with_relations");
    expect(migration).toContain("from public.orders o where o.client_id = old.id");
    expect(migration).toContain("from public.accounts_receivable ar where ar.client_id = old.id");
    expect(migration).toContain("trg_prevent_client_delete_with_relations");
  });

  it("validates client-order filters before running the directory query", () => {
    expect(migration).toContain("create or replace function public.admin_list_client_orders");
    expect(migration).toContain("p_status_filter");
    expect(migration).toContain("p_payment_filter");
    expect(migration).toContain("Uno o mas filtros de ordenes del cliente no son validos.");
  });

  it("adds order type and design type counts to client detail stats", () => {
    expect(migration).toContain("create or replace function public.admin_get_client_detail");
    expect(migration).toContain("'urgent_911_orders'");
    expect(migration).toContain("'normal_orders'");
    expect(migration).toContain("'internal_design_orders'");
    expect(migration).toContain("'external_design_orders'");
    expect(migration).toContain("o.order_type = 'orden 911'");
    expect(migration).toContain("o.order_design_type = 'INTERNAL_DESING'");
  });
});
