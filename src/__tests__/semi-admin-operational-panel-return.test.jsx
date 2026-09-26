import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SemiAdminOperationalPanel from "../components/orders/SemiAdminOperationalPanel";

const order = {
  id: "order-return-1",
  status: "in_Design",
  payment_status: "Pending_Payment",
  order_design_type: "EXTERNAL_DESING",
};

describe("acciones de devolución del panel SemiAdmin", () => {
  it("habilita Devolver a Ventas con un carácter y conserva el estilo azul", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SemiAdminOperationalPanel
        order={order}
        currentUserId="semi-admin-1"
        onAction={onAction}
        onLoadCatalog={vi.fn().mockResolvedValue({ actions: [{ key: "manage_design_assets" }, { key: "return_design_to_sales", title: "Devolver a Ventas" }] })}
      />,
    );

    const input = await screen.findByLabelText("Motivo para regresar a Ventas");
    const button = screen.getByRole("button", { name: "Regresar a Ventas" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("sa-op-button--return");

    await user.type(input, "A");
    expect(button).toBeEnabled();
    await user.click(button);

    expect(onAction).toHaveBeenCalledWith("return_design_to_sales", {
      order_id: order.id,
      reason: "A",
    });
  });

  it("mantiene deshabilitado el botón para espacios en blanco", async () => {
    const user = userEvent.setup();
    render(
      <SemiAdminOperationalPanel
        order={order}
        currentUserId="semi-admin-1"
        onAction={vi.fn()}
        onLoadCatalog={vi.fn().mockResolvedValue({ actions: [{ key: "manage_design_assets" }, { key: "return_design_to_sales", title: "Devolver a Ventas" }] })}
      />,
    );

    const input = await screen.findByLabelText("Motivo para regresar a Ventas");
    const button = screen.getByRole("button", { name: "Regresar a Ventas" });
    await user.type(input, "   ");
    expect(button).toBeDisabled();
  });
});
