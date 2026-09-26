import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateOrderModal from "../components/orders/CreateOrderModal";

const draftKey = "neonprint:create-order-draft:v1:user-1";

const renderModal = (props = {}) => render(
  <CreateOrderModal
    open
    onClose={vi.fn()}
    userId="user-1"
    materialOptions={[]}
    {...props}
  />
);

describe("CreateOrderModal close behavior", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("does not restore a legacy session draft when opened", () => {
    window.sessionStorage.setItem(draftKey, JSON.stringify({ invoice_number: "FAC-ANTERIOR" }));

    renderModal();

    expect(screen.getByPlaceholderText("Ej: FAC-001-2024")).toHaveValue("");
  });

  it("clears entered fields and the legacy draft when closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    window.sessionStorage.setItem(draftKey, JSON.stringify({ invoice_number: "FAC-ANTERIOR" }));

    renderModal({ onClose });
    const invoiceInput = screen.getByPlaceholderText("Ej: FAC-001-2024");
    await user.type(invoiceInput, "FAC-NUEVA");

    await user.click(screen.getByRole("button", { name: "Cerrar modal" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(invoiceInput).toHaveValue("");
    expect(window.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("muestra un teléfono internacional seleccionado sin recortarlo ni exigir prefijo dominicano", () => {
    renderModal({
      clientToSelect: {
        id: "client-international",
        name: "Cliente Internacional",
        phone: "+44 20 7946 0958",
      },
    });

    expect(screen.getByDisplayValue("+44 20 7946 0958")).toBeDisabled();
    expect(screen.queryByText(/República Dominicana|809, 829 o 849/i)).not.toBeInTheDocument();
  });
});
