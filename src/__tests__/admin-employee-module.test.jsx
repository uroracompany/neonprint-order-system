import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(adminApiFetch).toHaveBeenCalledWith("/api/admin", expect.objectContaining({
      action: "employee-detail",
      userId: "employee-1",
    }));
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
    await user.click(screen.getByRole("button", { name: /Eliminar empleado/i }));

    expect(onEditUser).toHaveBeenCalledWith(profile);
    expect(onDeleteUser).toHaveBeenCalledWith(profile);
  });
});
