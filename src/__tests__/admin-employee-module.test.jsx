import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminEmployeeModule from "../components/employees/AdminEmployeeModule";
import { adminApiFetch } from "../utils/adminApi";

vi.mock("../utils/adminApi", () => ({
  adminApiFetch: vi.fn(),
}));

const profile = {
  id: "employee-1",
  name: "Ana Operaciones",
  email: "ana@example.com",
  role: "seller",
  employment_status: true,
  created_at: "2026-07-01T00:00:00.000Z",
};

describe("AdminEmployeeModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    adminApiFetch.mockResolvedValue({
      response: { ok: true },
      result: {
        profile,
        metrics: {
          total_orders: 12,
          active_orders: 5,
          completed_orders: 4,
          delivered_orders: 2,
          cancelled_orders: 1,
        },
        productionMetrics: null,
        analytics: {
          period: { date_from: "2026-07-01T00:00:00.000Z", date_to: "2026-08-01T00:00:00.000Z" },
          common: { total_orders: 12, active_orders: 5, completed_orders: 4, delivered_orders: 2, cancelled_orders: 1, completion_rate: 33.3, cancellation_rate: 8.3, last_activity_at: "2026-07-24T00:00:00.000Z" },
          role: "seller",
          roleMetrics: { normal_orders: 10, urgent_orders: 2, internal_design_orders: 8, external_design_orders: 4, avg_cycle_days: 2.5, pending_payment: 1, top_clients: [], top_materials: [] },
          trend: { granularity: "day", points: [] },
          alerts: [],
        },
        orders: [
          { id: "order-1", client_name: "Cliente Uno", invoice_number: "F001", status: "in_Completed", payment_status: "pagado", created_at: "2026-07-02T00:00:00.000Z" },
          { id: "order-2", client_name: "Cliente Dos", invoice_number: "F002", status: "in_Production", payment_status: "credito", created_at: "2026-07-01T00:00:00.000Z" },
        ],
        page: 1,
        pageSize: 7,
        total: 12,
      },
    });
  });

  it("renders metrics and orders from the employee-detail endpoint", async () => {
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);

    expect(await screen.findByText("Cliente Uno")).toBeInTheDocument();
    expect(screen.getByText("12 resultado" + "s")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(adminApiFetch).toHaveBeenCalledWith("/api/admin", expect.objectContaining({
      action: "employee-detail",
      userId: "employee-1",
      page: 1,
      pageSize: 1,
    }));
  });

  it("no renderiza el contenedor de analítica del empleado", async () => {
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);

    expect(screen.queryByText("Rendimiento del empleado")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Período")).not.toBeInTheDocument();
    expect(await screen.findByText("Cliente Uno")).toBeInTheDocument();
  });

  it("aplica el selector compartido al filtrar las órdenes del empleado", async () => {
    const user = userEvent.setup();
    render(<AdminEmployeeModule profile={profile} onBack={vi.fn()} currentUserId="admin-1" />);

    await screen.findByText("Cliente Uno");
    await user.click(screen.getByRole("button", { name: "Estado operativo" }));
    await user.click(screen.getByRole("option", { name: "Producción" }));

    await waitFor(() => {
      expect(adminApiFetch).toHaveBeenLastCalledWith("/api/admin", expect.objectContaining({
        action: "employee-detail",
        userId: "employee-1",
        status: "in_Production",
        paymentStatus: "all",
      }));
    });
  });

  it("keeps edit and delete callbacks wired from the detail view", async () => {
    const user = userEvent.setup();
    const onEditUser = vi.fn();
    const onDeleteUser = vi.fn();
    render(
      <AdminEmployeeModule
        profile={profile}
        onBack={vi.fn()}
        onEditUser={onEditUser}
        onDeleteUser={onDeleteUser}
        currentUserId="admin-1"
      />
    );

    await screen.findByText("Cliente Uno");
    await user.click(screen.getByRole("button", { name: /Editar empleado/i }));
    await user.click(screen.getByRole("button", { name: /Dar de baja/i }));

    expect(onEditUser).toHaveBeenCalledWith(profile);
    expect(onDeleteUser).toHaveBeenCalledWith(profile);
  });
});
