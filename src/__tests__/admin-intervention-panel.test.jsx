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
    is: () => query,
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

let catalogActions;

describe("AdminInterventionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogActions = [
      {
        key: "assign_seller",
        label: "Reasignar vendedor",
        requirements: { target_role: "seller", target_required: true, requires_area_assignments: false },
      },
      {
        key: "route_sales",
        label: "Regresar a Ventas",
        requirements: { target_role: "seller", target_required: true, requires_area_assignments: false },
      },
      {
        key: "route_quote",
        label: "Enviar a Caja",
        requirements: { target_role: "quote", target_required: false, requires_area_assignments: false },
      },
      {
        key: "route_production",
        label: "Enviar a Producción",
        requirements: { target_role: null, requires_area_assignments: true },
      },
    ];
    rpc.mockImplementation(async (name) => {
      if (name === "admin_get_order_command_catalog") {
        return {
          data: {
            expected_updated_at: "2026-06-28T12:00:00.000Z",
            actions: catalogActions,
          },
          error: null,
        };
      }
      if (name === "admin_execute_order_command") {
        return { data: { order: { id: "order-1", status: "in_Quote" } }, error: null };
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

  it("renders every action supplied by the catalogue for an external order and allows leaving Caja unassigned", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AdminInterventionPanel order={externalOrderInSales} onChanged={onChanged} />);

    expect(await screen.findByRole("heading", { name: "Ajustes avanzados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar a Caja/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reasignar vendedor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regresar a Ventas/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar a Producción/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Responsable de Caja/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enviar a Caja/ }));

    expect(screen.getByLabelText(/Responsable de Caja/)).toHaveValue("");
    expect(screen.getByRole("option", { name: "Sin asignar — lo gestiona Administración" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Motivo"), "workflow_correction");
    await user.type(screen.getByLabelText(/^Detalle/), "Corrección manual solicitada para mantener el flujo correcto.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Enviar a Caja" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_execute_order_command", expect.objectContaining({
      p_order_id: "order-1",
      p_action: "route_quote",
      p_payload: { target_user_id: null, area_assignments: {} },
      p_reason_category: "workflow_correction",
    })));
    expect(onChanged).toHaveBeenCalled();
  }, 15000);

  it("still lets Administration assign an active Caja user before confirming", async () => {
    const user = userEvent.setup();
    render(<AdminInterventionPanel order={externalOrderInSales} />);

    await user.click(await screen.findByRole("button", { name: /Enviar a Caja/ }));
    await user.selectOptions(screen.getByLabelText(/Responsable de Caja/), "quote-1");
    await user.selectOptions(screen.getByLabelText("Motivo"), "workflow_correction");
    await user.type(screen.getByLabelText(/^Detalle/), "Asignación directa al usuario responsable de Caja.");
    await user.click(screen.getByRole("button", { name: "Confirmar: Enviar a Caja" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_execute_order_command", expect.objectContaining({
      p_action: "route_quote",
      p_payload: { target_user_id: "quote-1", area_assignments: {} },
    })));
  }, 15000);

  it("does not present manage_files in this panel because the canonical modal owns that capability", async () => {
    catalogActions = [{
      key: "manage_files",
      label: "Gestionar archivos",
      requirements: { capability: "manage_files", capabilities: ["manage_design_assets"] },
    }];
    from.mockImplementation((table) => {
      if (table === "order_production_files") {
        return queryResult([{ id: "file-1", public_label: "Frente", status: "pending", production_area_code: "digital", updated_at: "file-version" }]);
      }
      return queryResult([]);
    });

    render(<AdminInterventionPanel order={externalOrderInSales} />);

    expect(await screen.findByRole("heading", { name: "Ajustes avanzados" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gestionar archivos/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Delivery para completar el último archivo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Iniciar producción|Enviar a terminación|Completar/ })).not.toBeInTheDocument();
  });
});
