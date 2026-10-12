import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { adminApiFetch } from "../utils/adminApi";
import AdminClientsModule from "../components/clients/AdminClientsModule";

vi.setConfig({ testTimeout: 15000 });

vi.mock("../utils/adminApi", () => ({ adminApiFetch: vi.fn() }));

vi.mock("recharts", () => {
  const Container = ({ children }) => <svg>{children}</svg>;
  const Empty = () => null;
  return { ResponsiveContainer: Container, AreaChart: Container, PieChart: Container, Area: Empty, CartesianGrid: Empty, Cell: Empty, Pie: Empty, Tooltip: Empty, XAxis: Empty, YAxis: Empty };
});

const makeClient = (index, overrides = {}) => ({
  id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  name: `Cliente ${index}`,
  phone: `809-555-${String(index).padStart(4, "0")}`,
  email: `cliente${index}@example.com`,
  address: "Santo Domingo",
  notes: null,
  created_at: "2026-01-01T12:00:00Z",
  updated_at: "2026-01-02T12:00:00Z",
  total_orders: index,
  active_orders: index === 1 ? 1 : 0,
  completed_orders: index >= 5 ? 5 : index,
  cancelled_orders: 0,
  last_order_at: "2026-01-02T12:00:00Z",
  active_credit_count: 0,
  credit_history_count: 0,
  settled_credit_count: 0,
  oldest_pending_credit_at: null,
  is_frequent: index >= 5,
  is_inactive: false,
  total_count: 9,
  ...overrides,
});

const listRows = Array.from({ length: 7 }, (_, index) => makeClient(index + 1));

const detailResponse = {
  client: makeClient(1),
  stats: {
    total_orders: 3,
    urgent_911_orders: 1,
    normal_orders: 2,
    internal_design_orders: 2,
    external_design_orders: 1,
    active_orders: 1,
    completed_orders: 2,
    cancelled_orders: 0,
    last_order_at: "2026-02-01T12:00:00Z",
    active_credit_count: 1,
    credit_history_count: 2,
    settled_credit_count: 1,
    oldest_pending_credit_at: "2026-01-15T12:00:00Z",
    is_frequent: false,
    is_inactive: false,
  },
  recent_orders: [{
    id: "11111111-1111-1111-1111-111111111111",
    invoice_number: "FAC-001",
    status: "in_Production",
    payment_status: "Pending_Payment",
    created_at: "2026-02-01T12:00:00Z",
  }],
};

const orderListResponse = [{
  id: "11111111-1111-1111-1111-111111111111",
  invoice_number: "FAC-001",
  description: "Pedido de prueba",
  status: "in_Production",
  payment_status: "Pending_Payment",
  created_at: "2026-02-01T12:00:00Z",
  updated_at: "2026-02-01T12:00:00Z",
  total_count: 1,
}];

const workspaceResponse = {
  client: {
    client_id: listRows[0].id,
    client_name: listRows[0].name,
    total_orders: 3,
    cancelled_orders: 0,
    normal_orders: 2,
    urgent_911_orders: 1,
    internal_design_orders: 2,
    external_design_orders: 1,
    cancel_rate: 0,
    avg_orders_per_month: 1.5,
    activity: "Media",
    health_score: 71,
    health: "Buena",
    payment: { credit_active: 1, partial_active: 0, pending_active: 0 },
    monthly_activity: [{ month: "2026-01", orders: 2 }, { month: "2026-02", orders: 1 }],
  },
};

const createSupabaseMock = () => ({
  rpc: vi.fn(async (name) => {
    if (name === "admin_get_client_detail") return { data: detailResponse, error: null };
    if (name === "admin_list_client_orders") return { data: orderListResponse, error: null };
    return { data: listRows, error: null };
  }),
});

const renderModule = (supabase = createSupabaseMock()) => {
  const props = {
    supabase,
    refreshKey: "initial",
    deletingClientId: null,
    onAddClient: vi.fn(),
    onEditClient: vi.fn(),
    onDeleteClient: vi.fn(),
    onRestoreClient: vi.fn(),
    onCreateOrder: vi.fn(),
    onViewOrders: vi.fn(),
    onManageCredit: vi.fn(),
  };
  adminApiFetch.mockImplementation(async (_path, payload) => {
    const source = listRows.find((client) => client.id === payload?.client_id) || listRows[0];
    return {
      response: { ok: true, status: 200 },
      result: { client: { ...workspaceResponse.client, client_id: source.id, client_name: source.name } },
    };
  });
  return { ...render(<AdminClientsModule {...props} />), props, supabase };
};

