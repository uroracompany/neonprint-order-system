import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");

describe("retorno de Diseño a Ventas", () => {
  const migration = read("supabase/migrations/20260926212705_designer_return_order_to_sales.sql");
  const page = read("src/pages/page-designer.jsx");

  it("preserva el retorno atómico y limitado al diseñador asignado", () => {
    expect(migration).toContain("create or replace function public.designer_return_order_to_sales");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("v_order.order_design_type <> 'INTERNAL_DESING'");
    expect(migration).toContain("v_order.designer_id is distinct from v_actor");
    expect(migration).toContain("status = 'Pending', designer_id = null, return_reason");
    expect(migration).toContain("designer_returned_to_sales");
    expect(migration).toContain("grant execute on function public.designer_return_order_to_sales");
  });

  it("notifica sólo al vendedor efectivo y suprime el fan-out genérico duplicado", () => {
    expect(migration).toContain("select p.id into v_sales_recipient");
    expect(migration).toContain("where p.id = v_order.seller_id");
    expect(migration).toContain("where p.id = v_order.created_by");
    expect(migration.match(/perform public\.notify_many\(/g)).toHaveLength(1);
    expect(migration).toContain("array[v_sales_recipient]");
    expect(migration).toContain("p.role = 'seller'");
    expect(migration).toContain("v_sales_recipient is distinct from v_actor");
    expect(migration).toContain("'event_kind', 'designer_returned_to_sales'");

    const strictReturnGuard = [
      "old.status = ''in_Design''",
      "new.status = ''Pending''",
      "old.order_design_type = ''INTERNAL_DESING''",
      "new.order_design_type = ''INTERNAL_DESING''",
      "old.designer_id is not null",
      "new.designer_id is null",
      "new.return_reason is distinct from old.return_reason",
    ];
    for (const condition of strictReturnGuard) expect(migration).toContain(condition);
    expect(migration).toContain("v_definition := replace(v_definition, v_original_condition, v_return_condition)");
    expect(migration).toContain("and not (");
  });

  it("usa el modal y la RPC, sin una actualización directa del navegador", () => {
    expect(page).toContain('rpc("designer_return_order_to_sales"');
    expect(page).toContain('targetOverride="sales"');
    expect(page).toContain("canDesignerReturnInternalOrderToSales");
  });
});
