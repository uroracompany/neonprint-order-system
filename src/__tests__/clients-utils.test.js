import { describe, expect, it } from "vitest";
import {
  NO_CLIENT_FILTER_VALUE,
  buildClientPayload,
  clientMatchesQuery,
  formatClientPhoneForStorage,
  getSelectedClientOrderFields,
  normalizeClientPhone,
  orderMatchesClientFilter,
  validateClientForm,
} from "../utils/clients";

describe("client utilities", () => {
  const client = {
    id: "client-1",
    name: "Imprenta Ámbar",
    phone: "809-555-1234",
  };

  it("normaliza teléfonos dominicanos con prefijo 1", () => {
    expect(normalizeClientPhone("+1 (809) 555-1234")).toBe("8095551234");
  });

  it("busca clientes por nombre sin depender de acentos", () => {
    expect(clientMatchesQuery(client, "ambar")).toBe(true);
  });

  it("busca clientes por teléfono usando solo dígitos", () => {
    expect(clientMatchesQuery(client, "5551234")).toBe(true);
  });

  it("filtra órdenes por cliente registrado", () => {
    expect(orderMatchesClientFilter({ client_id: "client-1" }, "client-1")).toBe(true);
    expect(orderMatchesClientFilter({ client_id: "client-2" }, "client-1")).toBe(false);
  });

  it("filtra órdenes sin cliente registrado", () => {
    expect(orderMatchesClientFilter({ client_id: null }, NO_CLIENT_FILTER_VALUE)).toBe(true);
    expect(orderMatchesClientFilter({ client_id: "client-1" }, NO_CLIENT_FILTER_VALUE)).toBe(false);
  });

  it("mapea un cliente seleccionado a campos de orden", () => {
    expect(getSelectedClientOrderFields(client, "client_contact")).toEqual({
      client_id: "client-1",
      client_name: "Imprenta Ámbar",
      client_contact: "809-555-1234",
    });
  });

  it("limpia solo client_id cuando se quita el cliente seleccionado", () => {
    expect(getSelectedClientOrderFields(null, "client_contact")).toEqual({
      client_id: null,
    });
  });

  it("formatea telefonos para guardar sin conservar prefijo pais", () => {
    expect(formatClientPhoneForStorage("+1 (809) 555-1234")).toBe("809-555-1234");
  });

  it("construye payload de cliente limpio y valida campos requeridos", () => {
    const { payload, errors } = validateClientForm({
      name: "  Cliente Nuevo  ",
      phone: "+1 (809) 555-9999",
      email: " cliente@example.com ",
      address: "  Santo Domingo  ",
      notes: "  VIP  ",
    });

    expect(errors).toEqual({});
    expect(payload).toEqual({
      name: "Cliente Nuevo",
      phone: "809-555-9999",
      email: "cliente@example.com",
      address: "Santo Domingo",
      notes: "VIP",
    });
  });

  it("reporta errores de cliente sin depender de campos visuales", () => {
    const { errors } = validateClientForm({
      name: "A",
      phone: "12",
      email: "correo-invalido",
    });

    expect(errors).toEqual({
      name: "El nombre debe tener al menos 2 caracteres.",
      phone: "El telefono debe tener al menos 3 digitos.",
      email: "Escribe un correo valido.",
    });
  });

  it("incluye created_by solo cuando el flujo lo solicita", () => {
    expect(buildClientPayload({ name: "Cliente", phone: "8095550000" }, {
      includeCreatedBy: true,
      userId: "user-1",
    })).toMatchObject({
      created_by: "user-1",
      phone: "809-555-0000",
    });
  });
});
