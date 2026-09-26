import { describe, expect, it, vi } from "vitest";
import { executeAdminOrderBatch, executeAdminOrderCommand } from "../utils/adminOrderCommands";

describe("admin order command client", () => {
  it("maps a single command to the canonical RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const result = await executeAdminOrderCommand({ rpc }, {
      orderId: "order-1",
      action: "set_priority",
      payload: { order_type: "orden 911" },
      reasonCategory: "operational_priority",
      reasonDetail: "Prioridad solicitada por operaciones.",
      expectedUpdatedAt: "2026-07-02T00:00:00Z",
      idempotencyKey: "command-1",
    });

    expect(result).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("admin_execute_order_command", expect.objectContaining({
      p_order_id: "order-1",
      p_action: "set_priority",
      p_idempotency_key: "command-1",
    }));
  });

  it("keeps one idempotency key for an entire batch", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { total: 2, results: [] }, error: null });
    await executeAdminOrderBatch({ rpc }, {
      orderIds: ["order-1", "order-2"],
      action: "resume_order",
      reasonCategory: "workflow_correction",
      reasonDetail: "Incidencia resuelta por operaciones.",
      idempotencyKey: "batch-1",
    });

    expect(rpc).toHaveBeenCalledWith("admin_execute_order_batch", expect.objectContaining({
      p_order_ids: ["order-1", "order-2"],
      p_idempotency_key: "batch-1",
    }));
  });

  it("surfaces backend errors without leaking implementation details", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "La orden esta bloqueada." } });
    await expect(executeAdminOrderCommand({ rpc }, {
      orderId: "order-1",
      action: "route_quote",
      reasonCategory: "workflow_correction",
      reasonDetail: "Intento de avance administrativo.",
      expectedUpdatedAt: "2026-07-02T00:00:00Z",
      idempotencyKey: "command-2",
    })).rejects.toThrow("La orden esta bloqueada.");
  });
});
