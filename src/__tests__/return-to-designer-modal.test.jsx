import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReturnToDesignerModal from "../components/orders/ReturnToDesignerModal";

const externalOrder = {
  id: "12345678-1234-1234-1234-123456789abc",
  client_name: "Cliente externo",
  order_design_type: "EXTERNAL_DESING",
};

const renderModal = (props = {}) => render(
  <ReturnToDesignerModal
    open
    order={externalOrder}
    loading={false}
    onClose={vi.fn()}
    onConfirm={vi.fn()}
    {...props}
  />,
);

describe("ReturnToDesignerModal", () => {
  it("preserves Caja external and internal target presentation", () => {
    const { rerender } = renderModal();

    expect(screen.getByRole("dialog", { name: "Devolver al Vendedor" })).toBeInTheDocument();
    expect(screen.getByText(/El estado cambiará a "Pendiente"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver al Vendedor" })).toBeDisabled();

    rerender(
      <ReturnToDesignerModal
        open
        order={{ ...externalOrder, id: "87654321-1234-1234-1234-123456789abc", order_design_type: "INTERNAL_DESIGN" }}
        loading={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Devolver al Diseñador" })).toBeInTheDocument();
    expect(screen.getByText(/El estado cambiará a "En Diseño"/)).toBeInTheDocument();
  });

  it("forces Semi-admin presentation to Designer and enforces its ten-character reason", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal({ targetOverride: "designer", minReasonLength: 10, onConfirm });

    expect(screen.getByRole("dialog", { name: "Devolver al Diseñador" })).toBeInTheDocument();
    expect(screen.getByText(/El estado cambiará a "En Diseño"/)).toBeInTheDocument();

    const reason = screen.getByLabelText("Razón de la devolución");
    const confirm = screen.getByRole("button", { name: "Devolver al Diseñador" });
    await user.type(reason, " corto ");
    expect(confirm).toBeDisabled();

    await user.clear(reason);
    await user.type(reason, "  diez letras  ");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("diez letras");
  });

  it("resets reason for another order and blocks close controls while loading", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = renderModal({ onClose });
    const reason = screen.getByLabelText("Razón de la devolución");
    await user.type(reason, "Cambios pendientes");
    expect(reason).toHaveValue("Cambios pendientes");

    rerender(
      <ReturnToDesignerModal
        open
        order={{ ...externalOrder, id: "87654321-1234-1234-1234-123456789abc" }}
        loading
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Razón de la devolución")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Devolviendo..." })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses the close control, traps Tab, restores focus and only closes with Escape when available", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { rerender } = renderModal({ onClose });

    const close = screen.getByRole("button", { name: "Cerrar" });
    const reason = screen.getByLabelText("Razón de la devolución");
    expect(close).toHaveFocus();

    await user.type(reason, "razón válida");
    close.focus();
    await user.tab();
    expect(reason).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Devolver al Vendedor" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Devolver al Vendedor" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<ReturnToDesignerModal open={false} order={externalOrder} loading={false} onClose={onClose} onConfirm={vi.fn()} />);
    expect(trigger).toHaveFocus();
    trigger.remove();

    const loadingClose = vi.fn();
    rerender(<ReturnToDesignerModal open order={externalOrder} loading onClose={loadingClose} onConfirm={vi.fn()} />);
    const loadingDialog = screen.getByRole("dialog");
    expect(loadingDialog).toHaveAttribute("tabindex", "0");
    expect(loadingDialog).toHaveFocus();
    await user.tab();
    expect(loadingDialog).toHaveFocus();
    fireEvent.keyDown(loadingDialog, { key: "Escape" });
    expect(loadingClose).not.toHaveBeenCalled();
  });
});
