import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminEmployeeModule from "../components/employees/AdminEmployeeModule";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({ adminApiFetch: vi.fn() }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const profile = {
  id: "employee-1",
  name: "Ana Operaciones",
  email: "ana@example.com",
  role: "seller",
  employment_status: true,
  created_at: "2026-07-01T00:00:00.000Z",
};

const teamData = {
  general: {
    summary: { total_orders: 12, active_orders: 4, completed_orders: 7, delivered_orders: 5, cancelled_orders: 1 },
    comparison: {},
    trend: { granularity: "day", points: [{ date: "2026-07-01", sales: 2, design: 1, production: 3, total: 6 }] },
    department_breakdown: [{ key: "sales", label: "Ventas", value: 12 }],
  },
  sales: { summary: { total_orders: 12, active_orders: 4, completed_orders: 7, delivered_orders: 5, cancelled_orders: 1 }, comparison: {}, trend: { points: [] }, ranking: [{ id: "employee-1", name: "Ana Operaciones", role: "seller", completed: 7, total: 12, completion_rate: 58.3, rank: 1 }] },
  design: { summary: {}, comparison: {}, trend: { points: [] }, ranking: [] },
  production: {
    summary: {}, comparison: {}, trend: { points: [] }, areas: {
      digital: { label: "Digital", summary: { total_orders: 4, total_files: 5, completed: 3, active_files: 2, completion_rate: 60 }, trend: { granularity: "day", points: [{ date: "2026-07-01", production: 2 }] }, ranking: [] },
      dtf: { label: "DTF", summary: { total_orders: 2, total_files: 3, completed: 2, active_files: 1, completion_rate: 66.7 }, trend: { granularity: "day", points: [{ date: "2026-07-01", production: 1 }] }, ranking: [] },
      ploteo: { label: "Ploteo", summary: { total_orders: 1, total_files: 1, completed: 1, active_files: 0, completion_rate: 100 }, trend: { granularity: "day", points: [{ date: "2026-07-01", production: 1 }] }, ranking: [] },
    },
  },
};

describe("AdminEmployeeTeamModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    adminApiFetch.mockImplementation((_path, payload) => Promise.resolve({
      response: { ok: true },
      result: payload.action === "employee-team-performance" ? teamData : {
        metrics: { total_orders: 0, active_orders: 0, completed_orders: 0, delivered_orders: 0, cancelled_orders: 0 },
        productionMetrics: null,
        orders: [],
        total: 0,
      },
    }));
  });

  it("opens the team subview and calls the protected contract", async () => {
    const user = userEvent.setup();
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);

    await user.click(await screen.findByRole("button", { name: "Abrir estadísticas de equipo" }));
    expect(await screen.findByRole("heading", { name: "Desempeño por departamento" })).toBeInTheDocument();
    expect(adminApiFetch).toHaveBeenCalledWith("/api/admin", expect.objectContaining({ action: "employee-team-performance" }));

    await user.click(screen.getByRole("tab", { name: "Ventas" }));
    expect(screen.getByRole("heading", { name: "Vendedores" })).toBeInTheDocument();
    expect(screen.getByText("Ana Operaciones")).toBeInTheDocument();
  });

  it("compares all production areas without mixing the individual tabs", async () => {
    const user = userEvent.setup();
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);

    await user.click(await screen.findByRole("button", { name: "Abrir estadísticas de equipo" }));
    await user.click(screen.getByRole("tab", { name: "Producción" }));
    await user.click(screen.getByRole("tab", { name: "Todas las áreas" }));

    expect(screen.getByRole("heading", { name: "Órdenes y producción" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Áreas con mayor actividad" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Actividad por área" })).toBeInTheDocument();
  });

  it("returns to the employee detail without losing existing actions", async () => {
    const user = userEvent.setup();
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);
    await user.click(await screen.findByRole("button", { name: "Abrir estadísticas de equipo" }));
    await screen.findByRole("heading", { name: "Desempeño por departamento" });
    await user.click(screen.getByRole("button", { name: "Volver a empleado" }));
    expect(await screen.findByRole("button", { name: "Abrir estadísticas de equipo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar empleado/i })).toBeInTheDocument();
  });

  it("renders retry state when the team endpoint fails", async () => {
    adminApiFetch.mockImplementation((_path, payload) => Promise.resolve(payload.action === "employee-team-performance"
      ? { response: { ok: false, status: 500 }, result: { error: "Error de prueba" } }
      : { response: { ok: true }, result: { metrics: {}, productionMetrics: null, orders: [], total: 0 } }));
    const user = userEvent.setup();
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);
    await user.click(await screen.findByRole("button", { name: "Abrir estadísticas de equipo" }));
    expect(await screen.findByText("Error de prueba")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    await waitFor(() => expect(adminApiFetch).toHaveBeenCalledWith("/api/admin", expect.objectContaining({ action: "employee-team-performance" })));
  });
});
