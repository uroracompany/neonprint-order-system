import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssignModal } from "../components/ui/AssignModal";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../supabaseClient", () => ({
  supabase: { from },
}));

const makeQuery = (result) => {
  const promise = Promise.resolve(result);
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve, reject) => promise.then(resolve, reject),
  };
  return query;
};

describe("AssignModal fetch error state", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("shows the actual candidate-loading error instead of an empty-state message", async () => {
    from.mockReturnValue(makeQuery({ data: null, error: { message: "profiles unavailable" } }));

    render(
      <AssignModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        order={{ id: "12345678-order", client_name: "Cliente" }}
        loading={false}
        role="quote"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Error al cargar usuarios");
    expect(screen.queryByText("No hay Cajas disponibles")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Asignar Orden" })).toBeDisabled();
  });

  it("keeps the native selector operable and shows a decorative chevron at its right edge", async () => {
    from.mockReturnValue(makeQuery({
      data: [{ id: "cashier-1", name: "Caja Uno", role: "quote" }],
      error: null,
    }));

    render(
      <AssignModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        order={{ id: "12345678-order", client_name: "Cliente" }}
        loading={false}
        role="quote"
      />,
    );

    const select = await screen.findByRole("combobox", { name: "Responsable de caja" });
    const wrapper = select.parentElement;
    const chevron = wrapper.querySelector("svg");

    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select).toHaveClass("ams-assign-select");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveAttribute("focusable", "false");
    expect(wrapper).toHaveClass("ams-assign-select-wrap");
  });
});
