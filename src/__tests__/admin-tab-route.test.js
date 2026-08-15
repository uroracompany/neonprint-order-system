import { describe, expect, it } from "vitest";
import { getAdminTabFromSearch, getAdminTabSearch } from "../utils/adminTabRoute";

describe("admin tab route", () => {
  it("restaura una sección válida desde la URL", () => {
    expect(getAdminTabFromSearch("?tab=users")).toBe("users");
    expect(getAdminTabFromSearch("?tab=unknown")).toBe("overview");
  });

  it("actualiza la sección sin eliminar otros parámetros de la URL", () => {
    expect(getAdminTabSearch("?source=notification", "credits")).toBe("?source=notification&tab=credits");
    expect(getAdminTabSearch("?source=notification&tab=users", "overview")).toBe("?source=notification");
  });
});
