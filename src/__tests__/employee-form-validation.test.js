import { describe, expect, it } from "vitest";
import { getEmployeeFormValidationMessage, validateEmployeeForm } from "../utils/employeeFormValidation";

const validCreateForm = {
  name: "Maria Fernanda",
  email: "maria@neonprint.com",
  role: "seller",
  password: "ClaveSegura123",
  confirmPassword: "ClaveSegura123",
};

describe("validateEmployeeForm", () => {
  it("habilita la creación cuando todos los campos requeridos son válidos", () => {
    expect(validateEmployeeForm(validCreateForm, "create").isValid).toBe(true);
  });

  it("acepta una contraseña de más de 12 caracteres sin exigir composición", () => {
    expect(validateEmployeeForm({
      ...validCreateForm,
      password: "abcdefghijklm",
      confirmPassword: "abcdefghijklm",
    }, "create").isValid).toBe(true);
  });

  it("rechaza una contraseña de exactamente 12 caracteres", () => {
    expect(validateEmployeeForm({
      ...validCreateForm,
      password: "abcdefghijkl",
      confirmPassword: "abcdefghijkl",
    }, "create")).toMatchObject({
      isValid: false,
      passwordError: "La contrasena debe tener mas de 12 caracteres.",
    });
  });

  it("explica el requisito que mantiene bloqueada la creación", () => {
    expect(getEmployeeFormValidationMessage({
      ...validCreateForm,
      password: "abcdefghijkl",
      confirmPassword: "abcdefghijkl",
    }, "create")).toBe("La contrasena debe tener mas de 12 caracteres.");

    expect(getEmployeeFormValidationMessage({
      ...validCreateForm,
      confirmPassword: "OtraClaveSegura",
    }, "create")).toBe("Las contraseñas no coinciden.");

    expect(getEmployeeFormValidationMessage(validCreateForm, "create")).toBeNull();
  });


  it("se invalida inmediatamente cuando una contraseña deja de coincidir", () => {
    expect(validateEmployeeForm({ ...validCreateForm, confirmPassword: "OtraClave123" }, "create")).toMatchObject({
      isValid: false,
      passwordsMatch: false,
    });
  });

  it("permite editar sin cambiar contraseña y exige una pareja válida si se modifica", () => {
    expect(validateEmployeeForm({ ...validCreateForm, password: "", confirmPassword: "" }, "edit").isValid).toBe(true);
    expect(validateEmployeeForm({ ...validCreateForm, confirmPassword: "" }, "edit").isValid).toBe(false);
  });
});
