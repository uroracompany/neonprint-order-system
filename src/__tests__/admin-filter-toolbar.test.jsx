import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SalesFilterToolbar } from "../components/ui/SalesFilterToolbar";

describe("SalesFilterToolbar", () => {
  it("muestra filtros activos y delega el reset sin alterar el control de fecha", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <SalesFilterToolbar
        ariaLabel="Filtros de prueba"
        search={{ label: "Buscar", value: "ana", onChange: vi.fn(), placeholder: "Buscar" }}
        controls={[
          { id: "status", label: "Estado", className: "pp-filter-select-wrap--wide", value: "pending", onChange: vi.fn(), isActive: true, options: [{ value: "all", label: "Todos" }, { value: "pending", label: "Pendiente" }] },
          { id: "from", label: "Desde", dateLabel: "Registro desde", className: "pp-filter-date--range", type: "date", value: "2026-01-01", onChange: vi.fn(), isActive: true },
        ]}
        resultCount={3}
        resultLabel="resultados"
        activeFilters={3}
        onReset={onReset}
      />,
    );

    const toolbar = screen.getByRole("region", { name: "Filtros de prueba" });
    expect(toolbar).toHaveClass("pp-filters", "pp-filters--sales-standard");
    expect(toolbar.querySelector(".admin-filter-toolbar__title")).toBeNull();
    expect(toolbar.querySelector(".admin-filter-toolbar__field")).toBeNull();
    expect(toolbar.querySelector(".pp-filter-select-wrap--wide")).toBeInTheDocument();
    expect(screen.getByText("3 activos")).toBeInTheDocument();
    expect(screen.getByText("Registro desde")).toBeInTheDocument();
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-01-01");
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
