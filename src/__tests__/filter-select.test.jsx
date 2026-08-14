import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterSelect } from "../components/ui/FilterSelect";
import { Icons } from "../utils/icons";

const options = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendiente" },
  { value: "completed", label: "Completada" },
];

describe("FilterSelect", () => {
  it("permite buscar y seleccionar una opción con teclado", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterSelect label="Estado" value="all" onChange={onChange} options={options} searchable />);

    await user.click(screen.getByRole("button", { name: "Estado" }));
    await user.type(screen.getByLabelText("Buscar en Estado"), "comple");
    expect(screen.getByRole("option", { name: "Completada" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Pendiente" })).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("completed");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("cierra al presionar Escape o al hacer clic fuera", async () => {
    const user = userEvent.setup();
    render(<FilterSelect label="Estado" value="all" onChange={vi.fn()} options={options} searchable />);

    const trigger = screen.getByRole("button", { name: "Estado" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("mantiene icono, texto y flecha separados cuando el control usa ancho amplio", () => {
    render(
      <FilterSelect
        className="pp-filter-select-wrap--wide"
        icon={<Icons.Orders />}
        label="Situación operativa"
        value="all"
        onChange={vi.fn()}
        options={[{ value: "all", label: "Toda la situación operativa" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Situación operativa" });
    expect(trigger.parentElement).toHaveClass("pp-filter-select-wrap--wide");
    expect(trigger.querySelector(".pp-filter-select-icon")).toBeInTheDocument();
    expect(trigger.querySelector(".pp-filter-select-label")).toHaveTextContent("Toda la situación operativa");
    expect(trigger.lastElementChild?.tagName).toBe("svg");
  });

  it("reserva el modo de dos líneas para valores largos marcados explícitamente", () => {
    const longLabel = "Nombre de cliente con una descripción comercial excepcionalmente extensa";
    render(
      <FilterSelect
        allowMultiline
        icon={<Icons.User />}
        label="Cliente"
        value="long"
        onChange={vi.fn()}
        options={[{ value: "long", label: longLabel }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Cliente" });
    expect(trigger).toHaveClass("pp-filter-select-trigger--multiline");
    expect(trigger).toHaveAttribute("title", longLabel);
    expect(trigger.querySelector(".pp-filter-select-icon")).toBeInTheDocument();
    expect(trigger.lastElementChild?.tagName).toBe("svg");
  });

  it("mantiene la altura estándar cuando un campo adaptable tiene un valor corto", () => {
    render(
      <FilterSelect
        allowMultiline
        icon={<Icons.Users />}
        label="Empleado"
        value="all"
        onChange={vi.fn()}
        options={[{ value: "all", label: "Todos los empleados" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "Empleado" })).not.toHaveClass("pp-filter-select-trigger--multiline");
  });
});
