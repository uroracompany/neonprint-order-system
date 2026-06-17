import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useNotifications from "../hooks/useNotifications";
import { supabase } from "../../supabaseClient";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const userId = "11111111-1111-4111-8111-111111111111";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const makeNotification = (overrides = {}) => ({
  id: "notification-1",
  user_id: userId,
  type: "info",
  title: "Cliente registrado",
  message: 'Cliente "Acme" registrado correctamente.',
  order_id: null,
  metadata: { event_kind: "client_created", client_id: "client-1", variant: "success", order_title: null },
  created_at: new Date("2026-06-17T12:00:00Z").toISOString(),
  is_read: false,
  is_archived: false,
  deleted_at: null,
  ...overrides,
});

const setupSupabase = ({ persistedNotification = makeNotification() } = {}) => {
  const subscriptions = {};
  const channel = {
    on: vi.fn((event, filter, callback) => {
      subscriptions[filter.event] = callback;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };

  supabase.channel.mockReturnValue(channel);
  supabase.removeChannel.mockResolvedValue({});
  supabase.from.mockImplementation(() => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      or: vi.fn(() => builder),
      is: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({ data: [], error: null })),
      single: vi.fn(async () => ({ data: persistedNotification, error: null })),
    };
    return builder;
  });

  return { subscriptions };
};

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupabase();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an optimistic toast immediately and does not duplicate it after persistence", async () => {
    const rpcRequest = deferred();
    supabase.rpc.mockReturnValue(rpcRequest.promise);
    const { result } = renderHook(() => useNotifications(userId));

    let actionPromise;
    act(() => {
      actionPromise = result.current.showActionNotification({
        type: "info",
        title: "Cliente registrado",
        message: 'Cliente "Acme" registrado correctamente.',
        metadata: { event_kind: "client_created", client_id: "client-1", variant: "success" },
      });
    });

    await waitFor(() => {
      expect(result.current.toasts).toHaveLength(1);
    });
    expect(result.current.toasts[0].id).toMatch(/^local-toast-/);
    expect(result.current.toasts[0].metadata.variant).toBe("success");

    await act(async () => {
      rpcRequest.resolve({ data: "notification-1", error: null });
      await actionPromise;
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });
    expect(result.current.notifications[0].id).toBe("notification-1");
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toMatch(/^local-toast-/);
  });

  it("keeps the optimistic toast visible when notification persistence fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "RPC failed" } });
    const { result } = renderHook(() => useNotifications(userId));

    await act(async () => {
      await result.current.showActionNotification({
        type: "info",
        title: "Cliente registrado",
        message: 'Cliente "Acme" registrado correctamente.',
        metadata: { event_kind: "client_created", client_id: "client-1", variant: "success" },
      });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toMatch(/^local-toast-/);
    expect(result.current.notifications).toHaveLength(0);
  });
});
