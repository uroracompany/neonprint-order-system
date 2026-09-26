import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MultiMaterialSelector } from "../components/orders/CreateOrderModal";

describe("MultiMaterialSelector", () => {
  const options = ["Vinilo", "Banner", "Lona", "PVC", "Acrilico"];
  const ControlledSelector = ({ onChange, initialValue = [] }) => {
    const [value, setValue] = useState(initialValue);
    return (
      <MultiMaterialSelector
        selected={value}
        options={options}
        onChange={(nextValue) => {
          setValue(nextValue);
          onChange(nextValue);
        }}
      />
    );
  };

  it("agrega un material inmediatamente al marcarlo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));

    expect(onChange).toHaveBeenCalledWith(["Vinilo"]);
    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("mantiene varios materiales y no permite quitarlos volviendo a marcar la opción", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    await user.click(screen.getByRole("option", { name: "Banner" }));
    const callsBeforeRepeat = onChange.mock.calls.length;
    await user.click(screen.getByRole("option", { name: /Vinilo/ }));

    expect(onChange).toHaveBeenCalledTimes(callsBeforeRepeat);
    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Banner/ })).toHaveAttribute("aria-selected", "true");
  });

  it("conserva la selección al cerrar y volver a abrir el selector", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    await user.click(document.body);
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));

    expect(screen.getByRole("option", { name: /Vinilo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Vinilo");
  });

  it("conserva todos los materiales al perder foco y agregar otro después", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "Vinilo" }));
    await user.click(screen.getByRole("option", { name: "Banner" }));
    await user.click(screen.getByRole("option", { name: "Lona" }));
    await user.click(document.body);
    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("option", { name: "PVC" }));

    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Vinilo");
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Banner");
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("Lona");
    expect(screen.getByRole("combobox", { name: "Materiales" })).toHaveTextContent("PVC");
    expect(onChange).toHaveBeenLastCalledWith(["Vinilo", "Banner", "Lona", "PVC"]);
  });

  it("elimina un material únicamente mediante su X", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} initialValue={["Vinilo", "Banner"]} />);

    await user.click(screen.getByRole("button", { name: "Quitar Vinilo" }));

    expect(onChange).toHaveBeenCalledWith(["Banner"]);
    expect(screen.queryByRole("button", { name: "Quitar Vinilo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Banner" })).toBeInTheDocument();
  });

  it("usa Agregar para confirmar un material personalizado y no muestra un segundo Agregar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Materiales" }));
    await user.click(screen.getByRole("button", { name: "Agregar material personalizado" }));
    const input = screen.getByLabelText("Material personalizado");
    await user.type(input, "Acetato");

    expect(screen.getByRole("button", { name: "Agregar" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Agregar" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(onChange).toHaveBeenCalledWith(["Acetato"]);
    expect(screen.getByRole("button", { name: "Quitar Acetato" })).toBeInTheDocument();
  });

  it("mantiene deshabilitado Agregar personalizado hasta recibir texto", () => {
    render(<MultiMaterialSelector selected={[]} onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Materiales" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar material personalizado" }));

    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });
});
