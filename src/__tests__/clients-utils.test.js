import { describe, expect, it } from "vitest";
import {
  NO_CLIENT_FILTER_VALUE,
  clientMatchesQuery,
  getManualClientEditFields,
  getSelectedClientOrderFields,
  normalizeClientPhone,
  orderMatchesClientFilter,
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

  it("limpia client_id cuando se edita manualmente un campo de cliente", () => {
    expect(getManualClientEditFields("client_name", "Cliente manual")).toEqual({
      client_id: null,
      client_name: "Cliente manual",
    });
  });
});
