import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AdminClientsModule from "../components/clients/AdminClientsModule";

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
    onCreateOrder: vi.fn(),
    onViewOrders: vi.fn(),
    onManageCredit: vi.fn(),
  };
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
    expect(supabase.rpc).toHaveBeenCalledWith("admin_list_clients", expect.objectContaining({
      p_page: 1,
      p_page_size: 7,
    }));
  });

  it("combina búsqueda y filtros en la consulta y vuelve a la primera página", async () => {
    const user = userEvent.setup();
    const { supabase } = renderModule();
    await screen.findByText("Cliente 1");

    await user.type(screen.getByLabelText("Buscar clientes"), "María");
    await user.selectOptions(screen.getByLabelText("Crédito"), "with_credit");

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenLastCalledWith("admin_list_clients", expect.objectContaining({
        p_page: 1,
        p_search: "María",
        p_credit_filter: "with_credit",
      }));
    });
  });

  it("abre el subapartado integrado y expone sus acciones rápidas", async () => {
    const user = userEvent.setup();
    const { props, supabase } = renderModule();
    await user.click(await screen.findByText("Cliente 1"));

    expect(await screen.findByRole("heading", { name: "Cliente 1" })).toBeInTheDocument();
    expect(screen.getByText("Información personal")).toBeInTheDocument();
    expect(screen.getByText("Resumen comercial")).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("admin_get_client_detail", {
      p_client_id: listRows[0].id,
    });

    await user.click(screen.getByRole("button", { name: "Nueva orden" }));
    expect(props.onCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ id: listRows[0].id }));

    await user.click(screen.getByRole("button", { name: "Volver a clientes" }));
    expect(await screen.findByText("Clientes registrados")).toBeInTheDocument();
  });
});

