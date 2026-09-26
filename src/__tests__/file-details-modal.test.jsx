import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductionFileDetailsModal } from "../components/orders/CreateOrderModal";

const catalog = {
  materials: { ploteo: ["Banner"], dtf: ["Film DTF"] },
  terminations: { ploteo: ["Ojales"], dtf: ["Corte"] },
};

describe("ProductionFileDetailsModal", () => {
  it("comparte la variante visual de formularios con Nueva orden", () => {
    render(<ProductionFileDetailsModal open fileName="banner.pdf" value={{}} catalog={catalog} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toHaveClass("ps-file-details-modal", "ps-modal-form-visual");
  });

  it("restores a file configuration and saves only that file draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProductionFileDetailsModal
        open
        fileName="banner.pdf"
        value={{ publicLabel: "Banner principal", areaCode: "ploteo", materialNames: ["Banner"], terminationName: "Ojales" }}
        catalog={catalog}
        onSave={onSave}
        onClose={onClose}
      />
    );

    expect(screen.getByDisplayValue("Banner principal")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar Detalles" }));

    expect(onSave).toHaveBeenCalledWith({
      publicLabel: "Banner principal",
      areaCode: "ploteo",
      materialNames: ["Banner"],
      terminationName: "Ojales",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when required file details are missing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ProductionFileDetailsModal open fileName="sin-configurar.pdf" value={{}} catalog={catalog} onSave={onSave} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Guardar Detalles" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Indica el nombre visible en seguimiento.")).toBeInTheDocument();
  });

  it("habilita Terminación con la misma regla que Materiales", async () => {
    const user = userEvent.setup();
    render(
      <ProductionFileDetailsModal
        open
        fileName="sin-area.pdf"
        value={{ publicLabel: "", areaCode: "", materialNames: [], terminationName: "" }}
        catalog={{ materials: {}, terminations: {} }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const disabledTrigger = screen.getByRole("button", { name: "Terminación" });
    expect(disabledTrigger).toBeDisabled();
    await user.click(disabledTrigger);
    expect(screen.queryByRole("listbox", { name: "Terminaciones disponibles" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre visible en seguimiento"), "Archivo");
    await user.selectOptions(screen.getByLabelText("Área de producción"), "ploteo");

    const enabledTrigger = screen.getByRole("button", { name: "Terminación" });
    expect(enabledTrigger).toBeEnabled();
    await user.click(enabledTrigger);

    expect(screen.getByText("Sin terminaciones disponibles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar terminación personalizada" })).toBeEnabled();
  });

  it("rejects material entries that contain only whitespace", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProductionFileDetailsModal
        open
        fileName="sin-material.pdf"
        value={{ publicLabel: "Banner", areaCode: "ploteo", materialNames: ["  "], terminationName: "Ojales" }}
        catalog={catalog}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Guardar Detalles" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Selecciona al menos un material.")).toBeInTheDocument();
  });

  it("conserva las selecciones del borrador aunque el padre vuelva a renderizar", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(
      <ProductionFileDetailsModal
        open
        fileKey="archivo-1"
        fileName="banner.pdf"
        value={{ publicLabel: "Banner", areaCode: "ploteo", materialNames: [], terminationName: "" }}
        catalog={catalog}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Banner" }));
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");

    rerender(
      <ProductionFileDetailsModal
        open
        fileKey="archivo-1"
        fileName="banner.pdf"
        value={{ publicLabel: "Banner", areaCode: "ploteo", materialNames: [], terminationName: "" }}
        catalog={catalog}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
  });

  it("conserva todos los materiales del modal al perder foco y agregar otro", async () => {
    const user = userEvent.setup();
    render(
      <ProductionFileDetailsModal
        open
        fileKey="archivo-multi"
        fileName="banner.pdf"
        value={{ publicLabel: "Banner", areaCode: "ploteo", materialNames: [], terminationName: "" }}
        catalog={{ materials: { ploteo: ["Banner", "Vinilo", "Lona", "PVC"] }, terminations: { ploteo: ["Ojales"] } }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const materials = screen.getByRole("combobox", { name: "Materiales" });
    await user.click(materials);
    await user.click(screen.getByRole("option", { name: "Banner" }));
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    await user.click(screen.getByRole("option", { name: "Lona" }));
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    await user.click(document.body);
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    await user.click(screen.getByRole("option", { name: "PVC" }));

    const reopenedMaterials = screen.getByRole("combobox", { name: "Materiales" });
    expect(reopenedMaterials).toHaveTextContent("Banner");
    expect(reopenedMaterials).toHaveTextContent("Vinilo");
    expect(reopenedMaterials).toHaveTextContent("Lona");
    expect(reopenedMaterials).toHaveTextContent("PVC");
  });

  it("actualiza el catálogo al cambiar el área sin mezclar opciones de otra área", async () => {
    const user = userEvent.setup();
    render(
      <ProductionFileDetailsModal
        open
        fileName="banner.pdf"
        value={{ publicLabel: "Banner", areaCode: "ploteo", materialNames: ["Banner"], terminationName: "Ojales" }}
        catalog={catalog}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Área de producción" }), "dtf");
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));

    expect(screen.queryByRole("option", { name: "Banner" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Film DTF" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Seleccionar materiales");
    expect(screen.getByRole("button", { name: "Terminación" })).toHaveTextContent("Seleccionar terminación");
  });
});
