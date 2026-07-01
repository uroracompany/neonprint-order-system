import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../../supabaseClient";
import useOrdersRealtimeSync from "../hooks/useOrdersRealtimeSync";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    realtime: { setAuth: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flushConnection = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useOrdersRealtimeSync", () => {
  let channels;

  beforeEach(() => {
    vi.useFakeTimers();
    channels = [];
    supabase.realtime.setAuth.mockResolvedValue();
    supabase.removeChannel.mockResolvedValue();
    supabase.channel.mockImplementation((name, options) => {
      const handlers = {};
      const channel = {
        name,
        options,
        handlers,
        statusCallback: null,
        on: vi.fn((type, filter, callback) => {
          handlers[type] = callback;
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          channel.statusCallback = callback;
          return channel;
        }),
      };
      channels.push(channel);
      return channel;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses an authorized private Broadcast plus Postgres Changes fallback", async () => {
    const refreshOrders = vi.fn().mockResolvedValue();
    const { unmount } = renderHook(() => useOrdersRealtimeSync({
      userId: "user-1",
      scope: "quote",
      refreshOrders,
    }));
    await flushConnection();

    expect(supabase.realtime.setAuth).toHaveBeenCalledTimes(1);
    expect(supabase.channel).toHaveBeenCalledWith(
      "orders:user:user-1",
      { config: { private: true } }
    );
    expect(supabase.channel).toHaveBeenCalledWith("orders-fallback:quote:user-1");

    act(() => {
      channels[0].handlers.broadcast();
      channels[1].handlers.postgres_changes();
      channels[0].statusCallback("SUBSCRIBED");
    });
    await act(async () => vi.advanceTimersByTimeAsync(75));

    expect(refreshOrders).toHaveBeenCalledTimes(1);
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(2);
  });

  it("keeps one trailing refresh while a reconciliation is in flight", async () => {
    const firstRefresh = deferred();
    const refreshOrders = vi.fn()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockResolvedValue();
    renderHook(() => useOrdersRealtimeSync({
      userId: "user-2",
      scope: "admin",
      refreshOrders,
    }));
    await flushConnection();

    act(() => channels[0].handlers.broadcast());
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(refreshOrders).toHaveBeenCalledTimes(1);

    act(() => channels[1].handlers.postgres_changes());
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(refreshOrders).toHaveBeenCalledTimes(1);

    await act(async () => firstRefresh.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(refreshOrders).toHaveBeenCalledTimes(2);
  });

  it("reconciles on focus, visibility and online recovery, then cleans listeners", async () => {
    const refreshOrders = vi.fn().mockResolvedValue();
    const { unmount } = renderHook(() => useOrdersRealtimeSync({
      userId: "user-3",
      scope: "delivery",
      refreshOrders,
    }));
    await flushConnection();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(75));
    expect(refreshOrders).toHaveBeenCalledTimes(1);

    unmount();
    act(() => window.dispatchEvent(new Event("online")));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(refreshOrders).toHaveBeenCalledTimes(1);
  });
});
