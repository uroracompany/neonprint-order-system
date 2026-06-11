import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetailModal } from "../pages/page-production.jsx";
import { ORDER_STATUS, PRODUCTION_FILE_STATUS } from "../utils/constants";
import { supabase } from "../../supabaseClient";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const baseOrder = {
  id: "12345678-1234-1234-1234-123456789abc",
  created_at: "2026-06-11T10:00:00.000Z",
  updated_at: "2026-06-11T10:00:00.000Z",
  status: ORDER_STATUS.IN_TERMINATION,
  payment_status: "pagado",
  client_name: "Cliente Demo",
  description: "Orden demo",
  material: "Vinilo",
  order_type: "normal",
  order_design_type: "INTERNAL_DESING",
};

const makeFile = (id, area, status = PRODUCTION_FILE_STATUS.IN_TERMINATION) => ({
  id,
  url: `https://example.com/${id}.pdf`,
  filename: `${id}.pdf`,
  production_area_code: area,
  status,
});

const renderProductionModal = (order) => render(
  <OrderDetailModal
    onClose={() => {}}
    order={order}
    producerRole="ploteo_producer"
    onUpdateStatus={() => {}}
  />
);

describe("Production last pending file confirmation", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not show the modal when another order file is still pending, even if it is outside the visible area", async () => {
    supabase.rpc.mockImplementation(async (fnName) => {
      if (fnName === "will_complete_production_order") {
        return { data: false, error: null };
      }
      if (fnName === "update_production_file_status") {
        return { data: { id: "file-ploteo" }, error: null };
      }
      return { data: null, error: null };
    });

    renderProductionModal({
      ...baseOrder,
      order_production_files: [
        makeFile("file-ploteo", "ploteo"),
      ],
    });

    fireEvent.click(screen.getByTitle("Marcar completado"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("will_complete_production_order", { p_file_id: "file-ploteo" });
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-ploteo",
        p_next_status: PRODUCTION_FILE_STATUS.COMPLETED,
      });
    });

    expect(screen.queryByText(/Finalizar orden/i)).not.toBeInTheDocument();
  });

  it("only shows the modal for the last pending file in a five-file order", async () => {
    const willCompleteResponses = [false, true];
    supabase.rpc.mockImplementation(async (fnName) => {
      if (fnName === "will_complete_production_order") {
        return { data: willCompleteResponses.shift(), error: null };
      }
      if (fnName === "update_production_file_status") {
        return { data: {}, error: null };
      }
      return { data: null, error: null };
    });

    const { rerender } = renderProductionModal({
      ...baseOrder,
      order_production_files: [
        makeFile("file-1", "digital", PRODUCTION_FILE_STATUS.COMPLETED),
        makeFile("file-2", "dtf", PRODUCTION_FILE_STATUS.COMPLETED),
        makeFile("file-3", "digital", PRODUCTION_FILE_STATUS.COMPLETED),
        makeFile("file-4", "ploteo"),
        makeFile("file-5", "ploteo"),
      ],
    });

    fireEvent.click(screen.getAllByTitle("Marcar completado")[0]);

    await waitFor(() => {
      expect(screen.queryByText(/Finalizar orden/i)).not.toBeInTheDocument();
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-4",
        p_next_status: PRODUCTION_FILE_STATUS.COMPLETED,
      });
    });

    rerender(
      <OrderDetailModal
        onClose={() => {}}
        order={{
          ...baseOrder,
          order_production_files: [
            makeFile("file-1", "digital", PRODUCTION_FILE_STATUS.COMPLETED),
            makeFile("file-2", "dtf", PRODUCTION_FILE_STATUS.COMPLETED),
            makeFile("file-3", "digital", PRODUCTION_FILE_STATUS.COMPLETED),
            makeFile("file-4", "ploteo", PRODUCTION_FILE_STATUS.COMPLETED),
            makeFile("file-5", "ploteo"),
          ],
        }}
        producerRole="ploteo_producer"
        onUpdateStatus={() => {}}
      />
    );

    fireEvent.click(screen.getByTitle("Marcar completado"));

    await waitFor(() => {
      expect(screen.getByText(/Finalizar orden/i)).toBeInTheDocument();
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByText("Confirmar y completar orden"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-5",
        p_next_status: PRODUCTION_FILE_STATUS.COMPLETED,
      });
    });
  });
});
