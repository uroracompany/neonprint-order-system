import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssignModal } from "../components/ui/AssignModal";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../supabaseClient", () => ({ supabase: { from } }));

function makeProfilesQuery(data) {
  const filters = [];
  const query = {
    filters,
    select: vi.fn(() => query),
    eq: vi.fn((field, value) => { filters.push(["eq", field, value]); return query; }),
    or: vi.fn((expression) => { filters.push(["or", expression]); return query; }),
    is: vi.fn((field, value) => { filters.push(["is", field, value]); return query; }),
    then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return query;
}

describe("AssignModal candidates for Semi-Admin Caja assignment", () => {
  beforeEach(() => from.mockReset());

  it("lists only active, non-deleted Caja profiles and never adds Semi-Admin self-assignment", async () => {
    const query = makeProfilesQuery([
      { id: "cashier-1", name: "Caja Uno", role: "quote" },
    ]);
    from.mockReturnValue(query);

    render(
      <AssignModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        order={{ id: "order-1", client_name: "Cliente" }}
        loading={false}
        role="quote"
        filterActive
        allowSelfAssignment
        currentUserId="semi-1"
      />,
    );

    expect(await screen.findByRole("option", { name: "Caja Uno" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Yo (Semi-Administrador)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Asignarme a mí/ })).not.toBeInTheDocument();
    expect(from).toHaveBeenCalledTimes(1);
    expect(query.filters).toContainEqual(["eq", "role", "quote"]);
    expect(query.filters).toContainEqual(["or", "employment_status.eq.true,employment_status.is.null"]);
    expect(query.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("does not keep a historical Semi-Admin quote assignee as the selected default", async () => {
    from.mockReturnValue(makeProfilesQuery([
      { id: "cashier-1", name: "Caja Uno", role: "quote" },
    ]));

    render(
      <AssignModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        order={{ id: "order-1", client_name: "Cliente" }}
        loading={false}
        role="quote"
        filterActive
        defaultUserId="legacy-semi-1"
      />,
    );

    const select = await screen.findByRole("combobox", { name: "Responsable de caja" });
    expect(select).toHaveValue("");
    expect(select).toBeEnabled();
    expect(screen.getByRole("button", { name: "Asignar Orden" })).toBeDisabled();
  });
});
