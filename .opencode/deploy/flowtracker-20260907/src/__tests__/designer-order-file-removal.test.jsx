import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetailModal } from "../pages/page-designer.jsx";
import { ORDER_STATUS } from "../utils/constants";

const { rpc, resolveOrderAssetUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveOrderAssetUrl: vi.fn(),
}));

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
      })),
    })),
    rpc,
  },
}));

vi.mock("../utils/fileAccess", () => ({
  resolveOrderAssetUrl,
  openOrderAssetUrl: vi.fn(),
  requiresOrderAssetGateway: () => false,
}));

const order = {
  id: "57aacf7a-0e05-4dd0-9f97-77911fd03bd9",
  created_at: "2026-08-29T10:00:00.000Z",
  updated_at: "2026-08-29T10:00:00.000Z",
  status: ORDER_STATUS.IN_DESIGN,
  client_name: "Cliente de prueba",
  client_contact: "8090000000",
  description: "Orden de prueba",
  material: "Vinilo",
  order_type: "normal",
  seller_name: "Vendedor de prueba",
  preview_image: "https://example.test/preview.webp",
  order_file_url: JSON.stringify(["https://example.test/archivo.pdf"]),
  order_production_files: [{
    id: "63b8ab44-3ece-4dc8-8f3c-4f8dd13f6053",
    order_id: "57aacf7a-0e05-4dd0-9f97-77911fd03bd9",
    url: "https://example.test/archivo.pdf",
  }],
};

function renderModal(nextOrder = order, onRefresh = vi.fn()) {
  return {
    onRefresh,
    ...render(
      <OrderDetailModal
        onClose={() => {}}
        order={nextOrder}
        designerFiles={[]}
        designerPreview={nextOrder.preview_image}
        onRefresh={onRefresh}
        onSendToQuotation={() => {}}
        quotationSending={false}
      />,
    ),
  };
}

describe("Designer OrderDetailModal file removal", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    resolveOrderAssetUrl.mockReset();
    resolveOrderAssetUrl.mockResolvedValue("https://signed.example.test/preview.webp");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes only the selected persisted file through the versioned designer RPC", async () => {
    const { onRefresh } = renderModal();

    fireEvent.click(screen.getByTitle("Eliminar archivo"));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("designer_remove_order_file", {
        p_order_id: order.id,
        p_file_id: order.order_production_files[0].id,
        p_expected_updated_at: order.updated_at,
      });
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Archivo eliminado de la orden correctamente.")).toBeInTheDocument();
  });

  it("does not offer removal after the order leaves Diseño", () => {
    renderModal({ ...order, status: ORDER_STATUS.IN_QUOTE });

    expect(screen.queryByTitle("Eliminar archivo")).not.toBeInTheDocument();
  });
});
