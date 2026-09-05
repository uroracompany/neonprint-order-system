import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OrderDetailModal from "../components/orders/OrderDetailModal";

vi.mock("../../supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

const order = {
  id: "00000000-0000-0000-0000-000000000001",
  created_at: "2026-09-05T12:00:00.000Z",
  status: "Pending",
  payment_status: "Pending_Payment",
  order_design_type: "EXTERNAL_DESING",
  client_name: "Cliente de prueba",
};

describe("detalle de orden de Semi-Admin", () => {
  it("no se cierra desde backdrop ni Escape cuando el flujo lo desactiva", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OrderDetailModal open onClose={onClose} order={order} closeOnBackdrop={false} closeOnEscape={false} />);

    await user.click(document.body.querySelector(".order-detail-modal-overlay"));
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar modal" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
