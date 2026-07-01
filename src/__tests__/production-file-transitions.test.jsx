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
  status: ORDER_STATUS.IN_PRODUCTION,
  payment_status: "pagado",
  client_name: "Cliente Demo",
  description: "Orden demo",
  order_type: "normal",
};

const makeFile = (id, status = PRODUCTION_FILE_STATUS.IN_PRODUCTION) => ({
  id,
  url: `https://example.com/${id}.pdf`,
  filename: `${id}.pdf`,
  production_area_code: "ploteo",
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

describe("production file state transitions", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.rpc.mockImplementation(async (fnName) => {
      if (fnName === "will_complete_production_order") return { data: false, error: null };
      return { data: {}, error: null };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows Terminacion button for files in production", () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.IN_PRODUCTION)],
    });

    expect(screen.getByTitle("Marcar en terminación")).toBeInTheDocument();
    expect(screen.queryByTitle("Marcar completado")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Volver a producción")).not.toBeInTheDocument();
  });

  it("shows Volver a produccion and Completado buttons for files in termination", () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.IN_TERMINATION)],
    });

    expect(screen.getByTitle("Volver a producción")).toBeInTheDocument();
    expect(screen.getByTitle("Marcar completado")).toBeInTheDocument();
    expect(screen.queryByTitle("Marcar en terminación")).not.toBeInTheDocument();
  });

  it("shows no action buttons for completed files", () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.COMPLETED)],
    });

    expect(screen.queryByTitle("Marcar en terminación")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Marcar completado")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Volver a producción")).not.toBeInTheDocument();
  });

  it("calls update_production_file_status with in_production when clicking Volver a produccion", async () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.IN_TERMINATION)],
    });

    fireEvent.click(screen.getByTitle("Volver a producción"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-1",
        p_next_status: PRODUCTION_FILE_STATUS.IN_PRODUCTION,
      });
    });
  });

  it("calls update_production_file_status with completed when clicking Completado", async () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.IN_TERMINATION)],
    });

    fireEvent.click(screen.getByTitle("Marcar completado"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-1",
        p_next_status: PRODUCTION_FILE_STATUS.COMPLETED,
      });
    });
  });

  it("calls update_production_file_status with in_termination when clicking Terminacion", async () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [makeFile("file-1", PRODUCTION_FILE_STATUS.IN_PRODUCTION)],
    });

    fireEvent.click(screen.getByTitle("Marcar en terminación"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("update_production_file_status", {
        p_file_id: "file-1",
        p_next_status: PRODUCTION_FILE_STATUS.IN_TERMINATION,
      });
    });
  });

  it("shows label text alongside icons in action buttons", () => {
    renderProductionModal({
      ...baseOrder,
      order_production_files: [
        makeFile("file-1", PRODUCTION_FILE_STATUS.IN_PRODUCTION),
        makeFile("file-2", PRODUCTION_FILE_STATUS.IN_TERMINATION),
      ],
    });

    expect(screen.getByText("Terminación")).toBeInTheDocument();
    expect(screen.getByText("Volver a producción")).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
  });
});
