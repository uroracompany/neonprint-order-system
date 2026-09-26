import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NewOrderBadge from "../components/orders/NewOrderBadge";
import { groupNewOrderAssignments } from "../hooks/useNewOrderAssignments";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("new order assignments", () => {
  it("keeps the newest pending assignment independently for each order", () => {
    const grouped = groupNewOrderAssignments([
      { id: "first", order_id: "order-1", assigned_at: "2026-08-22T09:00:00Z" },
      { id: "other", order_id: "order-2", assigned_at: "2026-08-22T09:30:00Z" },
      { id: "latest", order_id: "order-1", assigned_at: "2026-08-22T10:00:00Z" },
    ]);

    expect(grouped).toEqual({
      "order-1": expect.objectContaining({ id: "latest" }),
      "order-2": expect.objectContaining({ id: "other" }),
    });
  });

  it("uses the requested visible label", () => {
    render(<NewOrderBadge compact />);
    expect(screen.getByText("Nueva")).toBeVisible();
  });

  it("creates user-scoped receipts for each supported assignment flow", () => {
    const migration = readProjectFile("supabase/migrations/20260822010000_order_assignment_receipts.sql");

    expect(migration).toContain("create table if not exists public.order_assignment_receipts");
    expect(migration).toContain("'design', 'quote', 'production', 'delivery'");
    expect(migration).toContain("after insert or update of designer_id, quote_id, production_id, delivery_id on public.orders");
    expect(migration).toContain("after insert or update of assigned_to on public.order_production_assignments");
    expect(migration).toContain("create or replace function public.mark_order_assignment_receipts_seen");
    expect(migration).toContain("and user_id = v_user_id");
    expect(migration).toContain("alter publication supabase_realtime add table public.order_assignment_receipts");
  });

  it("connects all four operational pages to the persistent assignment queue", () => {
    ["page-designer.jsx", "page-quote.jsx", "page-production.jsx", "page-delivery.jsx"].forEach((page) => {
      const content = readProjectFile(`src/pages/${page}`);
      expect(content).toContain("useNewOrderAssignments");
      expect(content).toContain("NewOrderBadge");
      expect(content).toContain("acknowledgeOrder(order.id)");
    });
  });
});
