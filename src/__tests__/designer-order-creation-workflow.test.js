import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20261012150608_designer_order_creation_workflow.sql"),
  "utf8",
);
const createModal = readFileSync(resolve("src/components/orders/CreateOrderModal.jsx"), "utf8");
const designerPage = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");

describe("designer order creation workflow", () => {
  it("derives designer ownership, status, payment and cashier invoicing in SQL", () => {
    expect(migration).toContain("p_creation_mode text default 'seller'");
    expect(migration).toContain("p_creation_mode = 'designer' and v_role <> 'designer'");
    expect(migration).toContain("p_order->>'order_design_type' not in ('INTERNAL_DESING', 'EXTERNAL_DESING')");
    expect(migration).toContain("Las órdenes de Diseño Externo requieren al menos un archivo.");
    expect(migration).toContain("v_status := case when p_creation_mode = 'designer' then 'in_Design' else 'Pending' end");
    expect(migration).toContain("when p_creation_mode = 'designer' then 'cashier'");
    expect(migration).toContain("v_designer_id := case when p_creation_mode = 'designer' then v_actor else null end");
    expect(migration).toContain("'Pending_Payment'");
    expect(migration).toContain("designer_create_order_with_file_specifications");
  });

  it("keeps the creation command idempotent and protects asset reservations", () => {
    expect(migration).toContain("ORDER_IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("ORDER_CREATION_IN_PROGRESS");
    expect(migration).toContain("on conflict (actor_id, idempotency_key) do nothing");
    expect(migration).toContain("status = 'reserved'");
    expect(migration).toContain("set status = 'bound', bound_at = now()");
    expect(migration).toContain("revoke all on function private.create_order_with_assets_as_actor");
    expect(migration).toContain("revoke usage on schema private from public, anon, authenticated");
    expect(migration).toContain("public.designer_create_order_with_file_specifications(uuid, jsonb, jsonb, jsonb)");
  });

  it("allows only designer-created external orders through the designer production branch", () => {
    expect(migration).toContain("v_order.order_design_type = 'INTERNAL_DESING'");
    expect(migration).toContain("v_order.order_design_type = 'EXTERNAL_DESING' and v_order.created_by = v_actor");
    expect(migration).toContain("v_order.designer_id = v_actor");
    expect(migration).toContain("v_order.production_authorized_at is null");
  });

  it("connects the shared modal and designer page without changing Sales defaults", () => {
    expect(createModal).toContain('creationMode = "seller"');
    expect(createModal).toContain('creationMode === "designer" ? "cashier" : "seller"');
    expect(createModal).toContain('"designer_create_order_with_file_specifications"');
    expect(createModal).toContain('creationMode === "designer" ? ORDER_STATUS.IN_DESIGN : ORDER_STATUS.PENDING');
    expect(designerPage).toContain('creationMode="designer"');
    expect(designerPage).toContain('showCreateButton');
    expect(designerPage).toContain('onCreateNew={() => setShowCreate(true)}');
    expect(designerPage).toContain('onAddNewClient={() => setShowNewClientModal(true)}');
  });

  it("extends client insertion only to active designer profiles through the existing policy", () => {
    expect(migration).toContain("drop policy if exists clients_insert_non_admin on public.clients");
    expect(migration).toContain("current_profile_role() in ('seller', 'quote', 'designer')");
  });
});