describe("AdminClientsModule", () => {
  it("solicita exactamente siete clientes y muestra el total paginado", async () => {
    const { supabase } = renderModule();

    expect(await screen.findByText("Cliente 1")).toBeInTheDocument();
    expect(screen.getByText("Cliente 7")).toBeInTheDocument();
    expect(screen.getByText("9 resultados")).toBeInTheDocument();
    expect(screen.queryByText(/Mostrando/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/por página/i)).not.toBeInTheDocument();
    const sortSelect = screen.getByRole("button", { name: "Ordenar por" });
    expect(sortSelect.querySelector(".pp-filter-select-icon")).toBeInTheDocument();
    expect(sortSelect.lastElementChild?.tagName).toBe("svg");
    expect(screen.getByText("Registro desde")).toBeInTheDocument();
    expect(screen.getByText("Registro hasta")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("admin_list_clients_v2", expect.objectContaining({
      p_page: 1,
      p_page_size: 7,
    }));
  });

  it("combina búsqueda y filtros en la consulta y vuelve a la primera página", async () => {
    const user = userEvent.setup();
    const { supabase } = renderModule();
    await screen.findByText("Cliente 1");

    await user.type(screen.getByLabelText("Buscar clientes"), "María");
    await user.click(screen.getByRole("button", { name: "Crédito" }));
    await user.click(screen.getByRole("option", { name: "Con crédito" }));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenLastCalledWith("admin_list_clients_v2", expect.objectContaining({
        p_page: 1,
        p_search: "María",
        p_credit_filter: "with_credit",
      }));
    });
  });

  it("abre el modal KPI desde la fila y el ojo con una consulta individual", async () => {
    const { supabase } = renderModule();
    fireEvent.click(await screen.findByText("Cliente 1"));
    expect(adminApiFetch).toHaveBeenCalled();

    expect(await screen.findByRole("dialog")).toHaveTextContent("911 vs. normal");
    expect(screen.getByRole("dialog")).toHaveTextContent("Estados de pago activos");
    expect(screen.queryByText("Información personal")).not.toBeInTheDocument();
    expect(adminApiFetch).toHaveBeenCalledWith("/api/kpi-data", {
      action: "client_workspace_detail",
      client_id: listRows[0].id,
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith("admin_get_client_detail", expect.anything());
  });

  it("abre el mismo modal desde el ojo sin cambiar de vista", async () => {
    renderModule();
    const eye = await screen.findByRole("button", { name: `Ver estadísticas de ${listRows[1].name}` });
    eye.focus();
    fireEvent.click(eye);
    expect(await screen.findByRole("dialog")).toHaveTextContent("911 vs. normal");
    expect(adminApiFetch).toHaveBeenCalledWith("/api/kpi-data", {
      action: "client_workspace_detail",
      client_id: listRows[1].id,
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(eye);
  });

  it("muestra error y permite reintentar la carga individual", async () => {
    renderModule();
    adminApiFetch.mockRejectedValueOnce(new Error("Servicio no disponible"));
    fireEvent.click(await screen.findByRole("button", { name: `Ver estadísticas de ${listRows[0].name}` }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Servicio no disponible");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Estados de pago activos");
  });

  it("conserva las acciones operativas en el menú separado", async () => {
    const { props } = renderModule();
    await screen.findByText("Cliente 1");

    fireEvent.click(screen.getByRole("button", { name: `Más acciones de ${listRows[0].name}` }));
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Nueva orden" }));
    expect(props.onCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ id: listRows[0].id }));
  });

  it("coloca el menú después del zafacón y usa un icono de despliegue", async () => {
    renderModule();
    await screen.findByText("Cliente 1");
    const row = within(screen.getAllByRole("row")[1]);
    const actions = row.getAllByRole("button").filter((action) => action.getAttribute("aria-label"));

    expect(actions.map((action) => action.getAttribute("aria-label"))).toEqual([
      `Ver estadísticas de ${listRows[0].name}`,
      `Editar ${listRows[0].name}`,
      `Eliminar ${listRows[0].name}`,
      `Más acciones de ${listRows[0].name}`,
    ]);
    expect(actions[3].querySelector("polyline")).toBeInTheDocument();
  });

  it("cierra el menú al pulsar fuera o presionar Escape", async () => {
    renderModule();
    const summary = await screen.findByRole("button", { name: `Más acciones de ${listRows[0].name}` });
    const details = summary.closest("details");

    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(details).not.toHaveAttribute("open"));

    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(details).not.toHaveAttribute("open"));
  });

  it("muestra al cliente retirado y solo permite restaurarlo", async () => {
    const user = userEvent.setup();
    const retiredClient = makeClient(8, {
      deleted_at: "2026-08-31T12:00:00Z",
      total_count: 1,
    });
    const supabase = {
      rpc: vi.fn(async (name) => {
        if (name === "admin_list_clients_v2") return { data: [retiredClient], error: null };
        if (name === "admin_get_client_detail") return { data: { ...detailResponse, client: retiredClient }, error: null };
        return { data: orderListResponse, error: null };
      }),
    };
    const { props } = renderModule(supabase);

    expect(await screen.findByText("Dado de baja")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Editar ${retiredClient.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Eliminar ${retiredClient.name}` })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Restaurar ${retiredClient.name}` }));
    expect(props.onRestoreClient).toHaveBeenCalledWith(retiredClient);
  });
});
