import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("abre Detalles al seleccionar un archivo nuevo y refleja su estado incompleto", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("Diseño Externo"));
    const designFilesInput = document.querySelector('input[type="file"][multiple]');
    const file = new File(["pdf"], "arte.pdf", { type: "application/pdf" });
    fireEvent.change(designFilesInput, { target: { files: [file] } });

    const detailsButton = await screen.findByRole("button", { name: "Detalles de arte.pdf" });
    expect(detailsButton).not.toHaveClass("fc-file-action-attention");
    expect(detailsButton).toHaveAttribute("title", "Detalles de arte.pdf");
    expect(screen.getByRole("heading", { name: "Detalles de Archivo" })).toBeInTheDocument();
    const detailsDialog = screen.getByRole("heading", { name: "Detalles de Archivo" }).closest('[role="dialog"]');
    await user.click(within(detailsDialog).getByRole("button", { name: "Cancelar" }));
    await user.click(await screen.findByRole("button", { name: "Detalles de arte.pdf" }));
    expect(await screen.findByRole("heading", { name: "Detalles de Archivo" })).toBeInTheDocument();
  });

  it("cambia a Editar cuando los detalles están completos y vuelve a abrir el mismo borrador", async () => {
    const user = userEvent.setup();
    renderModal({
      productionCatalog: {
        materials: { ploteo: ["Lona"] },
        terminations: { ploteo: ["Mate"] },
      },
    });
    await user.click(screen.getByText("Diseño Externo"));
    const uploadInput = document.querySelector('input[type="file"][multiple]');
    await user.upload(uploadInput, new File(["pdf"], "arte.pdf", { type: "application/pdf" }));

    const detailsHeading = await screen.findByRole("heading", { name: "Detalles de Archivo" });
    const detailsDialog = detailsHeading.closest('[role="dialog"]');
    const details = within(detailsDialog);
    await user.type(await details.findByLabelText("Nombre visible en seguimiento"), "Banner principal");
    await user.selectOptions(await details.findByLabelText("Área de producción"), "ploteo");
    await user.click(await details.findByRole("combobox", { name: "Materiales" }));
    await user.click(await details.findByRole("option", { name: "Lona" }));
    await user.click(await details.findByRole("button", { name: "Terminación" }));
    await user.click(await details.findByRole("option", { name: "Mate" }));
    await user.click(await details.findByRole("button", { name: "Guardar Detalles" }));

    const editButton = await screen.findByRole("button", { name: "Editar detalles de arte.pdf" });
    expect(editButton).toHaveTextContent("Editar");
    expect(editButton).toHaveAttribute("title", "Editar detalles de arte.pdf");
    await user.click(editButton);
    const reopenedHeading = await screen.findByRole("heading", { name: "Detalles de Archivo" });
    expect(within(reopenedHeading.closest('[role="dialog"]')).getByLabelText("Nombre visible en seguimiento"))
      .toHaveValue("Banner principal");
  }, 15000);

  it("abre los detalles del primer archivo válido al seleccionar varios archivos", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText("Diseño Externo"));
    const designFilesInput = document.querySelector('input[type="file"][multiple]');
    const first = new File(["pdf"], "primero.pdf", { type: "application/pdf" });
    const second = new File(["pdf"], "segundo.pdf", { type: "application/pdf" });

    await user.upload(designFilesInput, [first, second]);

    expect(await screen.findByRole("heading", { name: "Detalles de Archivo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detalles de primero.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detalles de segundo.pdf" })).toBeInTheDocument();
  });

  it("no abre detalles para una selección rechazada", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText("Diseño Externo"));
    const designFilesInput = document.querySelector('input[type="file"][multiple]');

    fireEvent.change(designFilesInput, {
      target: { files: [new File(["bad"], "script.exe", { type: "application/octet-stream" })] },
    });

    expect(await screen.findByText(/no es un adjunto permitido/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Detalles:/ })).not.toBeInTheDocument();
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
