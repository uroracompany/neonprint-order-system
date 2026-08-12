import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../components/Sidebar";

const menuItems = Array.from({ length: 12 }, (_, index) => ({
  id: `section-${index}`,
  label: `Sección ${index + 1}`,
  icon: <span aria-hidden="true" />,
}));

describe("sidebar con navegación desplazable", () => {
  afterEach(cleanup);

  it("habilita el área desplazable sólo cuando se solicita explícitamente", () => {
    const { container, rerender } = render(
      <Sidebar
        activeTab="section-0"
        onTabChange={vi.fn()}
        role="Admin"
        userName="Administrador"
        menuItems={menuItems}
        onLogout={vi.fn()}
        scrollNavigation
      />
    );

    expect(container.querySelector(".sb-sidebar")).toHaveClass("sb-sidebar-scroll-navigation");
    expect(screen.getByRole("button", { name: "Cerrar Sesión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sección 12" })).toBeInTheDocument();

    rerender(
      <Sidebar
        activeTab="section-0"
        onTabChange={vi.fn()}
        role="Caja"
        userName="Caja"
        menuItems={menuItems}
        onLogout={vi.fn()}
      />
    );

    expect(container.querySelector(".sb-sidebar")).not.toHaveClass("sb-sidebar-scroll-navigation");
  });
});
