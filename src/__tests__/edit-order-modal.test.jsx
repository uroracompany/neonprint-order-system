import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditOrderModal from "../components/orders/EditOrderModal";

const completeOrder = {
  id: "order-1",
  client_id: "client-1",
  client_name: "JP Morgan",
  client_contact: "809-293-2323",
  invoice_number: "FAC-001",
  description: "Impresion de lona para evento",
  material: "Lona, Vinil",
  termination_type: "Mate",
  delivery_date: "2026-09-15T12:00:00.000Z",
  status: "Pending",
  order_design_type: "EXTERNAL_DESING",
  order_file_url: [],
  reference_images: [],
};

const renderModal = (order = completeOrder) => render(
  <EditOrderModal
    open
    onClose={vi.fn()}
    onUpdated={vi.fn()}
    order={order}
    editMode="seller"
    productionCatalog={{
      materials: { ploteo: ["Lona", "Vinil", "Acrilico"] },
      terminations: { ploteo: ["Mate"] },
    }}
    clients={[{ id: "client-1", name: "JP Morgan", phone: "809-293-2323" }]}
  />
);

describe("EditOrderModal seller hydration", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("keeps legacy order-wide material and termination summaries out of the form", () => {
    renderModal();

    expect(screen.getByDisplayValue("809-293-2323")).toBeDisabled();
    expect(screen.getByDisplayValue("Impresion de lona para evento")).toBeVisible();
    expect(screen.getByDisplayValue("2026-09-15")).toBeVisible();
    expect(screen.queryByDisplayValue("Mate")).not.toBeInTheDocument();
    expect(screen.queryByText("Lona")).not.toBeInTheDocument();
    expect(screen.queryByText("Vinil")).not.toBeInTheDocument();
  });

  it("conserva el teléfono internacional del cliente al editar una orden", () => {
    renderModal({
      ...completeOrder,
      client_contact: "+52 55 1234 5678",
    });

    expect(screen.getByDisplayValue("+52 55 1234 5678")).toBeDisabled();
    expect(screen.queryByText(/República Dominicana|809, 829 o 849/i)).not.toBeInTheDocument();
  });

  it("does not allow the existing delivery date to be submitted empty", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(screen.getByDisplayValue("2026-09-15"));
    await user.click(screen.getByRole("button", { name: /Guardar Cambios/i }));

    expect(screen.getByText("La fecha de entrega existente no puede quedar vacia.")).toBeVisible();
  });
});
