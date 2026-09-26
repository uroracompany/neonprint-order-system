import { fireEvent, render, screen } from "@testing-library/react";
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

  it("destaca Detalles en archivos nuevos y retira la atención al abrirlo", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("Diseño Externo"));
    const designFilesInput = document.querySelector('input[type="file"][multiple]');
    const file = new File(["pdf"], "arte.pdf", { type: "application/pdf" });
    fireEvent.change(designFilesInput, { target: { files: [file] } });

    const detailsButton = await screen.findByRole("button", { name: "Detalles" });
    expect(detailsButton).toHaveClass("fc-file-action-attention");

    await user.click(detailsButton);

    expect(detailsButton).not.toHaveClass("fc-file-action-attention");
  });

  it("usa la variante visual compartida con el editor de detalles", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toHaveClass("ps-create-order-modal");
  });

  it("mantiene las acciones en un footer fijo separado del cuerpo desplazable", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    const footer = dialog.querySelector(".ps-modal-footer");

    expect(footer).toBeInTheDocument();
    expect(footer).toContainElement(screen.getByRole("button", { name: "Cancelar" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Crear Orden" }));
    expect(dialog.querySelector(".ps-modal-body .ps-form-actions")).not.toBeInTheDocument();
  });

  it("no muestra separadores de Datos del cliente ni Detalles del trabajo", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    expect(screen.queryByText("Datos del cliente")).not.toBeInTheDocument();
    expect(screen.queryByText("Detalles del trabajo")).not.toBeInTheDocument();
    expect(dialog.querySelector(".ps-form-section-title")).not.toBeInTheDocument();
  });
});
