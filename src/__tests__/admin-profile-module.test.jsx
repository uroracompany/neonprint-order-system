import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AdminProfileModule from "../components/admin/AdminProfileModule";

describe("AdminProfileModule", () => {
  afterEach(cleanup);

  it("muestra la identidad existente de la cuenta administrativa sin controles de edición", () => {
    render(
      <AdminProfileModule
        authUser={{ email: "admin@neonprint.test", created_at: "2026-01-01T12:00:00Z" }}
        profile={{ name: "Ana Administración", role: "admin", employment_status: true }}
      />
    );

    expect(screen.getByRole("heading", { name: "Ana Administración" })).toBeInTheDocument();
    expect(screen.getByText("admin@neonprint.test")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText(/solo de consulta/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
