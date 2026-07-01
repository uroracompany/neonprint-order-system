/* global process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyOrdersSnapshot } from "../utils/orderRealtime";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readLatestMigration = (suffix) => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith(suffix)).sort().at(-1);
  return readFileSync(join(dir, file), "utf8");
};

describe("order realtime synchronization", () => {
  it("secures private per-user topics and emits minimal database broadcasts", () => {
    const migration = readLatestMigration("_order_realtime_broadcast_sync.sql");

    expect(migration).toContain("on realtime.messages");
    expect(migration).toContain("realtime.messages.extension = 'broadcast'");
    expect(migration).toContain("'orders:user:' || (select auth.uid())::text");
    expect(migration).not.toMatch(/on realtime\.messages\s+for insert/i);
    expect(migration).toContain("perform realtime.send(");
    expect(migration).toContain("'order_id', target_order_id");
    expect(migration).toContain("'operation', tg_op");
    expect(migration).not.toContain("to_jsonb(new)");
  });

  it("targets old and new participants, active admins, production and delivery", () => {
    const migration = readLatestMigration("_order_realtime_broadcast_sync.sql");

    expect(migration).toContain("select p_old as order_row");
    expect(migration).toContain("select p_new as order_row");
    expect(migration).toContain("public.get_admin_user_ids()");
    expect(migration).toContain("public.admin_order_edit_production_recipients(order_row)");
    expect(migration).toContain("public.get_role_user_ids('delivery')");
    expect(migration).toContain("array_agg(distinct candidate.recipient_id)");
    expect(migration).toContain("coalesce(profile.employment_status, true) = true");
    expect(migration).toContain("before delete on public.orders");
  });

  it("keeps Postgres Changes enabled as an idempotent fallback", () => {
    const migration = readLatestMigration("_order_realtime_broadcast_sync.sql");

    expect(migration).toContain("pg_publication_tables");
    expect(migration).toContain("alter publication supabase_realtime add table public.orders");
    expect(migration).not.toContain("replica identity full");
  });

  it("adopts the shared hook and authoritative snapshots in every internal module", () => {
    const modules = [
      "src/pages/dashboard.jsx",
      "src/pages/pages-seller.jsx",
      "src/pages/page-designer.jsx",
      "src/pages/page-quote.jsx",
      "src/pages/page-production.jsx",
      "src/pages/page-delivery.jsx",
    ];

    modules.forEach((path) => {
      const source = readProjectFile(path);
      expect(source).toContain("useOrdersRealtimeSync({");
      expect(source).toContain("applyOrdersSnapshot({");
      expect(source).not.toContain('{ event: "*", schema: "public", table: "orders" }');
      expect(source).not.toContain("{ event: '*', schema: 'public', table: 'orders' }");
    });
    expect(readProjectFile("src/pages/page-tracking.jsx")).not.toContain("useOrdersRealtimeSync");
  });

  it("updates or closes an open modal from a successful authoritative snapshot", () => {
    const setOrders = vi.fn();
    const setSelectedOrder = vi.fn();
    const freshOrder = { id: "order-1", payment_status: "pagado" };

    applyOrdersSnapshot({ orders: [freshOrder], setOrders, setSelectedOrder });
    expect(setOrders).toHaveBeenCalledWith([freshOrder]);
    expect(setSelectedOrder.mock.calls[0][0]({ id: "order-1", payment_status: "Pending_Payment" })).toEqual(freshOrder);
    expect(setSelectedOrder.mock.calls[0][0]({ id: "order-2" })).toBeNull();
  });

  it("reconciles secondary open order modals without dropping hydrated production relations", () => {
    const setOrders = vi.fn();
    const setSelectedOrder = vi.fn();
    const setAdvancedOrder = vi.fn();
    const setPaymentModalOrder = vi.fn();
    const setAdvancedProduction = vi.fn();
    const freshOrder = { id: "order-1", payment_status: "pagado", status: "in_Quote" };
    const staleHydratedOrder = {
      id: "order-1",
      payment_status: "Pending_Payment",
      order_production_files: [{ id: "file-1", production_area_code: "digital" }],
    };

    applyOrdersSnapshot({
      orders: [freshOrder],
      setOrders,
      setSelectedOrder,
      openOrderSetters: [setAdvancedOrder, setPaymentModalOrder],
      openOrderContainers: [{ setter: setAdvancedProduction }],
    });

    const nextAdvancedOrder = setAdvancedOrder.mock.calls[0][0](staleHydratedOrder);
    const nextPaymentOrder = setPaymentModalOrder.mock.calls[0][0](staleHydratedOrder);
    const nextProduction = setAdvancedProduction.mock.calls[0][0]({ order: staleHydratedOrder, reasonDetail: "motivo operativo" });

    expect(nextAdvancedOrder.payment_status).toBe("pagado");
    expect(nextPaymentOrder.status).toBe("in_Quote");
    expect(nextProduction.order.payment_status).toBe("pagado");
    expect(nextProduction.order.order_production_files).toEqual(staleHydratedOrder.order_production_files);
    expect(setAdvancedOrder.mock.calls[0][0]({ id: "missing" })).toBeNull();
  });
});
