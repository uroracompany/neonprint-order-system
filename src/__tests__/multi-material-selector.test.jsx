import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MultiMaterialSelector } from "../components/orders/CreateOrderModal";

describe("MultiMaterialSelector", () => {
  const defaultOptions = ["Vinilo", "Banner", "Lona", "PVC", "Acrilico"];

  const ControlledSelector = ({ onChange, initialValue = [] }) => {
    const [value, setValue] = useState(initialValue);
    return (
      <MultiMaterialSelector
        selected={value}
        options={defaultOptions}
        onChange={(nextValue) => {
          setValue(nextValue);
          onChange(nextValue);
        }}
      />
    );
  };

  it("renderiza el placeholder cuando no hay seleccion", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    expect(screen.getByText("Seleccionar materiales...")).toBeInTheDocument();
  });

  it("abre el dropdown al hacer clic", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    expect(screen.getByText("Vinilo")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
  });

  it("muestra los materiales seleccionados como chips", () => {
    render(<MultiMaterialSelector selected={["Vinilo", "Banner"]} onChange={() => {}} options={defaultOptions} />);
    expect(screen.getByText("Vinilo")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
  });

  it("solo confirma el material al pulsar Agregar", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Vinilo"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith(["Vinilo"]);
  });

  it("habilita Agregar con uno o varios materiales y conserva el borrador al cerrar fuera", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);

    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    const addButton = screen.getByRole("button", { name: "Agregar" });
    expect(addButton).toBeDisabled();

    fireEvent.click(screen.getByRole("option", { name: "Vinilo" }));
    fireEvent.click(screen.getByRole("option", { name: "Banner" }));
    expect(addButton).toBeEnabled();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox", { name: "Materiales disponibles" })).not.toBeInTheDocument();
    expect(screen.getByText("Vinilo")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Materiales" }));
    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Banner/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Agregar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith(["Vinilo", "Banner"]);
  });

  it("descarta el borrador solo al cancelar explícitamente", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);

    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByRole("option", { name: "Vinilo" }));
    fireEvent.pointerDown(document.body);
    fireEvent.click(screen.getByRole("combobox", { name: "Materiales" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Vinilo")).not.toBeInTheDocument();
  });

  it("no elimina el último material al cerrar y reabrir después de tres selecciones", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    await user.click(screen.getByRole("option", { name: "Banner" }));
    await user.click(screen.getByRole("option", { name: "Lona" }));
    expect(screen.getByRole("button", { name: "Agregar" })).toBeEnabled();

    await user.click(document.body);
    await user.click(screen.getByText("Lona"));

    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Banner/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Lona/ })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith(["Vinilo", "Banner", "Lona"]);
  });

  it("reabre inmediatamente con la selección recién confirmada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    await user.click(screen.getByRole("option", { name: "Banner" }));
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await user.click(document.body);
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));

    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Banner/ })).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenLastCalledWith(["Vinilo", "Banner"]);
  });

  it("confirma la remoción de un material al pulsar Agregar", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={["Vinilo", "Banner"]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Vinilo").closest(".ps-chip").querySelector("button"));
    expect(onChange).not.toHaveBeenCalled();
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons.find((button) => button.textContent === "Agregar"));
    expect(onChange).toHaveBeenCalledWith(["Banner"]);
  });

  it("no elimina una opción marcada al volver a pulsarla; solo la X la remueve", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Materiales" }));
    fireEvent.click(screen.getByRole("option", { name: "Vinilo" }));
    fireEvent.click(screen.getByRole("option", { name: /Vinilo/ }));

    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Agregar" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Quitar Vinilo" }));
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });

  it("muestra la opcion de agregar material personalizado", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    expect(screen.getByText("Agregar material personalizado")).toBeInTheDocument();
  });

  it("permite agregar un material personalizado", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const input = screen.getByPlaceholderText("Escribe el nombre del material...");
    fireEvent.change(input, { target: { value: "Acetato" } });
    fireEvent.click(screen.getByText("Preparar"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith(["Acetato"]);
  });

  it("no agrega un material personalizado vacio", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const btn = screen.getByText("Preparar");
    expect(btn).toBeDisabled();
  });

  it("agrega material personalizado con Enter", () => {
    const onChange = vi.fn();
    render(<MultiMaterialSelector selected={[]} onChange={onChange} options={defaultOptions} />);
    fireEvent.click(screen.getByText("Seleccionar materiales..."));
    fireEvent.click(screen.getByText("Agregar material personalizado"));
    const input = screen.getByPlaceholderText("Escribe el nombre del material...");
    fireEvent.change(input, { target: { value: "Tela Metallica" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith(["Tela Metallica"]);
  });

  it("asigna clase custom a chips de materiales personalizados", () => {
    render(<MultiMaterialSelector selected={["Acetato"]} onChange={() => {}} options={defaultOptions} />);
    const chip = screen.getByText("Acetato").closest(".ps-chip");
    expect(chip).toHaveClass("ps-chip--custom");
  });

  it("no asigna clase custom a chips de materiales existentes", () => {
    render(<MultiMaterialSelector selected={["Vinilo"]} onChange={() => {}} options={defaultOptions} />);
    const chip = screen.getByText("Vinilo").closest(".ps-chip");
    expect(chip).not.toHaveClass("ps-chip--custom");
  });
});
