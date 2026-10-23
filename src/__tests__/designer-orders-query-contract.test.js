import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");

describe("Designer orders query contract", () => {
  it("loads the authenticated designer's orders directly and applies an authoritative snapshot", () => {
    const fetcher = source.slice(source.indexOf("const fetchOrders"), source.indexOf("const handleClientSearch"));

    expect(fetcher).toContain('.from("orders")');
    expect(fetcher).toContain(".select(DESIGNER_ORDER_SELECT)");
    expect(fetcher).toContain('.eq("designer_id", userRef.current.id)');
    expect(fetcher).toContain('.order("created_at", { ascending: false })');
    expect(fetcher).toContain("applyOrdersSnapshot({ orders: data, setOrders, setSelectedOrder })");
    expect(fetcher).not.toContain("designer_order_workbench");
    expect(fetcher).not.toContain("rpc(");
  });

  it("refreshes the direct query on initial load and through the shared realtime hook", () => {
    expect(source).toContain("void fetchOrders();");
    expect(source).toContain('useOrdersRealtimeSync({ userId: user?.id, scope: "designer", refreshOrders: fetchOrders })');
  });
});
