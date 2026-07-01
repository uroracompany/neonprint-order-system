import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useOrderEventReviews from "../hooks/useOrderEventReviews";

const { from, channel, removeChannel } = vi.hoisted(() => ({
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: { from, channel, removeChannel },
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return { promise, resolve };
};

describe("useOrderEventReviews", () => {
  let order;

  beforeEach(() => {
    vi.clearAllMocks();

    const query = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.in = vi.fn(() => query);
    query.is = vi.fn(() => query);
    order = vi.fn();
    query.order = order;
    from.mockReturnValue(query);

    channel.mockImplementation(() => {
      const realtimeChannel = {
        on: vi.fn(),
        subscribe: vi.fn(),
      };
      realtimeChannel.on.mockReturnValue(realtimeChannel);
      realtimeChannel.subscribe.mockReturnValue(realtimeChannel);
      return realtimeChannel;
    });
  });

  it("ignores a pending review load from the previous authenticated user", async () => {
    const staleLoad = deferred();
    order
      .mockImplementationOnce(() => staleLoad.promise)
      .mockResolvedValueOnce({ data: [], error: null });

    const { result, rerender } = renderHook(({ userId }) => useOrderEventReviews(userId), {
      initialProps: { userId: "user-1" },
    });

    await waitFor(() => expect(order).toHaveBeenCalledTimes(1));
    rerender({ userId: "user-2" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingCount).toBe(0);

    await act(async () => {
      staleLoad.resolve({
        data: [{
          id: "stale-review",
          order_id: "order-1",
          event_key: "admin_intervention",
          metadata: {},
          created_at: "2026-06-30T12:00:00.000Z",
        }],
        error: null,
      });
      await staleLoad.promise;
    });

    expect(result.current.pendingCount).toBe(0);
    expect(result.current.pendingByOrder).toEqual({});
  });
});
