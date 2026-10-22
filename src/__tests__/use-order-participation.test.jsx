import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderParticipation } from "../hooks/useOrderParticipation";

const { rpc, channel, removeChannel } = vi.hoisted(() => ({
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({ supabase: { rpc, channel, removeChannel } }));

describe("useOrderParticipation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const channelInstance = {
      on: vi.fn(function on() { return this; }),
      subscribe: vi.fn(function subscribe() { return this; }),
    };
    channel.mockReturnValue(channelInstance);
    removeChannel.mockResolvedValue();
  });

  it("exposes the RPC timeline after a successful response", async () => {
    const timeline = [{ action: "Creó la orden", role: "design", user_id: "designer-1" }];
    rpc.mockResolvedValue({ data: timeline, error: null });

    const { result } = renderHook(() => useOrderParticipation("order-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(rpc).toHaveBeenCalledWith("get_order_participation_timeline", { p_order_id: "order-1" });
    expect(result.current.timeline).toEqual(timeline);
    expect(result.current.error).toBeNull();
  });

  it("preserves an RPC failure as an error and finishes loading", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "No autorizado" } });

    const { result } = renderHook(() => useOrderParticipation("order-2"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.timeline).toEqual([]);
    expect(result.current.error).toBe("No autorizado");
  });

  it("clears the timeline when the order identity changes before refetch completes", async () => {
    let resolveNext;
    rpc.mockResolvedValueOnce({ data: [{ action: "old" }], error: null });
    rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    const { result, rerender } = renderHook(({ orderId }) => useOrderParticipation(orderId), {
      initialProps: { orderId: "old-order" },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ orderId: "new-order" });

    expect(result.current.loading).toBe(true);
    expect(result.current.timeline).toEqual([]);
    await act(async () => resolveNext({ data: [{ action: "new" }], error: null }));
    await waitFor(() => expect(result.current.timeline).toEqual([{ action: "new" }]));
  });

  it("ignores a late response from the previously selected order", async () => {
    let resolveOld;
    rpc
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ action: "new order" }], error: null });
    const { result, rerender } = renderHook(({ orderId }) => useOrderParticipation(orderId), {
      initialProps: { orderId: "old-order" },
    });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_order_participation_timeline", { p_order_id: "old-order" }));
    rerender({ orderId: "new-order" });
    await waitFor(() => expect(result.current.timeline).toEqual([{ action: "new order" }]));

    await act(async () => resolveOld({ data: [{ action: "old order" }], error: null }));
    expect(result.current.timeline).toEqual([{ action: "new order" }]);
  });
});
