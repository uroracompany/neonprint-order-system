import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAdvancedOrderModal from "../components/orders/AdminAdvancedOrderModal";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../supabaseClient", () => ({ supabase: { rpc, from } }));

const sampleOrder = {
  id: "abc12345",
  order_number: "ORD-001",
  status: "in_Quote",
  client_name: "Test Client",
  design_type: "EXTERNAL_DESING",
  quote_id: "user-1",
  updated_at: "order-server-1",
};

const productionOrder = { ...sampleOrder, status: "in_Production" };

const defaultProps = {
  open: false,
  order: null,
  profiles: [],
  onClose: vi.fn(),
  onRunAction: vi.fn(),
};

const mockDataSources = ({ files = [], areas = [], productionUsers = [] } = {}) => {
  from.mockImplementation((table) => {
    if (table === "orders") {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { order_production_files: files }, error: null }),
          }),
        }),
      };
    }
    if (table === "production_areas") {
      return { select: () => ({ eq: () => Promise.resolve({ data: areas, error: null }) }) };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          in: () => ({ eq: () => Promise.resolve({ data: productionUsers, error: null }) }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
};

const renderManageFiles = async ({ files, areas = [], productionUsers = [], profiles = [], rpcHandler }) => {
  mockDataSources({ files, areas, productionUsers });
  rpc.mockImplementation((name, params) => {
    if (name === "get_admin_order_actions") {
      return Promise.resolve({
        data: { design_type: "EXTERNAL_DESING", expected_updated_at: productionOrder.updated_at, actions: [{ key: "manage_files", label: "Gestionar archivos" }] },
        error: null,
      });
    }
    return rpcHandler?.(name, params) || Promise.resolve({ data: null, error: null });
  });
  const user = userEvent.setup();
  render(<AdminAdvancedOrderModal {...defaultProps} open order={productionOrder} profiles={profiles} />);
  await user.click(await screen.findByRole("button", { name: /Gestionar archivos/ }));
  return user;
};

describe("AdminAdvancedOrderModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDataSources();
    rpc.mockResolvedValue({ data: { design_type: "EXTERNAL_DESING", actions: [] }, error: null });
  });

  it("does not crash when order is null", () => {
    expect(() => render(<AdminAdvancedOrderModal {...defaultProps} />)).not.toThrow();
    expect(() => render(<AdminAdvancedOrderModal {...defaultProps} open />)).not.toThrow();
  });

  it("renders order details when order is valid", async () => {
    render(<AdminAdvancedOrderModal {...defaultProps} open order={sampleOrder} />);
    expect(await screen.findByText("Configuración avanzada")).toBeInTheDocument();
    expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
  });

  it("renders production actions", async () => {
    rpc.mockResolvedValue({
      data: { design_type: "EXTERNAL_DESING", actions: [
        { key: "return_to_quote", label: "Regresar a Caja" },
        { key: "reassign_production", label: "Reasignar Produccion" },
      ] },
      error: null,
    });
    render(<AdminAdvancedOrderModal {...defaultProps} open order={productionOrder} />);
    expect(await screen.findByText("Regresar a Caja")).toBeInTheDocument();
    expect(screen.getByText("Reasignar Producción")).toBeInTheDocument();
  });

  it("uses only per-file actions inside manage files", async () => {
    await renderManageFiles({
      files: [{ id: "file-1", public_label: "Frente", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "file-server-1" }],
    });

    expect(screen.getByText("Frente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar cambio" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Detalle")).not.toBeInTheDocument();
  });

  it("requires Delivery for the last file and reuses the server timestamp", async () => {
    const file = { id: "file-1", public_label: "Frente", status: "in_termination", production_area_code: "digital", assigned_to: "producer-1", updated_at: "file-server-1" };
    const user = await renderManageFiles({
      files: [file],
      profiles: [{ id: "delivery-1", name: "Delivery Uno", role: "delivery", employment_status: true }],
      rpcHandler: (name, params) => {
        if (name !== "admin_force_file_status") return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: { ...file, status: params.p_new_status, updated_at: params.p_new_status === "completed" ? "file-server-2" : "file-server-3" },
          error: null,
        });
      },
    });

    await user.selectOptions(screen.getByLabelText("Cambiar estado"), "completed");
    const saveButton = screen.getByRole("button", { name: "Guardar estado" });
    expect(saveButton).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Delivery para completar la orden (obligatorio)"), "delivery-1");
    await user.click(saveButton);

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_force_file_status", expect.objectContaining({
      p_file_id: "file-1",
      p_new_status: "completed",
      p_delivery_id: "delivery-1",
      p_expected_updated_at: "file-server-1",
      p_reason_category: "workflow_correction",
      p_reason_detail: "Cambio de estado por administrador desde Configuracion avanzada.",
    })));

    await user.selectOptions(screen.getByLabelText("Cambiar estado"), "in_termination");
    await user.click(screen.getByRole("button", { name: "Guardar estado" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_force_file_status", expect.objectContaining({
      p_new_status: "in_termination",
      p_expected_updated_at: "file-server-2",
      p_reason_category: "workflow_correction",
      p_reason_detail: "Cambio de estado por administrador desde Configuracion avanzada.",
    })));
  }, 15000);

  it("uses the file returned by the area reassignment RPC", async () => {
    const file = { id: "file-1", public_label: "Frente", status: "pending", production_area_code: "digital", assigned_to: "producer-1", updated_at: "file-server-1" };
    const user = await renderManageFiles({
      files: [file],
      areas: [
        { code: "digital", label: "Digital", producer_role: "production" },
        { code: "dtf", label: "DTF", producer_role: "dtf" },
      ],
      productionUsers: [{ id: "producer-2", name: "Productor DTF", role: "dtf", employment_status: true }],
      rpcHandler: (name) => name === "admin_reassign_file_production_area"
        ? Promise.resolve({ data: { ...file, production_area_code: "dtf", assigned_to: "producer-2", updated_at: "file-server-2" }, error: null })
        : Promise.resolve({ data: null, error: null }),
    });

    await user.selectOptions(screen.getByLabelText("Nueva área"), "dtf");
    await user.selectOptions(screen.getByLabelText("Nuevo responsable (obligatorio)"), "producer-2");
    await user.click(screen.getByRole("button", { name: "Guardar cambio de área" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_reassign_file_production_area", {
      p_file_id: "file-1",
      p_new_area_code: "dtf",
      p_new_assigned_user_id: "producer-2",
      p_expected_updated_at: "file-server-1",
    }));
    expect(await screen.findByText("DTF")).toBeInTheDocument();
  }, 15000);

  it("shows an add-file button and form inside manage_files", async () => {
    await renderManageFiles({
      files: [{ id: "file-1", public_label: "Frente", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "file-server-1" }],
      areas: [{ code: "digital", label: "Digital", producer_role: "production" }],
    });

    const addBtn = screen.getByRole("button", { name: /Anadir archivo/i });
    expect(addBtn).toBeInTheDocument();

    await userEvent.setup().click(addBtn);

    expect(screen.getByLabelText("Archivo")).toBeInTheDocument();
    expect(screen.getByLabelText("Etiqueta")).toBeInTheDocument();
    expect(screen.getByLabelText("Area de produccion")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Anadir archivo$/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Cancelar/i })).toHaveLength(2);
  });

  it("shows a delete-file button on each file card", async () => {
    await renderManageFiles({
      files: [
        { id: "file-1", public_label: "Frente", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "file-server-1" },
        { id: "file-2", public_label: "Dorso", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "file-server-2" },
      ],
    });

    const deleteButtons = screen.getAllByTitle("Eliminar archivo");
    expect(deleteButtons).toHaveLength(2);
  });

  it("shows a payment-locked notice and hides add/delete when order is in_Quote and pagado", async () => {
    const quoteOrder = { ...sampleOrder, status: "in_Quote", payment_status: "pagado", id: "quote-paid-1" };

    mockDataSources({ files: [{ id: "f1", public_label: "File", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "ts" }] });
    rpc.mockResolvedValue({
      data: { design_type: "EXTERNAL_DESING", expected_updated_at: "ts", actions: [{ key: "manage_files", label: "Gestionar archivos" }] },
      error: null,
    });

    const user = userEvent.setup();
    const { rerender } = render(<AdminAdvancedOrderModal {...defaultProps} open order={quoteOrder} />);
    await user.click(await screen.findByRole("button", { name: /Gestionar archivos/ }));

    expect(screen.getByText(/pago esta completo/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anadir archivo/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Eliminar archivo")).not.toBeInTheDocument();
  });

  it("hides delete button on the last file from in_Quote onwards", async () => {
    await renderManageFiles({
      files: [{ id: "f1", public_label: "Unico", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "ts" }],
    });

    expect(screen.queryByTitle("Eliminar archivo")).not.toBeInTheDocument();
  });

  it("shows delete button on the last file when status is before in_Quote", async () => {
    const designOrder = { ...sampleOrder, status: "in_Design", id: "design-order-1" };

    mockDataSources({ files: [{ id: "f1", public_label: "Unico", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "ts" }] });
    rpc.mockResolvedValue({
      data: { design_type: "EXTERNAL_DESING", expected_updated_at: "ts", actions: [{ key: "manage_files", label: "Gestionar archivos" }] },
      error: null,
    });

    const user = userEvent.setup();
    render(<AdminAdvancedOrderModal {...defaultProps} open order={designOrder} />);
    await user.click(await screen.findByRole("button", { name: /Gestionar archivos/ }));

    expect(screen.getByTitle("Eliminar archivo")).toBeInTheDocument();
  });

  it("hides preview trash button when preview_image is saved and order is from in_Quote onwards", async () => {
    const quoteOrder = { ...sampleOrder, status: "in_Quote", preview_image: "https://example.com/preview.jpg", id: "quote-preview-1" };

    mockDataSources({ files: [{ id: "f1", public_label: "File", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "ts" }] });
    rpc.mockResolvedValue({
      data: { design_type: "EXTERNAL_DESING", expected_updated_at: "ts", actions: [{ key: "manage_files", label: "Gestionar archivos" }] },
      error: null,
    });

    const user = userEvent.setup();
    render(<AdminAdvancedOrderModal {...defaultProps} open order={quoteOrder} />);
    await user.click(await screen.findByRole("button", { name: /Gestionar archivos/ }));

    expect(screen.queryByTitle("Quitar imagen")).not.toBeInTheDocument();
  });

  it("shows preview trash button when status is before in_Quote even with saved preview", async () => {
    const designOrder = { ...sampleOrder, status: "in_Design", preview_image: "https://example.com/preview.jpg", id: "design-preview-1" };

    mockDataSources({ files: [{ id: "f1", public_label: "File", status: "pending", production_area_code: "digital", assigned_to: null, updated_at: "ts" }] });
    rpc.mockResolvedValue({
      data: { design_type: "EXTERNAL_DESING", expected_updated_at: "ts", actions: [{ key: "manage_files", label: "Gestionar archivos" }] },
      error: null,
    });

    const user = userEvent.setup();
    render(<AdminAdvancedOrderModal {...defaultProps} open order={designOrder} />);
    await user.click(await screen.findByRole("button", { name: /Gestionar archivos/ }));

    expect(screen.getByTitle("Quitar imagen")).toBeInTheDocument();
  });
});
