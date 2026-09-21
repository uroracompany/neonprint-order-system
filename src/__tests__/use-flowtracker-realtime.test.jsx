import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../supabaseClient";
import useFlowTrackerRealtime from "../hooks/useFlowTrackerRealtime";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

describe("useFlowTrackerRealtime", () => {
  let channel;
  let broadcastHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    broadcastHandler = null;
    channel = {
      on: vi.fn((type, filter, callback) => {
        if (type === "broadcast") broadcastHandler = callback;
        return channel;
      }),
      subscribe: vi.fn((callback) => {
        callback?.("SUBSCRIBED");
        return channel;
      }),
    };
    supabase.channel.mockReturnValue(channel);
    supabase.removeChannel.mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribes to a token-scoped public channel and coalesces changes", async () => {
    const onChange = vi.fn().mockResolvedValue();
    const { unmount } = renderHook(() => useFlowTrackerRealtime({
      token: "tracking-token",
      onChange,
    }));

    expect(supabase.channel).toHaveBeenCalledWith("flowtrack:tracking-token", {
      config: { private: false },
    });
    expect(channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "flowtrack_changed" },
      expect.any(Function),
    );

    act(() => {
      broadcastHandler({ payload: { order_id: "order-1", operation: "UPDATE" } });
      broadcastHandler({ payload: { order_id: "order-1", operation: "UPDATE" } });
    });
    await act(async () => vi.advanceTimersByTimeAsync(100));

    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("does not create a subscription without a tracking token", () => {
    renderHook(() => useFlowTrackerRealtime({ token: "", onChange: vi.fn() }));
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});
