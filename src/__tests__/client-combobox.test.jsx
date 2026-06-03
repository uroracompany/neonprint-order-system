import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientNameAutocomplete, ClientSelect } from "../components/ui/ClientCombobox";

describe("client order controls", () => {
  const client = {
    id: "client-1",
    name: "JP MORGAN",
    phone: "8092932323",
  };

  it("permite seleccionar un cliente desde el select superior", async () => {
    const onSelect = vi.fn();

    render(
      <ClientSelect
        clients={[client]}
        value=""
        onSelect={onSelect}
        placeholder="Seleccionar cliente registrado"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /seleccionar cliente registrado/i }));
    fireEvent.click(await screen.findByRole("option", { name: /jp morgan/i }));

    expect(onSelect).toHaveBeenCalledWith(client);
  });

  it("no muestra el dropdown hasta que haya resultados", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);

    render(
      <ClientNameAutocomplete
        clients={[]}
        value=""
        onChange={() => {}}
        onSearch={onSearch}
        onSelect={() => {}}
        placeholder="Nombre del cliente"
      />
    );

    const input = screen.getByPlaceholderText("Nombre del cliente");
    fireEvent.focus(input);

    // Sin resultados → no se renderiza el menú
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();

    // Al escribir, se dispara la búsqueda pero aún no hay resultados
    fireEvent.change(input, { target: { value: "X" } });
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith("X"));
    // Sigue sin haber dropdown porque la búsqueda devolvió []
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("el autocomplete muestra sugerencias y permite seleccionar con Enter", async () => {
    const onSearch = vi.fn().mockResolvedValue([client]);
    const onSelect = vi.fn();
    const onChange = vi.fn();

    render(
      <ClientNameAutocomplete
        clients={[]}
        value=""
        onChange={onChange}
        onSearch={onSearch}
        onSelect={onSelect}
        placeholder="Nombre del cliente"
      />
    );

    const input = screen.getByPlaceholderText("Nombre del cliente");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "J" } });

    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith("J"));
    expect(await screen.findByText("JP MORGAN")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("J");
    expect(onSelect).toHaveBeenCalledWith(client);
  });
});
