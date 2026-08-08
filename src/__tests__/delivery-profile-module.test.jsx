import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeliveryProfileModule from "../components/delivery/DeliveryProfileModule";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

vi.mock("../hooks/useOrdersRealtimeSync", async () => {
  const { useEffect } = await import("react");
  function useOrdersRealtimeSyncMock({ refreshOrders }) {
    useEffect(() => {
      void refreshOrders();
    }, [refreshOrders]);
  }

  return {
    default: useOrdersRealtimeSyncMock,
  };
});

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  BarChart: ({ children }) => <div>{children}</div>,
  Bar: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  Line: () => null,
  LineChart: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const profileResult = {
  profile: { id: "delivery-1", name: "Repartidor Uno" },
  metrics: {
    assigned_orders: 4,
    pending_delivery_orders: 2,
    delivered_orders: 1,
    overdue_orders: 1,
    cancelled_orders: 0,
    clients_served: 3,
    delivery_rate: 33.3,
  },
  analytics: {
    status_summary: { assigned: 4, pending: 2, delivered: 1, overdue: 1, cancelled: 0 },
    top_clients: [{ name: "Cliente Uno", count: 2, percentage: 100 }],
    trends: [],
  },
};

describe("DeliveryProfileModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completa la carga inicial aunque realtime solicite una recarga silenciosa", async () => {
    let resolveInitialRequest;
    adminApiFetch.mockImplementation(() => new Promise((resolve) => {
      resolveInitialRequest = resolve;
    }));

    render(<DeliveryProfileModule authUser={{ id: "delivery-1", email: "delivery@example.com" }} />);

    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledTimes(1));
    resolveInitialRequest({ response: { ok: true }, result: profileResult });

    expect(await screen.findByRole("heading", { name: "Repartidor Uno" })).toBeInTheDocument();
    expect(screen.queryByText("Cargando Mi Perfil...")).not.toBeInTheDocument();
    expect(screen.queryByText("Ordenes asignadas")).not.toBeInTheDocument();
    expect(screen.queryByText("Tasa de entrega")).not.toBeInTheDocument();
  });

  it("reserva las métricas del panel para la pestaña Delivery", () => {
    const pageSource = readFileSync(resolve("src/pages/page-delivery.jsx"), "utf8");

    expect(pageSource).toContain('{activeTab === "dashboard" && (\n            <div className="pd-summary-grid">');
    expect(pageSource).toContain('activeTab === "profile" ? "Mi Perfil"');
  });
});
