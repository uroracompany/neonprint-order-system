/* global process */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

const readRegisteredClientMigration = () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const migrationFile = readdirSync(migrationsDir)
    .find((name) => name.endsWith("_require_registered_clients_for_orders.sql"));

  expect(migrationFile).toBeTruthy();
  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("registered client order enforcement", () => {
  it("migration requires client_id on insert and normalizes order customer fields from clients", () => {
    const migration = readRegisteredClientMigration();

    expect(migration).toContain("create or replace function public.enforce_registered_order_client()");
    expect(migration).toContain("if tg_op = 'INSERT' and new.client_id is null then");
    expect(migration).toContain("Debes seleccionar un cliente registrado para crear una orden.");
    expect(migration).toContain("new.client_name := v_client.name;");
    expect(migration).toContain("new.client_contact := v_client.phone;");
    expect(migration).toContain("before insert or update of client_id, client_name, client_contact on public.orders");
  });

  it("migration preserves legacy orders without client_id unless customer fields are edited", () => {
    const migration = readRegisteredClientMigration();

    expect(migration).toContain("if new.client_id is null then");
    expect(migration).toContain("new.client_name is distinct from old.client_name");
    expect(migration).toContain("new.client_contact is distinct from old.client_contact");
    expect(migration).toContain("Debes vincular un cliente registrado antes de modificar los datos del cliente.");
  });

  it("migration blocks duplicate normalized client phones before creating the unique index", () => {
    const migration = readRegisteredClientMigration();

    expect(migration).toContain("duplicate_count");
    expect(migration).toContain("having count(*) > 1");
    expect(migration).toContain("idx_clients_phone_digits_unique");
    expect(migration).toContain("where nullif(phone_digits, '') is not null");
  });

  it("sales and admin forms require a selected registered client and keep visible fields read-only", () => {
    const seller = readProjectFile("src/pages/pages-seller.jsx");
    const admin = readProjectFile("src/pages/dashboard.jsx");

    expect(seller).toContain("Debes seleccionar un cliente registrado.");
    expect(seller).toContain("client_id: form.client_id");
    expect(seller).toContain("value={form.client_name} readOnly disabled");
    expect(seller).toContain("value={form.client_phone} readOnly disabled");
    expect(admin).toContain("Debes seleccionar un cliente registrado.");
    expect(admin).toContain("client_id: orderForm.client_id");
    expect(admin).toContain("value={orderForm.client_name} readOnly disabled");
    expect(admin).toContain("value={orderForm.client_contact} readOnly disabled");
  });

  it("order forms no longer use manual client edit helpers", () => {
    const seller = readProjectFile("src/pages/pages-seller.jsx");
    const admin = readProjectFile("src/pages/dashboard.jsx");
    const clients = readProjectFile("src/utils/clients.js");

    expect(seller).not.toContain("getManualClientEditFields");
    expect(admin).not.toContain("getManualClientEditFields");
    expect(clients).not.toContain("getManualClientEditFields");
  });

  it("quote links legacy orders to an existing registered client instead of promoting manual creation", () => {
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(quote).toContain("function RegisteredClientLinkModal");
    expect(quote).toContain("Vincular cliente registrado");
    expect(quote).toContain("client_id: clientLinkSelection.id");
    expect(quote).not.toContain('Registrar Cliente {order.client_name || "sin nombre"}');
    expect(quote).not.toContain("setClientInitialValues");
    expect(quote).not.toContain("creditPendingOrder");
  });
});
