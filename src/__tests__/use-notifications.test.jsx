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
const secondUserId = "22222222-2222-4222-8222-222222222222";

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

const setupSupabase = ({ persistedNotification = makeNotification(), notificationRows = [], notificationResults = null } = {}) => {
  const subscriptions = {};
  const queuedNotificationResults = Array.isArray(notificationResults) ? [...notificationResults] : null;
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
    const resolveLimit = () => {
      if (queuedNotificationResults?.length) {
        return queuedNotificationResults.shift();
      }
      return Promise.resolve({ data: notificationRows, error: null });
    };

    const builder = {
      select: vi.fn(() => builder),
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      or: vi.fn(() => builder),
      is: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(resolveLimit),
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

  it("filters archived and deleted notifications on initial load", async () => {
    setupSupabase({
      notificationRows: [
        makeNotification({ id: "active-notification" }),
        makeNotification({ id: "archived-notification", is_archived: true }),
        makeNotification({ id: "deleted-notification", deleted_at: "2026-06-17T13:00:00Z" }),
      ],
    });

    const { result } = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });
    expect(result.current.notifications[0].id).toBe("active-notification");
    expect(result.current.unreadCount).toBe(1);
  });

  it("keeps an archived notification hidden after remounting the hook", async () => {
    supabase.rpc.mockResolvedValue({ data: 1, error: null });
    setupSupabase({ notificationRows: [makeNotification()] });
    const first = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(first.result.current.notifications).toHaveLength(1);
    });

    await act(async () => {
      await first.result.current.archive("notification-1");
    });
    expect(first.result.current.notifications).toHaveLength(0);
    first.unmount();

    setupSupabase({ notificationRows: [makeNotification({ is_archived: true })] });
    const second = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(second.result.current.loading).toBe(false);
    });
    expect(second.result.current.notifications).toHaveLength(0);
  });

  it("keeps a deleted notification hidden after remounting the hook", async () => {
    supabase.rpc.mockResolvedValue({ data: 1, error: null });
    setupSupabase({ notificationRows: [makeNotification()] });
    const first = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(first.result.current.notifications).toHaveLength(1);
    });

    await act(async () => {
      await first.result.current.deleteNotification("notification-1");
    });
    expect(first.result.current.notifications).toHaveLength(0);
    first.unmount();

    setupSupabase({ notificationRows: [makeNotification({ deleted_at: "2026-06-17T13:00:00Z" })] });
    const second = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(second.result.current.loading).toBe(false);
    });
    expect(second.result.current.notifications).toHaveLength(0);
  });

  it("clears visible notifications immediately when the authenticated user changes", async () => {
    setupSupabase({ notificationRows: [makeNotification()] });
    const { result, rerender } = renderHook(({ id }) => useNotifications(id), {
      initialProps: { id: userId },
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });
    expect(result.current.unreadCount).toBe(1);

    setupSupabase({ notificationRows: [] });
    rerender({ id: secondUserId });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
    });
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.toasts).toHaveLength(0);
  });

  it("ignores stale notification loads from a previous authenticated user", async () => {
    const staleLoad = deferred();
    setupSupabase({
      notificationResults: [
        staleLoad.promise,
        Promise.resolve({ data: [], error: null }),
      ],
    });

    const { result, rerender } = renderHook(({ id }) => useNotifications(id), {
      initialProps: { id: userId },
    });

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalled();
    });

    rerender({ id: secondUserId });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notifications).toHaveLength(0);

    await act(async () => {
      staleLoad.resolve({ data: [makeNotification()], error: null });
      await staleLoad.promise;
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it("ignores realtime inserts that are already archived or deleted", async () => {
    const { subscriptions } = setupSupabase();
    const { result } = renderHook(() => useNotifications(userId));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      subscriptions.INSERT({ new: makeNotification({ is_archived: true }) });
      subscriptions.INSERT({
        new: makeNotification({
          id: "deleted-notification",
          deleted_at: "2026-06-17T13:00:00Z",
        }),
      });
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.toasts).toHaveLength(0);
  });

  it("removes notifications and toasts when realtime marks them archived or deleted", async () => {
    const { subscriptions } = setupSupabase();
    const { result } = renderHook(() => useNotifications(userId));

    act(() => {
      subscriptions.INSERT({ new: makeNotification() });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.toasts).toHaveLength(1);
    });

    act(() => {
      subscriptions.UPDATE({ new: makeNotification({ is_archived: true }) });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.toasts).toHaveLength(0);
    });

    act(() => {
      subscriptions.INSERT({ new: makeNotification({ id: "notification-2" }) });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.toasts).toHaveLength(1);
    });

    act(() => {
      subscriptions.UPDATE({
        new: makeNotification({
          id: "notification-2",
          deleted_at: "2026-06-17T13:00:00Z",
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.toasts).toHaveLength(0);
    });
  });
});
