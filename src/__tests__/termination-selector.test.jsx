import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminationSelector } from "../components/orders/CreateOrderModal";

describe("TerminationSelector", () => {
  const options = ["Ojales", "Corte"];
  const ControlledSelector = ({ onChange, initialValue = "", availableOptions = options }) => {
    const [value, setValue] = useState(initialValue);
    return (
      <TerminationSelector
        value={value}
        options={availableOptions}
        onChange={(nextValue) => {
          setValue(nextValue);
          onChange(nextValue);
        }}
      />
    );
  };

  it("selecciona una terminación de catálogo y la refleja en el control", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Ojales" }));

    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenCalledWith("Ojales");
    expect(screen.getByRole("button", { name: "Terminación" })).toHaveTextContent("Ojales");
  });

  it("emite el texto de la terminación personalizada, no un sentinela", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} initialValue="Ojales" />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("button", { name: "Agregar terminación personalizada" }));

    const input = screen.getByLabelText("Terminación personalizada");
    await user.type(input, "Laminado mate especial");

    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenLastCalledWith("Laminado mate especial");
    expect(onChange).not.toHaveBeenCalledWith("__custom__");
  });

  it("abre con catálogo vacío y permite registrar una terminación personalizada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} availableOptions={[]} />);

    const trigger = screen.getByRole("button", { name: "Terminación" });
    expect(trigger.parentElement).toHaveClass("ps-multimat");

    await user.click(trigger);

    expect(screen.getByRole("listbox", { name: "Terminaciones disponibles" })).toBeInTheDocument();
    expect(screen.getByText("Sin terminaciones disponibles")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Agregar terminación personalizada" }));
    await user.type(screen.getByLabelText("Terminación personalizada"), "Laminado sin catálogo");

    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenLastCalledWith("Laminado sin catálogo");
  });

  it("conserva la terminación preparada al cerrar y reabrir el selector", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Ojales" }));
    await user.click(document.body);
    await user.click(screen.getByRole("button", { name: "Terminación" }));

    expect(screen.getByRole("option", { name: /Ojales/ })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenLastCalledWith("Ojales");
  });

  it("solo elimina la terminación mediante su X y confirma el cambio con Agregar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} initialValue="Ojales" />);

    await user.click(screen.getByRole("button", { name: "Quitar Ojales" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await user.click(screen.getByRole("option", { name: "Corte" }));
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onChange).toHaveBeenLastCalledWith("Corte");
  });
});
