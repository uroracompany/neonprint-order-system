import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserFormModal } from "../pages/dashboard";

const form = {
  name: "Ana",
  email: "ana@example.com",
  password: "SecurePass123",
  confirmPassword: "SecurePass123",
  role: "seller",
};

describe("UserFormModal submission feedback", () => {
  it("renders the create-user API error inside the open modal", () => {
    render(
      <UserFormModal
        open
        userForm={form}
        setUserForm={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        saving={false}
        submissionError="Este correo ya está registrado."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Este correo ya está registrado.");
  });
});
