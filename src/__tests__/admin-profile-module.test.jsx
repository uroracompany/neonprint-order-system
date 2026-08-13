import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminProfileModule from "../components/admin/AdminProfileModule";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({ adminApiFetch: vi.fn() }));
vi.mock("../hooks/useOrdersRealtimeSync", () => ({ default: vi.fn() }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart: ({ children }) => <div data-testid="activity-chart">{children}</div>,
  Line: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Bar: () => null,
  BarChart: ({ children }) => <div>{children}</div>,
}));

const profileResult = {
  profile: { id: "admin-1", name: "Ana Administracion", email: "ana@neonprint.test", role: "admin", employment_status: true, created_at: "2026-01-01T12:00:00Z" },
  period: { label: "Todo el historial" },
  metrics: { actions_registered: 8, orders_intervened: 4, orders_created: 2, last_activity_at: "2026-03-08T10:00:00Z" },
  analytics: {
    trend: [{ label: "08 mar", count: 2 }],
    action_types: [{ key: "order_updated", label: "Orden actualizada", count: 5 }],
    recent_activity: [{ id: "event-1", order_id: "12345678-0000", label: "Orden actualizada", detail: "Se ajusto la fecha de entrega.", created_at: "2026-03-08T10:00:00Z", details: { actor_name: "Ana Administracion", order: { id: "12345678-0000", client_name: "Cliente de prueba" }, old_status: "Pending", new_status: "in_Design", changed_fields: [{ field: "responsible", label: "Responsable", old_value: "7c020566-0000-4000-a000-000000000001", new_value: "7c020566-0000-4000-a000-000000000002" }] } }],
  },
};

describe("AdminProfileModule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra identidad y actividad administrativa real", async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: true }, result: profileResult });

    render(<AdminProfileModule authUser={{ id: "admin-1", email: "ana@neonprint.test" }} profile={profileResult.profile} />);

    expect(await screen.findByRole("heading", { name: "Ana Administracion" })).toBeInTheDocument();
    expect(screen.getByText("Acciones registradas")).toBeInTheDocument();
    expect(screen.getByText("Órdenes intervenidas")).toBeInTheDocument();
    expect(screen.getByText("Órdenes creadas")).toBeInTheDocument();
    expect(screen.getByText("Actividad administrativa reciente")).toBeInTheDocument();
    expect(screen.getByText("Se ajusto la fecha de entrega.")).toBeInTheDocument();
    expect(screen.getByTestId("activity-chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Periodo del perfil")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ver detalle: orden actualizada/i }));
    expect(screen.getByRole("dialog", { name: "Detalle de actividad" })).toBeInTheDocument();
    expect(screen.getByText("Cliente de prueba")).toBeInTheDocument();
    expect(screen.getAllByText("Responsable asignado")).toHaveLength(2);
  });

  it("muestra un error recuperable cuando no puede cargar la actividad", async () => {
    adminApiFetch.mockResolvedValue({ response: { ok: false }, result: { error: "Servicio no disponible" } });

    render(<AdminProfileModule authUser={{ id: "admin-1" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Servicio no disponible");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    });
    expect(adminApiFetch).toHaveBeenCalledTimes(2);
  });
});
