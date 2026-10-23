import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { orderResponses, queryCalls, silentRefresh, authUser, authProfile } = vi.hoisted(() => ({
  orderResponses: [],
  queryCalls: [],
  silentRefresh: { current: null },
  authUser: { id: "quote-user" },
  authProfile: { id: "quote-user", role: "quote", name: "Caja" },
}));

const makeBuilder = (table) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: null, error: null })),
    then(resolve, reject) {
      if (table === "orders") {
        queryCalls.push(table);
        const response = orderResponses.shift() ?? Promise.resolve({ data: [], error: null });
        return Promise.resolve(response).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return builder;
};

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn((table) => makeBuilder(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    user: authUser,
    profile: authProfile,
    signOut: vi.fn(),
  }),
}));

vi.mock("../hooks/useNotifications", () => ({
  default: () => ({
    notifications: [], unreadCount: 0, toasts: [],
    markAsRead: vi.fn(), markAllAsRead: vi.fn(), archive: vi.fn(), deleteNotification: vi.fn(), dismissToast: vi.fn(),
    showActionNotification: vi.fn(),
  }),
}));

vi.mock("../hooks/useOrderEventReviews", () => ({ default: () => ({ pendingByOrder: {} }) }));
vi.mock("../hooks/useOrderReturnHandoffs", () => ({ default: () => ({ acknowledgementByOrder: {}, incomingByOrder: {}, historyByOrder: {} }) }));
vi.mock("../hooks/useNewOrderAssignments", () => ({ default: () => ({ pendingByOrder: {}, acknowledgeOrder: vi.fn() }) }));
vi.mock("../hooks/useOrdersRealtimeSync", () => ({
  default: ({ refreshOrders }) => { silentRefresh.current = refreshOrders; },
}));

vi.mock("../components/Sidebar", () => ({ default: () => null }));
vi.mock("../components/NotificationCenter", () => ({ default: () => null }));
vi.mock("../components/designer/DesignerNotificationsModule", () => ({ default: () => null }));
vi.mock("../components/quote/QuoteProfileModule", () => ({ default: () => null }));
vi.mock("../components/orders/OrderReviewCard", () => ({ default: () => null }));
vi.mock("../components/orders/OrderReviewBadge", () => ({ default: () => null }));
vi.mock("../components/orders/NewOrderBadge", () => ({ default: () => null }));
vi.mock("../components/orders/returnToDesignerPresentation", () => ({ getReturnTargetLabel: () => "Diseño" }));
vi.mock("../components/orders/OrderReturnHandoff", () => ({
  OrderReturnHandoffPanel: () => null,
  ReturnedToCashierBadge: () => null,
}));
vi.mock("../components/orders/ReturnToDesignerModal", () => ({ default: () => null }));
vi.mock("../components/ui/ArchiveOrderModal", () => ({ default: () => null }));
vi.mock("../components/ui/PaymentFormModal", () => ({ default: () => null }));
vi.mock("../components/ui/SettleCreditModal", () => ({ default: () => null }));
vi.mock("../components/ui/ClientCombobox", () => ({ ClientFilterSelect: () => null, ClientSelect: () => null }));
vi.mock("../components/ui/FilterSelect", () => ({ FilterSelect: () => null }));
vi.mock("../components/ui/Pagination", () => ({ Pagination: () => null }));
vi.mock("../components/ui/Badge", () => ({ StatusBadge: () => null, PaymentBadge: () => null }));
vi.mock("../components/ui/SecureImage", () => ({ SecureImageLink: () => null }));

import PageQuote from "../pages/page-quote";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const order = (id, extra = {}) => ({
  id,
  quote_id: "quote-user",
  created_at: "2026-10-20T10:00:00.000Z",
  status: "in_Quote",
  payment_status: "Pending_Payment",
  order_type: "normal",
  client_name: `Cliente ${id}`,
  description: `Trabajo ${id}`,
  ...extra,
});

const ordersTable = () => {
  fireEvent.click(screen.getByRole("button", { name: "Gestionar Órdenes" }));
  return screen.getByText("Mis órdenes de caja");
};

beforeEach(() => {
  orderResponses.length = 0;
  queryCalls.length = 0;
  silentRefresh.current = null;
});

afterEach(() => cleanup());

describe("Caja order loading recovery", () => {
  it("renders assigned orders after a successful load", async () => {
    orderResponses.push(Promise.resolve({ data: [order("first")], error: null }));
    render(<PageQuote />);

    await waitFor(() => expect(screen.getByText("Cliente first")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Cargando órdenes...")).toBeNull();
  });

  it.each([
    ["returned Supabase errors", () => Promise.resolve({ data: null, error: new Error("permission denied") })],
    ["rejected Supabase queries", () => Promise.reject(new Error("network unavailable"))],
  ])("ends initial loading and offers retry after %s", async (_label, makeResponse) => {
    orderResponses.push(makeResponse());
    render(<PageQuote />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No se pudieron cargar las órdenes de Caja");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText("Cargando órdenes...")).toBeNull();
    expect(screen.queryByText("No hay órdenes asignadas actualmente.")).toBeNull();
  });

  it("preserves loaded rows after a failed refresh and replaces them on retry", async () => {
    orderResponses.push(Promise.resolve({ data: [order("old")], error: null }));
    render(<PageQuote />);
    await waitFor(() => expect(screen.getByText("Cliente old")).toBeTruthy());
    ordersTable();

    orderResponses.push(Promise.resolve({ data: null, error: new Error("temporary failure") }));
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Cliente old")).toBeTruthy();
    expect(screen.queryByText("No hay órdenes que coincidan con los filtros.")).toBeNull();

    orderResponses.push(Promise.resolve({ data: [order("new")], error: null }));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("Cliente new")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Cliente old")).toBeNull();
  });

  it("does not let an older response overwrite a newer request", async () => {
    const older = deferred();
    const newer = deferred();
    orderResponses.push(older.promise, newer.promise);
    render(<PageQuote />);
    await waitFor(() => expect(queryCalls.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    await waitFor(() => expect(queryCalls.length).toBe(2));

    newer.resolve({ data: [order("latest")], error: null });
    await waitFor(() => expect(screen.getByText("Cliente latest")).toBeTruthy());
    older.resolve({ data: [order("stale")], error: null });
    await waitFor(() => expect(screen.queryByText("Cliente stale")).toBeNull());
    expect(screen.getByText("Cliente latest")).toBeTruthy();
  });

  it("records silent refresh failures without showing the initial spinner or rejecting", async () => {
    orderResponses.push(Promise.resolve({ data: [order("stable")], error: null }));
    render(<PageQuote />);
    await waitFor(() => expect(screen.getByText("Cliente stable")).toBeTruthy());
    ordersTable();

    orderResponses.push(Promise.reject(new Error("realtime fetch failed")));
    await expect(silentRefresh.current()).resolves.toBeUndefined();
    await screen.findByRole("alert");
    expect(screen.queryByText("Cargando órdenes...")).toBeNull();
    expect(screen.getByText("Cliente stable")).toBeTruthy();
  });
});
