import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminationSelector } from "../components/orders/CreateOrderModal";

describe("TerminationSelector", () => {
  const options = ["Ojales", "Corte"];
  const ControlledSelector = ({ onChange, initialValue = "" }) => {
    const [value, setValue] = useState(initialValue);
    return (
      <TerminationSelector
        value={value}
        options={options}
        onChange={(nextValue) => {
          setValue(nextValue);
          onChange(nextValue);
        }}
      />
    );
  };

  it("agrega una terminación inmediatamente al marcarla", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Ojales" }));

    expect(onChange).toHaveBeenCalledWith("Ojales");
    expect(screen.getByRole("option", { name: /Ojales/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("no elimina una terminación al volver a marcarla", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Ojales" }));
    const callsBeforeRepeat = onChange.mock.calls.length;
    await user.click(screen.getByRole("option", { name: /Ojales/ }));

    expect(onChange).toHaveBeenCalledTimes(callsBeforeRepeat);
    expect(screen.getByRole("button", { name: "Quitar Ojales" })).toBeInTheDocument();
  });

  it("elimina la terminación únicamente mediante su X", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} initialValue="Ojales" />);

    await user.click(screen.getByRole("button", { name: "Quitar Ojales" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("button", { name: "Terminación" })).toHaveTextContent("Seleccionar terminación");
  });

  it("conserva la terminación al cerrar y reabrir el selector", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("option", { name: "Ojales" }));
    await user.click(document.body);
    await user.click(screen.getByRole("button", { name: "Terminación" }));

    expect(screen.getByRole("option", { name: /Ojales/ })).toHaveAttribute("aria-selected", "true");
  });

  it("usa Agregar para una terminación personalizada", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledSelector onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Terminación" }));
    await user.click(screen.getByRole("button", { name: "Agregar terminación personalizada" }));
    await user.type(screen.getByLabelText("Terminación personalizada"), "Laminado mate especial");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(onChange).toHaveBeenCalledWith("Laminado mate especial");
    expect(screen.getByRole("button", { name: "Quitar Laminado mate especial" })).toBeInTheDocument();
  });
});
