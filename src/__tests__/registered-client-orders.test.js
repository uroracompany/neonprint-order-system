/* global process */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

const splitSqlTopLevelList = (sqlList) => {
  const items = [];
  let itemStart = 0;
  let depth = 0;
  let inString = false;

  for (let index = 0; index < sqlList.length; index += 1) {
    const character = sqlList[index];

    if (inString) {
      if (character === "'" && sqlList[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }

    if (character === "'") {
      inString = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error("Malformed SQL list: unexpected closing parenthesis.");
      }
    } else if (character === "," && depth === 0) {
      items.push(sqlList.slice(itemStart, index).trim());
      itemStart = index + 1;
    }
  }

  if (inString) {
    throw new Error("Malformed SQL list: unterminated string literal.");
  }
  if (depth !== 0) {
    throw new Error("Malformed SQL list: unbalanced parentheses.");
  }

  items.push(sqlList.slice(itemStart).trim());
  if (items.some((item) => item.length === 0)) {
    throw new Error("Malformed SQL list: empty item between delimiters.");
  }

  return items;
};

const normalizeSqlFragment = (fragment) => fragment.trim().replace(/\s+/g, " ");

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
    const createOrderModal = readProjectFile("src/components/orders/CreateOrderModal.jsx");

    expect(seller).toMatch(/import\s+(?:SharedCreateOrderModal|\{[\s\S]*?default\s+as\s+SharedCreateOrderModal[\s\S]*?\})\s+from\s+["']\.\.\/components\/orders\/CreateOrderModal["'];/);
    expect(seller).toContain("<SharedCreateOrderModal");
    expect(admin).toContain('import CreateOrderModal, { Field, Modal } from "../components/orders/CreateOrderModal";');
    expect(admin).toContain('import CreateClientModal from "../components/ui/CreateClientModal";');
    expect(admin).toContain('orderModalMode === "create"');
    expect(admin).toContain("clientToSelect={clientToSelectInOrderForm}");
    expect(admin).toContain("onClientToSelectConsumed={() => setClientToSelectInOrderForm(null)}");
    expect(createOrderModal).toContain("Debes seleccionar un cliente registrado.");
    expect(createOrderModal).toContain("client_id: form.client_id");
    expect(createOrderModal).toContain("value={form.client_name} readOnly disabled");
    expect(createOrderModal).toContain("value={form.client_phone} readOnly disabled");
  });

  it("shared create order flow keeps sales upload, production, and audit defaults for admin", () => {
    const createOrderModal = readProjectFile("src/components/orders/CreateOrderModal.jsx");
    const atomicCreationMigration = readProjectFile("supabase/migrations/20261012150608_designer_order_creation_workflow.sql");

    expect(createOrderModal).toContain("const orderId = createRequestIdRef.current || crypto.randomUUID();");
    expect(createOrderModal).toContain("path: `orders/${orderId}/files/${fileName}`");
    expect(createOrderModal).toContain('creationMode === "designer"');
    expect(createOrderModal).toContain('"create_seller_order_with_file_specifications"');
    expect(createOrderModal).toContain('.rpc(createCommand, {');
    expect(createOrderModal).toContain('p_idempotency_key: orderId');
    expect(createOrderModal).toContain('p_production_files: productionRows');
    expect(createOrderModal).not.toContain('.from("order_production_files")');
    expect(createOrderModal).toContain('payment_status: "Pending_Payment"');
    expect(createOrderModal).toContain("status: creationMode === \"designer\" ? ORDER_STATUS.IN_DESIGN : ORDER_STATUS.PENDING");
    expect(createOrderModal).toContain("seller_id: creationMode === \"designer\" ? null : userId,");
    expect(createOrderModal).toContain("created_by: userId,");
    expect(atomicCreationMigration).toContain("v_actor uuid := auth.uid();");
    expect(atomicCreationMigration).toMatch(
      /select p\.role into v_role\s+from public\.profiles p\s+where p\.id = v_actor/
    );
    expect(atomicCreationMigration).toMatch(
      /if \(p_creation_mode = 'seller' and v_role not in \('seller', 'admin'\)\)\s+or \(p_creation_mode = 'designer' and v_role <> 'designer'\) then/
    );
    expect(atomicCreationMigration).toMatch(
      /v_seller_id := case when p_creation_mode = 'seller' and v_role = 'seller' then v_actor else null end;/
    );

    const orderInsert = atomicCreationMigration.match(
      /insert into public\.orders\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning \* into v_order;/i
    );
    expect(orderInsert).toBeTruthy();
    expect(orderInsert?.[1].replace(/\s+/g, " ")).toContain(
      "seller_id, designer_id, quote_id, created_by, order_file_url"
    );
    expect(orderInsert?.[2].replace(/\s+/g, " ")).toContain(
      "v_seller_id, v_designer_id, null, v_actor, p_order->>'order_file_url'"
    );

    expect(atomicCreationMigration).toContain("create or replace function public.create_seller_order_with_file_specifications(");
    expect(atomicCreationMigration).toContain("v_status := case when p_creation_mode = 'designer' then 'in_Design' else 'Pending' end;");
    expect(atomicCreationMigration).toContain("v_order := public.create_seller_order_with_assets(");
    expect(atomicCreationMigration).toContain("v_order := public.save_order_production_file_specifications(");

    const orderColumns = splitSqlTopLevelList(orderInsert[1]);
    const orderValues = splitSqlTopLevelList(orderInsert[2]);
    expect(orderValues).toHaveLength(orderColumns.length);

    const orderValuesByColumn = new Map(
      orderColumns.map((column, index) => [column.trim().toLowerCase(), normalizeSqlFragment(orderValues[index])])
    );
    expect(orderValuesByColumn.get("status")).toBe("v_status");
    expect(orderValuesByColumn.get("payment_status")).toBe("'Pending_Payment'");
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
