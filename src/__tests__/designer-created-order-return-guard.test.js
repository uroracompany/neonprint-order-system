import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20261012155451_prevent_designer_created_orders_return_to_sales.sql"),
  "utf8",
);
const designerPage = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");

describe("bloqueo de devolución de órdenes creadas por Diseño", () => {
  it("mantiene la RPC protegida y rechaza al Diseñador creador antes de mutar", () => {
    expect(migration).toContain("create or replace function public.designer_return_order_to_sales(");
    expect(migration).toContain("if v_order.created_by is not distinct from v_actor then");
    expect(migration).toContain("Las órdenes creadas por Diseño no pueden devolverse a Ventas.");
    expect(migration).toContain("grant execute on function public.designer_return_order_to_sales(uuid, text, timestamptz) to authenticated;");
  });

  it("oculta la acción propia y conserva una defensa en el handler", () => {
    expect(designerPage).toContain('order?.created_by !== actorId');
    expect(designerPage).toContain('if (returningToSales.created_by === user?.id)');
    expect(designerPage).toContain("Las órdenes creadas por Diseño no pueden devolverse a Ventas.");
    expect(designerPage).toContain('rpc("designer_return_order_to_sales", {');
  });
});
