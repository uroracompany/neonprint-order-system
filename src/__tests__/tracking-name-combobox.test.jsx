import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TrackingNameCombobox from "../components/ui/TrackingNameCombobox";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../supabaseClient", () => ({ supabase: { from, rpc } }));

const makeCatalogQuery = ({ data = [], error = null } = {}) => {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    ilike: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
};

describe("TrackingNameCombobox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue(makeCatalogQuery());
    rpc.mockResolvedValue({ data: [{ id: "created-1", name: "Nuevo nombre" }], error: null });
  });

  it("loads, searches and selects an existing name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const query = makeCatalogQuery({ data: [
      { id: "1", name: "Banner principal" },
      { id: "2", name: "Lona exterior" },
    ] });
    from.mockReturnValue(query);

    render(<TrackingNameCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Nombre visible en seguimiento" });
    await user.click(input);

    expect(await screen.findByRole("option", { name: "Banner principal" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Nombres de seguimiento disponibles" })).toHaveClass("ps-multimat-dropdown");
    await user.type(input, "Lona");
    await waitFor(() => expect(query.ilike).toHaveBeenCalledWith("name", "%Lona%"));
    await user.click(await screen.findByRole("option", { name: "Lona exterior" }));

    expect(onChange).toHaveBeenLastCalledWith("Lona exterior");
    expect(input).toHaveValue("Lona exterior");
  });

  it("keeps manual values and creates explicitly requested names", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TrackingNameCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Nombre visible en seguimiento" });

    await user.type(input, "  Nuevo   nombre  ");
    expect(onChange).toHaveBeenLastCalledWith("  Nuevo   nombre  ");
    await user.click(await screen.findByRole("button", { name: 'Crear y usar “Nuevo nombre”' }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_production_file_tracking_name", { p_name: "Nuevo nombre" }));
    expect(onChange).toHaveBeenLastCalledWith("Nuevo nombre");
  });

  it("does not issue duplicate create requests while the first one is pending", async () => {
    const user = userEvent.setup();
    let resolveCreate;
    rpc.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    render(<TrackingNameCombobox onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Nombre visible en seguimiento" });

    await user.type(input, "Nombre concurrente");
    const createButton = await screen.findByRole("button", { name: 'Crear y usar “Nombre concurrente”' });
    await user.click(createButton);
    await user.click(createButton);

    expect(rpc).toHaveBeenCalledTimes(1);
    resolveCreate({ data: [{ id: "created-2", name: "Nombre concurrente" }], error: null });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("shows an error without blocking the manual field", async () => {
    const user = userEvent.setup();
    from.mockReturnValue(makeCatalogQuery({ error: new Error("catalog unavailable") }));
    render(<TrackingNameCombobox onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Nombre visible en seguimiento" });

    await user.click(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("catalog unavailable");
    await user.type(input, "Manual");
    expect(input).toHaveValue("Manual");
  });

  it("supports keyboard selection and escape", async () => {
    const user = userEvent.setup();
    from.mockReturnValue(makeCatalogQuery({ data: [
      { id: "1", name: "Primero" },
      { id: "2", name: "Segundo" },
    ] }));
    const onChange = vi.fn();
    render(<TrackingNameCombobox onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Nombre visible en seguimiento" });

    await user.click(input);
    await screen.findByRole("option", { name: "Primero" });
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("Segundo");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(input);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
