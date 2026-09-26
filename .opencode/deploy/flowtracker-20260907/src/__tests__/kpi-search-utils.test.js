import { describe, expect, it } from "vitest";
import { buildKpiSearchText, matchesKpiSearch, normalizeKpiSearch } from "../utils/kpiSearch";

describe("KPI search utilities", () => {
  it("searches ignoring casing", () => {
    expect(matchesKpiSearch({ client_name: "Juan Perez" }, "juan", ["client_name"])).toBe(true);
    expect(matchesKpiSearch({ client_name: "Juan Perez" }, "PEREZ", ["client_name"])).toBe(true);
  });

  it("searches ignoring accents", () => {
    expect(normalizeKpiSearch("Crédito pendiente")).toBe("credito pendiente");
    expect(matchesKpiSearch({ status: "Crédito" }, "credito", ["status"])).toBe(true);
  });

  it("matches multiple terms across different fields", () => {
    const item = {
      client_name: "Juan Perez",
      materials: [{ name: "Vinilo mate" }],
    };

    expect(matchesKpiSearch(item, "juan vinilo", [
      "client_name",
      entry => entry.materials.map(material => material.name).join(" "),
    ])).toBe(true);
  });

  it("does not require exact matches", () => {
    expect(matchesKpiSearch({ material: "Lona Premium 13oz" }, "prem", ["material"])).toBe(true);
  });

  it("handles null, undefined, numbers and arrays without crashing", () => {
    const item = { client_name: null, invoice_number: 1024, tags: ["credito", undefined] };

    expect(buildKpiSearchText(item, ["client_name", "invoice_number", "tags"])).toContain("1024");
    expect(matchesKpiSearch(item, "1024 credito", ["client_name", "invoice_number", "tags"])).toBe(true);
    expect(matchesKpiSearch(undefined, "anything", ["name"])).toBe(false);
  });
});
