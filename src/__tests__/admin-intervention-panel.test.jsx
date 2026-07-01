import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminInterventionPanel from "../components/orders/AdminInterventionPanel";

const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({ supabase: { rpc, from } }));

const queryResult = (data) => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve({ data, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return query;
};

const externalOrderInSales = {
  id: "order-1",
  status: "Pending",
  order_design_type: "EXTERNAL_DESING",
  seller_id: "seller-1",
};

describe("AdminInterventionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation(async (name) => {
      if (name === "get_admin_order_action_availability") {
        return {
          data: {
            expected_updated_at: "2026-06-28T12:00:00.000Z",
            actions: [
              {
                key: "assign_seller",
                label: "Reasignada por Administración",
                allowed: true,
                blockers: [],
                target_role: "seller",
                requires_area_assignments: false,
              },
              {
                key: "route_sales",
                label: "Movida a Ventas por Administración",
                allowed: true,
                blockers: [],
                target_role: "seller",
                requires_area_assignments: false,
              },
              {
                key: "route_quote",
                label: "Movida a Caja por Administración",
                allowed: true,
                blockers: [],
                target_role: "quote",
                requires_area_assignments: false,
              },
              {
                key: "route_production",
                label: "Movida a Producción por Administración",
                allowed: false,
                blockers: [{ code: "not_in_quote", message: "La orden debe encontrarse en Caja." }],
                target_role: null,
                requires_area_assignments: true,
              },
            ],
          },
          error: null,
        };
      }
      if (name === "admin_intervene_order") {
        return { data: { id: "order-1", status: "in_Quote" }, error: null };
      }
      return { data: null, error: null };
    });
    from.mockImplementation((table) => {
      if (table === "profiles") {
        return queryResult([{ id: "quote-1", name: "Caja Uno", role: "quote", employment_status: true }]);
      }
      return queryResult([]);
    });
  });

  it("shows only Caja for an external order in Sales and allows leaving it unassigned", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AdminInterventionPanel order={externalOrderInSales} onChanged={onChanged} />);

    expect(await screen.findByRole("heading", { name: "Ajustes avanzados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar a Caja/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar vendedor/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar a Ventas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar a Producción/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Usuario de Caja/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enviar a Caja/ }));

    expect(screen.getByLabelText(/Usuario de Caja/)).toHaveValue("");
    expect(screen.getByRole("option", { name: "Sin asignar — lo gestiona Administración" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Motivo"), "workflow_correction");
    await user.type(screen.getByLabelText(/^Detalle/), "Corrección manual solicitada para mantener el flujo correcto.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Enviar a Caja" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_intervene_order", expect.objectContaining({
      p_order_id: "order-1",
      p_action: "route_quote",
      p_target_user_id: null,
      p_reason_category: "workflow_correction",
    })));
    expect(onChanged).toHaveBeenCalled();
  }, 15000);

  it("still lets Administration assign an active Caja user before confirming", async () => {
    const user = userEvent.setup();
    render(<AdminInterventionPanel order={externalOrderInSales} />);

    await user.click(await screen.findByRole("button", { name: /Enviar a Caja/ }));
    await user.selectOptions(screen.getByLabelText(/Usuario de Caja/), "quote-1");
    await user.selectOptions(screen.getByLabelText("Motivo"), "workflow_correction");
    await user.type(screen.getByLabelText(/^Detalle/), "Asignación directa al usuario responsable de Caja.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Enviar a Caja" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_intervene_order", expect.objectContaining({
      p_action: "route_quote",
      p_target_user_id: "quote-1",
    })));
  }, 15000);
});
