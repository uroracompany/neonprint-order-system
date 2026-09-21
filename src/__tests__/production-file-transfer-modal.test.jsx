import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductionFileTransferModal from "../components/production/ProductionFileTransferModal";
import { supabase } from "../../supabaseClient";

vi.mock("../../supabaseClient", () => ({
  supabase: { rpc: vi.fn() },
}));

const order = { id: "12345678-1234-1234-1234-123456789abc" };
const files = [
  { id: "file-1", filename: "frente.pdf", status: "in_production", updated_at: "2026-09-07T00:00:00.000Z" },
  { id: "file-2", filename: "reverso.pdf", status: "pending", updated_at: "2026-09-07T00:01:00.000Z" },
  { id: "file-3", filename: "terminacion.pdf", status: "in_termination", updated_at: "2026-09-07T00:02:00.000Z" },
];

describe("ProductionFileTransferModal", () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
    supabase.rpc.mockImplementation(async (name) => {
      if (name === "get_production_file_transfer_candidates") {
        return { data: [{ id: "jose", name: "José" }], error: null };
      }
      return { data: { transferred_file_ids: ["file-1", "file-2"] }, error: null };
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("sends selected open files with their optimistic versions", async () => {
    const onTransferred = vi.fn();
    render(<ProductionFileTransferModal open order={order} files={files} onClose={vi.fn()} onTransferred={onTransferred} />);

    await screen.findByRole("option", { name: "José" });
    expect(screen.queryByText("terminacion.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("frente.pdf"));
    fireEvent.click(screen.getByText("reverso.pdf"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jose" } });
    fireEvent.click(screen.getByRole("button", { name: /Traspasar seleccionados/i }));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("transfer_production_files", {
        p_order_id: order.id,
        p_target_user_id: "jose",
        p_files: [
          { id: "file-1", expected_updated_at: "2026-09-07T00:00:00.000Z" },
          { id: "file-2", expected_updated_at: "2026-09-07T00:01:00.000Z" },
        ],
      });
    });
    expect(onTransferred).toHaveBeenCalledWith(expect.objectContaining({ transferred_file_ids: ["file-1", "file-2"] }));
  });

  it("does not expose a transfer action for only terminal files", async () => {
    render(<ProductionFileTransferModal open order={order} files={[files[2]]} onClose={vi.fn()} />);

    await screen.findByRole("option", { name: "José" });
    expect(screen.getByText("No tienes archivos disponibles para traspasar en esta orden.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Traspasar seleccionados/i })).toBeDisabled();
  });
});
